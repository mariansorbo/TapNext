// Página del comprador para coordinar la entrega en mano (envío gratis por
// entrega propia). Entra con /entrega.html?t=<token> desde el mail de compra.
// Elige día + horario, o pide recibirlo por Correo. Ver server/entrega-propia.js.

import './styles.css';
import './visita.js';
import { applyBrand } from './brand.js';

applyBrand('Coordinar entrega');

const API_BASE = import.meta.env.VITE_API_BASE || '';
const token = new URLSearchParams(location.search).get('t') || '';

const $ = (id) => document.getElementById(id);
const views = ['loading-view', 'error-view', 'elegir-view', 'info-view'];
const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

const diasEl = $('dias');
const franjasEl = $('franjas');
const confirmarBtn = $('confirmar');
const statusEl = $('status');
const correoBtn = $('pedir-correo');

let data = null;
let diaElegido = null;
let franjaElegida = null;

async function api(path, options) {
  const res = await fetch(`${API_BASE}/api/public/entrega/${encodeURIComponent(token)}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Algo salió mal. Probá de nuevo.');
  return body;
}

// 'YYYY-MM-DD' -> "martes 17 de noviembre" (mediodía UTC: sin corrimientos de día).
const fechaLarga = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const capitalizar = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const franjaLabel = (id) => data.franjas.find((f) => f.id === id)?.label || id;

function setStatus(texto, tipo = '') {
  statusEl.textContent = texto;
  statusEl.className = `modal-status${tipo ? ` is-${tipo}` : ''}`;
}

function actualizarConfirmar() {
  confirmarBtn.disabled = !(diaElegido && franjaElegida);
}

// Botones de selección única: marca el elegido y desmarca el resto.
function opcion(contenedor, texto, valor, onPick, activo) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `entrega-opt${activo ? ' is-selected' : ''}`;
  b.textContent = texto;
  b.addEventListener('click', () => {
    contenedor.querySelectorAll('.entrega-opt').forEach((x) => x.classList.remove('is-selected'));
    b.classList.add('is-selected');
    onPick(valor);
    setStatus('');
    actualizarConfirmar();
  });
  contenedor.append(b);
}

function pintarElegir() {
  const nombre = data.nombre ? `${data.nombre}, ` : '';
  $('dias-deposito').textContent = data.diasDeposito;
  $('elegir-lead').textContent = `${nombre}te lo llevamos sin cargo a ${data.localidad}, a más tardar el ${fechaLarga(data.fechaLimite)}.`;
  if (data.elegido) {
    $('elegir-titulo').textContent = 'Tu entrega está coordinada.';
    $('elegir-lead').textContent = `Te lo llevamos el ${fechaLarga(data.elegido.fecha)}, ${franjaLabel(data.elegido.franja).toLowerCase()}. Si necesitás cambiarlo, elegí otro día y horario acá abajo.`;
    diaElegido = data.elegido.fecha;
    franjaElegida = data.elegido.franja;
  }

  diasEl.textContent = '';
  franjasEl.textContent = '';
  if (!data.dias.length) {
    diasEl.textContent = 'Ya no quedan días para coordinar desde acá. Te escribimos por mail.';
    confirmarBtn.hidden = true;
  }
  data.dias.forEach((d) =>
    opcion(diasEl, capitalizar(fechaLarga(d)), d, (v) => (diaElegido = v), d === diaElegido)
  );
  data.franjas.forEach((f) =>
    opcion(franjasEl, f.label, f.id, (v) => (franjaElegida = v), f.id === franjaElegida)
  );
  actualizarConfirmar();
  show('elegir-view');
}

// Pantallas finales según el estado de la entrega.
function pintarInfo() {
  const e = data.estado;
  let titulo = 'Tu entrega';
  let texto = '';
  if (e === 'pidio_correo') {
    titulo = 'Anotamos tu pedido de Correo Argentino.';
    texto = 'Te escribimos por mail con el costo del envío y cómo abonarlo. Tu llavero está guardado en nuestro depósito.';
  } else if (e === 'en_camino') {
    titulo = 'Hoy pasamos por tu domicilio.';
    texto = data.elegido ? `Es el ${fechaLarga(data.elegido.fecha)}, ${franjaLabel(data.elegido.franja).toLowerCase()}.` : '';
  } else if (e === 'entregado') {
    titulo = '¡Tu llavero ya fue entregado!';
    texto = 'Configurá a dónde lleva desde tu panel.';
  } else if (e === 'no_estaba') {
    titulo = 'Pasamos y no te encontramos.';
    texto = `Tu llavero está guardado ${data.diasDeposito} días en nuestro depósito. Pedí acá que te lo enviemos por correo: el costo del envío lo abonás vos y te escribimos con el importe.`;
  } else if (e === 'vencido' || e === 'cerrado') {
    titulo = 'Se cumplió el plazo de depósito.';
    texto = 'Pasaron 30 días sin que pidieras el envío. Escribinos por WhatsApp (+54 9 11 7108-2780) o a mariansorbo@gmail.com y lo resolvemos.';
  } else {
    texto = 'Escribinos si tenés alguna duda con tu pedido.';
  }
  $('info-titulo').textContent = titulo;
  $('info-texto').textContent = texto;
  $('info-correo').hidden = !data.puedePedirCorreo;
  show('info-view');
}

$('info-correo').addEventListener('click', async () => {
  if (!confirm('¿Seguro? El costo del envío por correo lo abonás vos.')) return;
  const btn = $('info-correo');
  btn.disabled = true;
  try {
    await api('/correo', { method: 'POST', body: '{}' });
    data = await api('', { method: 'GET' });
    pintar();
  } catch (err) {
    $('info-status').textContent = err.message;
    $('info-status').className = 'modal-status is-error';
    btn.disabled = false;
  }
});

function pintar() {
  if (['a_coordinar', 'coordinado'].includes(data.estado)) pintarElegir();
  else pintarInfo();
}

confirmarBtn.addEventListener('click', async () => {
  confirmarBtn.disabled = true;
  setStatus('Guardando...');
  try {
    await api('/elegir', { method: 'POST', body: JSON.stringify({ fecha: diaElegido, franja: franjaElegida }) });
    data = await api('', { method: 'GET' });
    pintar();
    setStatus('¡Listo! Te esperamos ese día. Te mandamos el aviso por mail antes de salir.', 'success');
  } catch (err) {
    setStatus(err.message, 'error');
    confirmarBtn.disabled = false;
  }
});

correoBtn.addEventListener('click', async () => {
  if (!confirm('¿Seguro? Si elegís Correo Argentino, el costo del envío lo abonás vos.')) return;
  correoBtn.disabled = true;
  try {
    await api('/correo', { method: 'POST', body: '{}' });
    data = await api('', { method: 'GET' });
    pintar();
  } catch (err) {
    setStatus(err.message, 'error');
    correoBtn.disabled = false;
  }
});

(async () => {
  if (!/^[0-9a-f]{24}$/i.test(token)) {
    $('error-text').textContent = 'Este link no es válido. Abrilo desde el mail de tu compra.';
    show('error-view');
    return;
  }
  try {
    data = await api('', { method: 'GET' });
    pintar();
  } catch (err) {
    $('error-text').textContent = err.message;
    show('error-view');
  }
})();
