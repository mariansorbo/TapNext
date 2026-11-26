// Pantalla de firma del acuerdo con el comercio (link único /acuerdo/<token>).
// Flujo: resumen → verificar mail con código → datos + tres casillas + firma
// escrita → listo. Lo guarda todo el server (server/acuerdos.js).
import './acuerdo.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const $ = (id) => document.getElementById(id);

const token = (location.pathname.match(/\/acuerdo\/([^/?#]+)/) || [])[1] || new URLSearchParams(location.search).get('t') || '';
let sesion = '';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(ruta, cuerpo) {
  const res = await fetch(`${API_BASE}/api/acuerdos/${encodeURIComponent(token)}${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No pudimos conectar. Probá de nuevo.');
  return data;
}

function estado(id, texto, tipo = '') {
  const el = $(id);
  el.textContent = texto;
  el.className = `ac-estado${tipo ? ` is-${tipo}` : ''}`;
}

function mostrar(id) {
  for (const s of ['ac-cargando', 'ac-error', 'ac-paso-verificar', 'ac-paso-firmar', 'ac-paso-listo']) $(s).hidden = s !== id;
  window.scrollTo(0, 0);
}

const clausulasHtml = (cl) => cl.map((c) => `<h3>${esc(c.titulo)}</h3><p>${esc(c.texto)}</p>`).join('');

function mostrarError(msg) {
  $('ac-error-msg').textContent = msg;
  mostrar('ac-error');
}

async function cargar() {
  if (!token) return mostrarError('Falta el link completo del acuerdo. Pedile a NextTap que te lo vuelva a mandar.');
  let d;
  try {
    d = await api('');
  } catch (err) {
    return mostrarError(err.message);
  }
  if (d.estado === 'vencido') return mostrarError('Este link venció. Pedile a NextTap uno nuevo.');
  if (d.estado !== 'enviado') {
    $('ac-anticipo').textContent = d.anticipoTexto;
    return mostrar('ac-paso-listo');
  }
  $('ac-comercio').textContent = d.comercio;
  const wa = d.canal === 'whatsapp';
  $('ac-mail').textContent = d.contactoEnmascarado;
  $('ac-verif-titulo').textContent = wa ? 'Primero, verificamos tu WhatsApp' : 'Primero, verificamos tu mail';
  $('ac-mailcopia-caja').hidden = !wa;
  $('ac-c3-texto').textContent = wa
    ? 'Acepto firmar electrónicamente y que mi WhatsApp verificado es mi domicilio para notificaciones.'
    : 'Acepto firmar electrónicamente y que mi mail verificado es mi domicilio para notificaciones.';
  $('ac-resumen').innerHTML = d.resumen.map((r) => `<li>${esc(r)}</li>`).join('');
  $('ac-clausulas').innerHTML = clausulasHtml(d.clausulas);
  $('ac-clausulas-2').innerHTML = clausulasHtml(d.clausulas);
  $('ac-c2-texto').textContent =
    `Voy a recibir ${d.unidades} llaveros, el stand y las muestras, nuevos, sin activar y en perfecto estado. ` +
    `Entiendo que los llaveros que no devuelva, devuelva activados, dañados o con defectos los pago como vendidos (${d.precioRendicionTexto} c/u).`;
  $('ac-nombre').value = '';
  $('ac-local').value = d.comercio;
  mostrar('ac-paso-verificar');
}

async function pedirCodigo() {
  const nombre = $('ac-nombre-previo').value.trim().replace(/\s+/g, ' ');
  if (nombre.length < 5 || !nombre.includes(' ')) {
    estado('ac-verificar-estado', 'Escribí tu nombre y apellido para recibir el código.', 'error');
    $('ac-nombre-previo').focus();
    return;
  }
  $('ac-pedir-codigo').disabled = true;
  estado('ac-verificar-estado', 'Enviando…');
  try {
    const r = await api('/codigo', { nombre });
    $('ac-codigo-caja').hidden = false;
    $('ac-pedir-codigo').hidden = true;
    estado('ac-verificar-estado', r.canal === 'whatsapp' ? `Te lo mandamos por WhatsApp (${r.contactoEnmascarado}).` : `Te lo mandamos a ${r.contactoEnmascarado}. Revisá también spam.`, 'ok');
    $('ac-codigo').focus();
  } catch (err) {
    $('ac-pedir-codigo').disabled = false;
    estado('ac-verificar-estado', err.message, 'error');
  }
}

async function verificar() {
  estado('ac-verificar-estado', 'Verificando…');
  try {
    const r = await api('/verificar', { codigo: $('ac-codigo').value });
    sesion = r.sesion;
    // El nombre que dio al pedir el código ya viene cargado en el formulario de firma (lo puede corregir).
    $('ac-nombre').value = r.nombre || $('ac-nombre-previo').value.trim();
    mostrar('ac-paso-firmar');
  } catch (err) {
    estado('ac-verificar-estado', err.message, 'error');
  }
}

function actualizarBoton() {
  const ok = ['ac-c1', 'ac-c2', 'ac-c3'].every((id) => $(id).checked) && $('ac-firma').value.trim().length >= 5;
  $('ac-firmar').disabled = !ok;
}

async function firmar(e) {
  e.preventDefault();
  $('ac-firmar').disabled = true;
  estado('ac-firmar-estado', 'Firmando…');
  try {
    const r = await api('/firmar', {
      sesion,
      nombre: $('ac-nombre').value,
      documento: $('ac-documento').value,
      local: $('ac-local').value,
      domicilio: $('ac-domicilio').value,
      mailCopia: $('ac-mailcopia').value,
      firmaNombre: $('ac-firma').value,
      aceptaContrato: $('ac-c1').checked,
      aceptaStock: $('ac-c2').checked,
      aceptaFirma: $('ac-c3').checked,
    });
    $('ac-anticipo').textContent = r.anticipoTexto;
    mostrar('ac-paso-listo');
  } catch (err) {
    estado('ac-firmar-estado', err.message, 'error');
    actualizarBoton();
  }
}

$('ac-pedir-codigo').addEventListener('click', pedirCodigo);
$('ac-reenviar').addEventListener('click', pedirCodigo);
$('ac-verificar').addEventListener('click', verificar);
$('ac-codigo').addEventListener('keydown', (e) => e.key === 'Enter' && verificar());
$('ac-form').addEventListener('submit', firmar);
for (const id of ['ac-c1', 'ac-c2', 'ac-c3']) $(id).addEventListener('change', actualizarBoton);
$('ac-firma').addEventListener('input', actualizarBoton);

cargar();
