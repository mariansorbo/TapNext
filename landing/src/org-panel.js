// Mi panel → "Tu organización" (solo cuentas de empresa, ver
// server/organizaciones.js): el nombre de la organización y la
// imagen de la pantalla del tap, con un editor para encuadrarla.
//
// El editor resuelve en el navegador que "quede bien sin importar el tamaño":
// la pantalla del tap muestra la imagen en un cuadro, así que acá se elige qué
// parte entra (arrastrar + zoom, o los atajos "entera" / "llenar el cuadro"),
// se rellena el fondo si sobra lugar (color detectado de los bordes de la
// imagen, editable) y se exporta siempre igual: cuadrada de SALIDA px. Además
// avisa en vivo si la imagen se va a ver borrosa con ese zoom.

import { colorMayoritario, paletaPantalla } from './color-logo.js';
import { SALIDA, escalasPara, modoInicial, escalaDeModo, colorDeBordes, pintarCuadro } from './encuadre.js';

// En el celu el cuadro mide hasta ~320 px de CSS × 3 de densidad ≈ 960 px reales.
const PX_REALES_EN_PANTALLA = 960;
const TRABAJO_MAX = 1600; // copia achicada para dibujar fluido mientras se edita
const MAX_BYTES = 1_400_000;

export function initOrgPanel({ api, apiBase, getToken, onSesionVencida }) {
  const $ = (id) => document.getElementById(id);
  const box = $('org-box');
  const nombreForm = $('org-nombre-form');
  const nombreInput = $('org-nombre');
  const fileInput = $('org-file');
  const subirLabel = $('org-subir-label');
  const quitarBtn = $('org-img-quitar');
  const status = $('org-status');
  const previewImg = $('org-preview-img');
  const editor = $('org-editor');
  const stage = $('org-stage');
  const canvas = $('org-canvas');
  const zoom = $('org-zoom');
  const fondoRow = $('org-fondo-row');
  const fondoInput = $('org-fondo');
  const calidad = $('org-calidad');
  const guardarBtn = $('org-guardar');
  const cancelarBtn = $('org-cancelar');
  const modoBtns = editor.querySelectorAll('[data-modo]');
  const preview = box.querySelector('.org-preview');
  const previewMarkTap = box.querySelector('.org-preview-mark span');
  const colorRow = $('org-color-row');
  const colorInput = $('org-color');
  const colorOrigen = $('org-color-origen');

  let org = null;

  const setStatus = (clase, texto) => {
    status.className = `modal-status${clase ? ` ${clase}` : ''}`;
    status.textContent = texto;
  };

  function render(nueva) {
    org = nueva || null;
    box.hidden = !org;
    if (!org) return;
    nombreInput.value = org.nombre;
    if (!edicion) mostrarImagenGuardada();
  }

  // La vista previa toma los mismos colores que la pantalla del tap (fondo =
  // color del logo, texto claro u oscuro según contraste).
  function pintarPreview(color, borde) {
    const p = paletaPantalla(color, borde);
    preview.style.background = p.fondo;
    preview.style.color = p.texto;
    previewMarkTap.style.background = p.acento;
    previewMarkTap.style.color = p.acentoTexto;
    previewImg.style.boxShadow = p.sombra;
  }

  function mostrarImagenGuardada() {
    previewImg.innerHTML = '';
    previewImg.classList.toggle('is-vacia', !org.imagenUrl);
    if (org.imagenUrl) {
      const img = new Image();
      img.alt = '';
      img.src = `${apiBase}${org.imagenUrl}`;
      previewImg.appendChild(img);
    } else {
      previewImg.textContent = 'Tu imagen';
    }
    pintarPreview(org.colorFondo, org.colorBorde);
    colorRow.hidden = !org.imagenUrl;
    colorInput.value = paletaPantalla(org.colorFondo).fondo;
    subirLabel.firstChild.textContent = org.imagenUrl ? 'Cambiar imagen' : 'Subir imagen';
    quitarBtn.hidden = !org.imagenUrl;
  }

  nombreForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/me/organizacion', { method: 'PATCH', body: JSON.stringify({ nombre: nombreInput.value }) });
      render(r.organizacion);
      setStatus('is-success', 'Nombre guardado.');
    } catch (err) {
      if (err.status === 401) return onSesionVencida();
      setStatus('is-error', err.message);
    }
  });

  // El color se puede cambiar a mano; se guarda al soltar el selector.
  colorInput.addEventListener('input', () => pintarPreview(colorInput.value, org?.colorBorde));
  colorInput.addEventListener('change', async () => {
    try {
      const r = await api('/me/organizacion', { method: 'PATCH', body: JSON.stringify({ colorFondo: colorInput.value }) });
      colorOrigen.textContent = '(elegido por vos)';
      render(r.organizacion);
      setStatus('is-success', 'Color guardado.');
    } catch (err) {
      if (err.status === 401) return onSesionVencida();
      setStatus('is-error', err.message);
    }
  });

  quitarBtn.addEventListener('click', async () => {
    if (!confirm('¿Quitar la imagen? La pantalla del tap queda solo con NextTap.')) return;
    try {
      const r = await api('/me/organizacion/imagen', { method: 'DELETE' });
      render(r.organizacion);
      setStatus('', 'Imagen quitada.');
    } catch (err) {
      if (err.status === 401) return onSesionVencida();
      setStatus('is-error', err.message);
    }
  });

  // --- Editor ---
  // Todo en coordenadas del cuadrado de salida (0..SALIDA): `escala` = px de
  // salida por px de la imagen original; (cx, cy) = dónde cae el centro de la
  // imagen. El canvas en pantalla dibuja lo mismo, achicado.
  let edicion = null; // { original, trabajo, iw, ih, escala, cx, cy, min, max }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    setStatus('', '');
    try {
      await abrirEditor(file);
    } catch {
      setStatus('is-error', 'No pudimos abrir esa imagen. Probá con un JPG o PNG.');
    }
  });

  function cargarImagen(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve(img); // el navegador ya aplica la rotación EXIF
      img.onerror = reject;
      img.src = url;
    });
  }

  async function abrirEditor(file) {
    const original = await cargarImagen(file);
    const iw = original.naturalWidth;
    const ih = original.naturalHeight;
    if (!iw || !ih) throw new Error('vacía');

    // Copia achicada para mover/zoomear sin trabarse con fotos de 12 MP.
    let trabajo = original;
    const k = Math.min(1, TRABAJO_MAX / Math.max(iw, ih));
    if (k < 1) {
      trabajo = document.createElement('canvas');
      trabajo.width = Math.round(iw * k);
      trabajo.height = Math.round(ih * k);
      trabajo.getContext('2d').drawImage(original, 0, 0, trabajo.width, trabajo.height);
    }

    const { contener, cubrir } = escalasPara(iw, ih);
    edicion = {
      original,
      trabajo,
      iw,
      ih,
      contener,
      cubrir,
      min: contener * 0.4,
      max: Math.max(cubrir * 4, contener * 4),
      escala: 1,
      cx: SALIDA / 2,
      cy: SALIDA / 2,
    };
    fondoInput.value = colorDeBordes(trabajo);

    // Punto de partida: una foto casi cuadrada llena el cuadro; un logo
    // apaisado o vertical entra entero con un poco de aire alrededor.
    aplicarModo(modoInicial(iw, ih));

    editor.hidden = false;
    nombreForm.hidden = true;
    subirLabel.hidden = true;
    quitarBtn.hidden = true;
    colorRow.hidden = true;
    previewImg.innerHTML = '';
    previewImg.classList.remove('is-vacia');
    previewImg.appendChild(previewCanvas);
    ajustarCanvas();
    dibujar();
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cerrarEditor() {
    edicion = null;
    editor.hidden = true;
    nombreForm.hidden = false;
    subirLabel.hidden = false;
    mostrarImagenGuardada();
  }
  cancelarBtn.addEventListener('click', cerrarEditor);

  function aplicarModo(modo) {
    const e = edicion;
    e.escala = escalaDeModo(modo, e.iw, e.ih);
    e.cx = SALIDA / 2;
    e.cy = SALIDA / 2;
    acomodar();
    dibujar();
  }
  modoBtns.forEach((b) => b.addEventListener('click', () => edicion && aplicarModo(b.dataset.modo)));

  // Que la imagen nunca se vaya del cuadro: si es más grande que el cuadro en
  // un eje, no deja hueco en ese eje; si es más chica, no se sale.
  function acomodar() {
    const e = edicion;
    e.escala = Math.min(e.max, Math.max(e.min, e.escala));
    const w = e.iw * e.escala;
    const h = e.ih * e.escala;
    const lim = (c, tam) =>
      tam >= SALIDA
        ? Math.min(tam / 2, Math.max(SALIDA - tam / 2, c))
        : Math.min(SALIDA - tam / 2, Math.max(tam / 2, c));
    e.cx = lim(e.cx, w);
    e.cy = lim(e.cy, h);
  }

  function zoomEn(nueva, fx = SALIDA / 2, fy = SALIDA / 2) {
    const e = edicion;
    const anterior = e.escala;
    e.escala = Math.min(e.max, Math.max(e.min, nueva));
    const k = e.escala / anterior;
    e.cx = fx - (fx - e.cx) * k;
    e.cy = fy - (fy - e.cy) * k;
    acomodar();
    dibujar();
  }

  // Slider logarítmico: el mismo recorrido de dedo acerca lo mismo en
  // cualquier punto de la barra.
  const aSlider = (s) => Math.round((1000 * Math.log(s / edicion.min)) / Math.log(edicion.max / edicion.min));
  const deSlider = (v) => edicion.min * Math.pow(edicion.max / edicion.min, v / 1000);
  zoom.addEventListener('input', () => edicion && zoomEn(deSlider(Number(zoom.value))));

  const previewCanvas = document.createElement('canvas');

  function ajustarCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const lado = stage.clientWidth || 300;
    canvas.width = canvas.height = Math.round(lado * dpr);
    previewCanvas.width = previewCanvas.height = Math.round((previewImg.clientWidth || 140) * dpr);
  }
  window.addEventListener('resize', () => {
    if (!edicion) return;
    ajustarCanvas();
    dibujar();
  });

  function pintar(ctx, lado, fuente) {
    pintarCuadro(ctx, lado, fuente, { ...edicion, fondo: fondoInput.value });
  }

  function dibujar() {
    const e = edicion;
    if (!e) return;
    pintar(canvas.getContext('2d'), canvas.width, e.trabajo);
    pintar(previewCanvas.getContext('2d'), previewCanvas.width, e.trabajo);
    zoom.value = String(aSlider(e.escala));
    e.color = colorDelCuadro();
    // Borde de la imagen ya encuadrada: si coincide con el fondo, sin sombra.
    e.borde = colorDeBordes(muestra);
    pintarPreview(e.color, e.borde);

    const w = e.iw * e.escala;
    const h = e.ih * e.escala;
    const sobra = w < SALIDA - 1 || h < SALIDA - 1;
    fondoRow.hidden = !sobra;

    // Cuántos px reales de pantalla le tocan a cada px de la imagen original:
    // más de ~1,4 ya se nota estirada; más de ~2,2, borrosa.
    const estirado = (e.escala * PX_REALES_EN_PANTALLA) / SALIDA;
    let nivel, texto;
    if (estirado <= 1.4) {
      nivel = 'ok';
      texto = '✓ Buena definición';
    } else if (estirado <= 2.2) {
      nivel = 'medio';
      texto = 'Definición aceptable. Con una imagen más grande, o alejándola un poco, se vería más nítida.';
    } else {
      nivel = 'mal';
      const lado = Math.ceil(PX_REALES_EN_PANTALLA / 1.4 / 10) * 10;
      texto = `Se va a ver borrosa: la imagen es chica para este zoom. Alejala o probá con una de al menos ${lado}×${lado} px.`;
    }
    calidad.className = `org-calidad is-${nivel}`;
    calidad.textContent = texto;
  }
  fondoInput.addEventListener('input', dibujar);

  // Color mayoritario de lo que queda dentro del cuadro (tal cual se va a
  // ver), sobre una copia de 128×128: barato aunque se recalcule al arrastrar,
  // y con resolución suficiente para que las líneas finas no se vuelvan gris.
  const MUESTRA = 128;
  const muestra = document.createElement('canvas');
  muestra.width = muestra.height = MUESTRA;
  const muestraCtx = muestra.getContext('2d', { willReadFrequently: true });
  function colorDelCuadro() {
    pintar(muestraCtx, MUESTRA, edicion.trabajo);
    return colorMayoritario(muestraCtx.getImageData(0, 0, MUESTRA, MUESTRA).data);
  }

  // Arrastrar con un dedo / mouse; pellizcar con dos; rueda en compu.
  const punteros = new Map();
  let pellizco = null;
  const aSalida = (px) => (px * SALIDA) / stage.clientWidth;
  const posEnSalida = (ev) => {
    const r = stage.getBoundingClientRect();
    return [aSalida(ev.clientX - r.left), aSalida(ev.clientY - r.top)];
  };

  stage.addEventListener('pointerdown', (ev) => {
    if (!edicion) return;
    stage.setPointerCapture(ev.pointerId);
    punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      pellizco = { dist: Math.hypot(a.x - b.x, a.y - b.y), escala: edicion.escala };
    }
  });
  stage.addEventListener('pointermove', (ev) => {
    const prev = punteros.get(ev.pointerId);
    if (!edicion || !prev) return;
    punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (punteros.size >= 2 && pellizco) {
      const [a, b] = [...punteros.values()];
      const r = stage.getBoundingClientRect();
      const fx = aSalida((a.x + b.x) / 2 - r.left);
      const fy = aSalida((a.y + b.y) / 2 - r.top);
      zoomEn((pellizco.escala * Math.hypot(a.x - b.x, a.y - b.y)) / pellizco.dist, fx, fy);
      return;
    }
    edicion.cx += aSalida(ev.clientX - prev.x);
    edicion.cy += aSalida(ev.clientY - prev.y);
    acomodar();
    dibujar();
  });
  const soltar = (ev) => {
    punteros.delete(ev.pointerId);
    if (punteros.size < 2) pellizco = null;
  };
  stage.addEventListener('pointerup', soltar);
  stage.addEventListener('pointercancel', soltar);
  stage.addEventListener(
    'wheel',
    (ev) => {
      if (!edicion) return;
      ev.preventDefault();
      const [fx, fy] = posEnSalida(ev);
      zoomEn(edicion.escala * Math.exp(-ev.deltaY * 0.0015), fx, fy);
    },
    { passive: false }
  );

  // --- Guardar: se dibuja desde el ORIGINAL (no la copia de trabajo) ---
  function aBlob(c, tipo, q) {
    return new Promise((resolve) => c.toBlob(resolve, tipo, q));
  }

  async function exportar() {
    const c = document.createElement('canvas');
    c.width = c.height = SALIDA;
    pintar(c.getContext('2d'), SALIDA, edicion.original);
    // WebP si el navegador lo sabe generar (Safari viejo devuelve PNG: ahí JPEG).
    let blob = await aBlob(c, 'image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') blob = await aBlob(c, 'image/jpeg', 0.88);
    if (blob && blob.size > MAX_BYTES) blob = await aBlob(c, 'image/jpeg', 0.75);
    return blob;
  }

  guardarBtn.addEventListener('click', async () => {
    if (!edicion) return;
    guardarBtn.disabled = true;
    setStatus('', 'Guardando...');
    try {
      const blob = await exportar();
      const color = edicion.color || '';
      const qs = `color=${encodeURIComponent(color)}&borde=${encodeURIComponent(edicion.borde || '')}`;
      const res = await fetch(`${apiBase}/api/me/organizacion/imagen?${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type, Authorization: `Bearer ${getToken()}` },
        body: blob,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return onSesionVencida();
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la imagen.');
      edicion = null;
      editor.hidden = true;
      nombreForm.hidden = false;
      subirLabel.hidden = false;
      colorOrigen.textContent = '(sale de tu logo)';
      render(data.organizacion);
      mostrarImagenGuardada();
      setStatus('is-success', 'Listo: así se ve cuando tocan uno de tus productos.');
    } catch (err) {
      setStatus('is-error', err.message);
    } finally {
      guardarBtn.disabled = false;
    }
  });

  return { render };
}
