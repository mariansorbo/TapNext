// Cómo una imagen de cualquier forma (apaisada, vertical, cuadrada) entra en
// el cuadrado de la pantalla del tap. Lo usa el editor de Mi panel
// (src/org-panel.js) y la página de prueba, así lo que se ve en la prueba es
// exactamente lo que haría el editor.
//
// Todo en coordenadas del cuadrado de salida (0..SALIDA): `escala` = px de
// salida por px de la imagen original; (cx, cy) = dónde cae su centro.

export const SALIDA = 1080; // px del cuadrado que se sube
const MARGEN_ENTERA = 0.86; // "Que entre entera" deja un poco de aire alrededor

export function escalasPara(iw, ih) {
  return { contener: SALIDA / Math.max(iw, ih), cubrir: SALIDA / Math.min(iw, ih) };
}

// Punto de partida: una foto casi cuadrada llena el cuadro; un logo apaisado
// o vertical entra entero.
export const modoInicial = (iw, ih) => (iw / ih > 0.8 && iw / ih < 1.25 ? 'llenar' : 'entera');

export function escalaDeModo(modo, iw, ih) {
  const { contener, cubrir } = escalasPara(iw, ih);
  return modo === 'llenar' ? cubrir : contener * MARGEN_ENTERA;
}

// Color con el que se rellena lo que la imagen no cubre: el color más
// repetido en el borde de la imagen (así un logo sobre blanco sigue sobre
// blanco, uno sobre azul sigue sobre azul, sin costura entre la imagen y el
// relleno). Más repetido y no promedio: un trazo que toca el borde no tiñe el
// relleno. Si el borde es casi todo transparente (PNG de logo), blanco.
export function colorDeBordes(fuente) {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(fuente, 0, 0, n, n);
  const { data } = ctx.getImageData(0, 0, n, n);
  const grupos = new Map();
  let total = 0, opacos = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (x > 1 && x < n - 2 && y > 1 && y < n - 2) continue;
      const i = (y * n + x) * 4;
      total++;
      if (data[i + 3] < 250) continue;
      opacos++;
      const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const g = grupos.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      g.n++;
      g.r += data[i];
      g.g += data[i + 1];
      g.b += data[i + 2];
      grupos.set(k, g);
    }
  }
  if (opacos < total / 2) return '#ffffff';
  let mejor = null;
  for (const g of grupos.values()) if (!mejor || g.n > mejor.n) mejor = g;
  const hex = (v) => Math.round(v / mejor.n).toString(16).padStart(2, '0');
  return `#${hex(mejor.r)}${hex(mejor.g)}${hex(mejor.b)}`;
}

// Dibuja el cuadrado (de `lado` px) con el encuadre dado.
export function pintarCuadro(ctx, lado, fuente, { iw, ih, escala, cx, cy, fondo }) {
  const k = lado / SALIDA;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, lado, lado);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const w = iw * escala * k;
  const h = ih * escala * k;
  ctx.drawImage(fuente, cx * k - w / 2, cy * k - h / 2, w, h);
}

// Lo que haría el editor sin que nadie toque nada: modo inicial, centrado,
// fondo del borde. Devuelve el canvas cuadrado de SALIDA px.
export function encuadreAutomatico(img) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const modo = modoInicial(iw, ih);
  const fondo = colorDeBordes(img);
  const c = document.createElement('canvas');
  c.width = c.height = SALIDA;
  pintarCuadro(c.getContext('2d'), SALIDA, img, {
    iw,
    ih,
    escala: escalaDeModo(modo, iw, ih),
    cx: SALIDA / 2,
    cy: SALIDA / 2,
    fondo,
  });
  return { canvas: c, modo, fondo, iw, ih };
}
