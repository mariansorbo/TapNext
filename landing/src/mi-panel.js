import './styles.css';
import { applyBrand } from './brand.js';
import { BRAND_ICONS } from './brand-icons.js';

applyBrand('Mi panel');

// Mismo mapeo función → ícono de marca que usa el wizard de compra (comprar.js).
const FUNCION_ICONOS = {
  whatsapp: BRAND_ICONS.whatsapp,
  instagram: BRAND_ICONS.instagram,
  pago: BRAND_ICONS.mercadopago,
  menu: BRAND_ICONS.menu,
  review: BRAND_ICONS.googleMaps,
  web: BRAND_ICONS.web,
  agenda: BRAND_ICONS.googleCalendar,
  linktree: BRAND_ICONS.linktree,
  alias: BRAND_ICONS.alias,
};
const ICONO_GENERICO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="8" fill="rgba(255,255,255,0.08)"/>
  <circle cx="16" cy="13" r="4" stroke="currentColor" stroke-width="1.6" opacity="0.6"/>
  <path d="M8 24c1.5-4 5-6 8-6s6.5 2 8 6" stroke="currentColor" stroke-width="1.6" opacity="0.6"/>
</svg>`;
const iconoFuncion = (tipo) => FUNCION_ICONOS[tipo] || ICONO_GENERICO;

// La lista de destinos (label/campo/placeholder/ayuda por tipo) es del backend:
// el registry de `server/destinos/` es la única fuente de verdad. Ver
// /api/auth/config. Si no carga, el formulario de edición avisa y no se abre.
let DESTINO_TIPOS = [];
const destinoMeta = (id) => DESTINO_TIPOS.find((t) => t.id === id) || { id, label: id, campo: 'Valor', placeholder: '', ayuda: '' };

const escaparAttr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Cómo se muestra el valor guardado en la tarjeta. Casi siempre es el valor
// tal cual; para funciones multi-campo (alias) el valor es un JSON, así que
// armamos un resumen legible.
function resumenDestino(tipo, valor) {
  const meta = destinoMeta(tipo);
  if (!meta.campos) return valor;
  try {
    const d = JSON.parse(valor) || {};
    return [d.alias, d.titular].filter(Boolean).join(' · ') || valor;
  } catch {
    return valor;
  }
}

let destinoConfigCargada = false;
async function cargarDestinoConfig() {
  if (destinoConfigCargada) return;
  try {
    const res = await fetch(`${API_BASE}/api/auth/config`);
    const data = await res.json();
    if (Array.isArray(data.destinos) && data.destinos.length) {
      DESTINO_TIPOS = data.destinos;
      destinoConfigCargada = true;
    }
  } catch {
    /* reintenta en la próxima apertura del formulario */
  }
}
const ESTADO_LABELS = {
  activo: 'Activo',
  vendido_pendiente: 'Pago en proceso',
  en_stock: 'Sin activar',
  inactivo: 'Sin activar',
};

// WhatsApp de contacto (el mismo de los TyC) para cuando algo no cierra.
const WHATSAPP_AYUDA = 'https://wa.me/541171082780';

const TOKEN_KEY = 'tap_panel_token';
// Último mail con el que se entró: prellena el login la próxima vez.
const ULTIMO_EMAIL_KEY = 'tap_ultimo_email';

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginStatus = document.getElementById('login-status');
const stickerList = document.getElementById('sticker-list');
const dashboardTitle = document.getElementById('dashboard-title');
const logoutButton = document.getElementById('logout-button');
const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const codeForm = document.getElementById('code-form');
const codeLead = document.getElementById('code-lead');
const loginCodeInput = document.getElementById('login-code');
const codeResendLink = document.getElementById('code-resend');
const toPasswordLink = document.getElementById('to-password');
const passwordLoginForm = document.getElementById('password-login-form');
const passwordLoginEmail = document.getElementById('password-login-email');
const passwordLoginUsername = document.getElementById('password-login-username');
const loginPasswordInput = document.getElementById('login-password');
const toCodeLink = document.getElementById('to-code');
const passwordSugerencia = document.getElementById('password-sugerencia');
const sugerenciaCrear = document.getElementById('sugerencia-crear');
const sugerenciaCerrar = document.getElementById('sugerencia-cerrar');
const accountBox = document.getElementById('account-box');
const accountEmailEl = document.getElementById('account-email');
const accountVerifiedEl = document.getElementById('account-verified');
const passwordLead = document.getElementById('password-lead');
const passwordForm = document.getElementById('password-form');
const passwordUsername = document.getElementById('password-username');
const passwordActualField = document.getElementById('password-actual-field');
const passwordActualInput = document.getElementById('password-actual');
const passwordNuevaInput = document.getElementById('password-nueva');
const passwordRepetirInput = document.getElementById('password-repetir');
const reauthField = document.getElementById('reauth-field');
const reauthOtpInput = document.getElementById('reauth-otp');
const passwordCancelar = document.getElementById('password-cancelar');
const passwordAbrir = document.getElementById('password-abrir');
const passwordStatus = document.getElementById('password-status');
const googleDivider = document.getElementById('google-divider');
const googleButton = document.getElementById('google-login-button');

// El token vive en localStorage: así abrir el panel desde otra pestaña (o
// desde el link del mail) no pide volver a entrar. El server igual corta la
// sesión tras 30 min sin uso. Se sigue leyendo sessionStorage porque el
// wizard de compra (comprar.js) guarda ahí el token antes de mandarnos acá.
function storage(tipo) {
  try {
    return window[tipo];
  } catch {
    return null;
  }
}
function getToken() {
  try {
    return storage('localStorage')?.getItem(TOKEN_KEY) || storage('sessionStorage')?.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}
function setToken(token) {
  try {
    storage('localStorage')?.setItem(TOKEN_KEY, token);
    storage('sessionStorage')?.setItem(TOKEN_KEY, token);
  } catch {
    /* sin storage: la sesión dura lo que la página */
  }
}
function clearToken() {
  try {
    storage('localStorage')?.removeItem(TOKEN_KEY);
    storage('sessionStorage')?.removeItem(TOKEN_KEY);
  } catch {
    /* nada */
  }
}
function recordarEmail(email) {
  try {
    if (email) storage('localStorage')?.setItem(ULTIMO_EMAIL_KEY, email);
  } catch {
    /* nada */
  }
}
// Mail que en este navegador entra con contraseña: el login arranca ahí.
const USA_PASSWORD_KEY = 'tap_usa_password';
function marcarUsaPassword(email) {
  try {
    if (email) storage('localStorage')?.setItem(USA_PASSWORD_KEY, email.toLowerCase());
  } catch {
    /* nada */
  }
}
function usaPassword(email) {
  try {
    return storage('localStorage')?.getItem(USA_PASSWORD_KEY) === String(email).toLowerCase();
  } catch {
    return false;
  }
}
function ultimoEmail() {
  try {
    return storage('localStorage')?.getItem(ULTIMO_EMAIL_KEY) || '';
  } catch {
    return '';
  }
}

// En local, /api va por el proxy de Vite hacia localhost:3001. En producción, el
// frontend y la API viven en dominios separados (ej. Vercel + Render), así que
// VITE_API_BASE tiene que apuntar a la URL pública de la API.
const API_BASE = import.meta.env.VITE_API_BASE || '';

async function api(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Error de conexión con el servidor.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function setStatus(el, clase, texto) {
  el.className = `modal-status${clase ? ` ${clase}` : ''}`;
  el.textContent = texto;
}

function showLogin() {
  loginView.hidden = false;
  dashboardView.hidden = true;
}

// sugerirPassword: recién entró por código y quizás no tiene contraseña →
// después de mostrarle sus productos, le ofrecemos crearla (opcional).
async function showDashboard({ sugerirPassword = false } = {}) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  passwordSugerencia.hidden = true;
  window.scrollTo(0, 0);
  await Promise.all([loadStickers(), loadAccount()]);
  // Productos y cuenta se cargan en paralelo: el aviso de "sin productos"
  // muestra el mail, que recién ahora seguro está.
  if (stickerList.querySelector('.sticker-vacio')) renderVacio();
  sugerenciaPendiente = sugerirPassword;
  mostrarSugerenciaPassword();
}

// La sugerencia de contraseña no compite con "Configurar ahora": si hay algún
// producto sin destino, espera a que lo guarde. Sin productos, no se muestra.
let sugerenciaPendiente = false;
function mostrarSugerenciaPassword() {
  const mostrar =
    sugerenciaPendiente &&
    cuenta?.email &&
    !cuenta.tienePassword &&
    stickerList.querySelector('.sticker-card:not(.sticker-vacio)') &&
    !stickerList.querySelector('.is-pendiente');
  passwordSugerencia.hidden = !mostrar;
}

// --- Cuenta: mail (solo lectura) + contraseña ---
// El mail es la identidad con la que se entra: no se edita acá. La contraseña
// se crea (si la cuenta nació en una compra, sin contraseña) o se cambia
// pidiendo la actual, como en cualquier cuenta.
let cuenta = null;

async function loadAccount() {
  try {
    cuenta = await api('/me');
    dashboardTitle.textContent = saludo(cuenta.nombre);
    recordarEmail(cuenta.email);
    renderCuenta();
  } catch {
    // no es crítico para ver los stickers
    accountBox.hidden = true;
  }
}

function renderCuenta() {
  if (!cuenta?.email) {
    accountBox.hidden = true;
    return;
  }
  accountBox.hidden = false;
  accountEmailEl.textContent = cuenta.email;
  accountVerifiedEl.hidden = !cuenta.emailVerificado;
  passwordUsername.value = cuenta.email;
  passwordLead.textContent = cuenta.tienePassword
    ? ''
    : 'Todavía no tenés contraseña. Creala para entrar con tu mail y contraseña.';
  passwordLead.hidden = cuenta.tienePassword;
  passwordAbrir.textContent = cuenta.tienePassword ? 'Cambiar contraseña' : 'Crear contraseña';
  cerrarFormPassword();
}

function cerrarFormPassword() {
  passwordForm.hidden = true;
  passwordAbrir.hidden = false;
  reauthField.hidden = true;
  [passwordActualInput, passwordNuevaInput, passwordRepetirInput, reauthOtpInput].forEach((i) => (i.value = ''));
}

function abrirFormPassword() {
  sugerenciaPendiente = false;
  setStatus(passwordStatus, '', '');
  passwordSugerencia.hidden = true;
  passwordForm.hidden = false;
  passwordAbrir.hidden = true;
  passwordActualField.hidden = !cuenta.tienePassword;
  passwordForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  (cuenta.tienePassword ? passwordActualInput : passwordNuevaInput).focus({ preventScroll: true });
}
passwordAbrir.addEventListener('click', abrirFormPassword);
sugerenciaCrear.addEventListener('click', abrirFormPassword);
sugerenciaCerrar.addEventListener('click', () => {
  sugerenciaPendiente = false;
  passwordSugerencia.hidden = true;
});
passwordCancelar.addEventListener('click', () => {
  setStatus(passwordStatus, '', '');
  cerrarFormPassword();
});

// Crear la primera contraseña sin pedir nada solo vale con una sesión recién
// abierta por código. Si la sesión es vieja, el server contesta needsReauth:
// mandamos un código al mail, se ingresa y se reintenta.
async function pedirCodigoReauth() {
  const data = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ destino: cuenta.email }) });
  reauthField.hidden = false;
  if (data.debug_otp) reauthOtpInput.value = data.debug_otp;
  reauthOtpInput.focus();
}

async function reauthSiHayCodigo() {
  const code = reauthOtpInput.value.trim();
  if (reauthField.hidden || !code) return;
  const data = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ destino: cuenta.email, code }) });
  setToken(data.token);
  reauthField.hidden = true;
  reauthOtpInput.value = '';
}

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const passwordActual = passwordActualInput.value;
  const password = passwordNuevaInput.value;
  if (password.length < 8) {
    setStatus(passwordStatus, 'is-error', 'La contraseña tiene que tener al menos 8 caracteres.');
    passwordNuevaInput.focus();
    return;
  }
  if (password !== passwordRepetirInput.value) {
    setStatus(passwordStatus, 'is-error', 'Las contraseñas no coinciden.');
    passwordRepetirInput.focus();
    return;
  }
  setStatus(passwordStatus, '', 'Guardando...');
  const habia = cuenta.tienePassword;
  try {
    await reauthSiHayCodigo();
    await api('/me/password', { method: 'POST', body: JSON.stringify({ password, passwordActual }) });
  } catch (err) {
    if (err.data?.needsReauth) {
      try {
        await pedirCodigoReauth();
        setStatus(passwordStatus, '', `Por seguridad te mandamos un código a ${cuenta.email}. Ingresalo y volvé a tocar "Guardar contraseña".`);
      } catch (e2) {
        setStatus(passwordStatus, 'is-error', e2.message);
      }
      return;
    }
    setStatus(passwordStatus, 'is-error', err.message);
    return;
  }
  cuenta.tienePassword = true;
  marcarUsaPassword(cuenta.email);
  renderCuenta();
  setStatus(
    passwordStatus,
    'is-success',
    habia ? 'Contraseña cambiada. Cerramos tus otras sesiones.' : 'Contraseña creada. La próxima vez entrás con tu mail y contraseña.'
  );
});

// --- Login ---
// Dos pantallas: 1) el mail → 2) el código que le mandamos → adentro. Las
// cuentas nacen en la compra sin contraseña, así que el código es el camino
// de todos (y también el "me olvidé la contraseña"). Quien creó contraseña
// tiene el link "Entrar con contraseña"; si en este navegador ya entró así,
// arranca directo en esa pantalla.

function saludo(nombre) {
  const primero = String(nombre || '').trim().split(/\s+/)[0];
  return primero ? `Hola, ${primero}` : 'Hola';
}

function mostrarPasoLogin(paso) {
  loginForm.hidden = paso !== 'mail';
  codeForm.hidden = paso !== 'codigo';
  passwordLoginForm.hidden = paso !== 'password';
  setStatus(loginStatus, '', '');
}

function irAPassword(email) {
  loginEmail = email;
  passwordLoginEmail.textContent = email;
  passwordLoginUsername.value = email;
  loginPasswordInput.value = '';
  mostrarPasoLogin('password');
  loginPasswordInput.focus();
}

// Pantalla inicial: si este navegador recuerda un mail que entra con
// contraseña, directo a la contraseña; si no, al mail.
function resetLogin() {
  [loginPasswordInput, loginCodeInput].forEach((i) => (i.value = ''));
  const email = ultimoEmail();
  loginEmailInput.value = email;
  if (email && usaPassword(email)) {
    irAPassword(email);
  } else {
    mostrarPasoLogin('mail');
  }
}

async function entrarAlPanel(data, opciones) {
  setToken(data.token);
  recordarEmail(data.comprador?.email || loginEmail);
  dashboardTitle.textContent = saludo(data.comprador?.nombre);
  setStatus(loginStatus, '', '');
  await showDashboard(opciones);
}

let loginEmail = '';

async function enviarCodigo() {
  setStatus(loginStatus, '', 'Enviando código...');
  const data = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ destino: loginEmail }) });
  codeLead.textContent = 'Te mandamos un código de 6 dígitos a ';
  const mail = document.createElement('b');
  mail.textContent = loginEmail;
  codeLead.append(mail, '. Vence en 5 minutos.');
  if (data.debug_otp) {
    loginCodeInput.value = data.debug_otp;
    setStatus(loginStatus, 'is-error', `MODO DEMO — el mail no está configurado. Tu código es ${data.debug_otp}.`);
  } else {
    setStatus(loginStatus, '', '');
  }
}

async function irACodigo() {
  const mostrar = () => {
    codeForm.hidden = false;
    loginForm.hidden = true;
    passwordLoginForm.hidden = true;
    loginCodeInput.focus();
  };
  try {
    loginCodeInput.value = '';
    await enviarCodigo();
    mostrar();
  } catch (err) {
    if (err.status === 429 && !/intentos/i.test(err.message)) {
      // Pidió otro hace segundos (volvió atrás y adelante): el anterior sirve.
      codeLead.textContent = 'Ya te mandamos un código a ';
      const mail = document.createElement('b');
      mail.textContent = loginEmail;
      codeLead.append(mail, ' hace un momento. Usá ese.');
      mostrar();
      setStatus(loginStatus, '', '');
      return;
    }
    setStatus(loginStatus, 'is-error', err.message);
  }
}

// Pantalla 1 → 2.
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginEmailInput.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setStatus(loginStatus, 'is-error', 'Escribí tu mail completo, por ejemplo nombre@gmail.com.');
    loginEmailInput.focus();
    return;
  }
  loginEmail = email;
  await irACodigo();
});

codeResendLink.addEventListener('click', async () => {
  try {
    await enviarCodigo();
    setStatus(loginStatus, 'is-success', 'Te mandamos un código nuevo.');
  } catch (err) {
    setStatus(loginStatus, 'is-error', err.message);
  }
});

document.querySelectorAll('[data-otro-mail]').forEach((b) =>
  b.addEventListener('click', () => {
    loginCodeInput.value = '';
    loginPasswordInput.value = '';
    loginEmailInput.value = loginEmail;
    mostrarPasoLogin('mail');
    loginEmailInput.focus();
    loginEmailInput.select();
  })
);

toPasswordLink.addEventListener('click', () => irAPassword(loginEmail));
toCodeLink.addEventListener('click', () => irACodigo());

let verificandoCodigo = false;

async function verificarCodigo() {
  const code = loginCodeInput.value.replace(/\D/g, '');
  if (code.length !== 6) {
    setStatus(loginStatus, 'is-error', 'El código tiene 6 números.');
    loginCodeInput.focus();
    return;
  }
  if (verificandoCodigo) return;
  verificandoCodigo = true;
  setStatus(loginStatus, '', 'Verificando...');
  try {
    const data = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ destino: loginEmail, code }) });
    await entrarAlPanel(data, { sugerirPassword: true });
    resetLogin();
  } catch (err) {
    setStatus(loginStatus, 'is-error', err.message);
    loginCodeInput.select();
  } finally {
    verificandoCodigo = false;
  }
}

codeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  verificarCodigo();
});
// Solo números; con el 6º dígito (tipeado o pegado) entra solo.
loginCodeInput.addEventListener('input', () => {
  const limpio = loginCodeInput.value.replace(/\D/g, '').slice(0, 6);
  if (limpio !== loginCodeInput.value) loginCodeInput.value = limpio;
  if (limpio.length === 6) verificarCodigo();
});

passwordLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = loginPasswordInput.value;
  if (!password) {
    setStatus(loginStatus, 'is-error', 'Escribí tu contraseña.');
    loginPasswordInput.focus();
    return;
  }
  setStatus(loginStatus, '', 'Verificando...');
  try {
    const data = await api('/auth/password/login', {
      method: 'POST',
      body: JSON.stringify({ email: loginEmail, password }),
    });
    loginPasswordInput.value = '';
    marcarUsaPassword(loginEmail);
    await entrarAlPanel(data);
    resetLogin();
  } catch (err) {
    const pista = err.status === 401 ? ' Si no te acordás, pedí un código.' : '';
    setStatus(loginStatus, 'is-error', err.message + pista);
    loginPasswordInput.select();
  }
});

async function cerrarSesion() {
  try {
    await api('/auth/session', { method: 'DELETE' });
  } catch {
    // sigue el logout local aunque falle el pedido al server
  }
  clearToken();
  resetLogin();
  cuenta = null;
  accountBox.hidden = true;
  setStatus(passwordStatus, '', '');
  showLogin();
  window.scrollTo(0, 0);
}
logoutButton.addEventListener('click', cerrarSesion);

// Sesión vencida o inválida → al login, explicando por qué.
function sesionVencida() {
  clearToken();
  cuenta = null;
  resetLogin();
  showLogin();
  setStatus(loginStatus, 'is-error', 'Tu sesión se cerró por inactividad. Entrá de nuevo.');
}

async function loadStickers() {
  stickerList.innerHTML = '<p class="section-lead">Cargando tus productos...</p>';
  try {
    await cargarDestinoConfig();
    const stickers = await api('/me/stickers');
    renderStickers(stickers);
  } catch (err) {
    if (err.status === 401) {
      sesionVencida();
      return;
    }
    stickerList.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'modal-status is-error';
    p.textContent = err.message;
    stickerList.appendChild(p);
  }
}

const escaparHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// El valor guardado, en criollo: sin https://, WhatsApp como número,
// Instagram como @usuario. Es solo para mostrar.
function destinoLegible(tipo, valor) {
  const resumen = resumenDestino(tipo, valor);
  if (resumen !== valor) return resumen;
  const sinProtocolo = String(valor || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  const wa = sinProtocolo.match(/^(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?\+?(\d+)/i);
  if (wa) return `+${wa[1]}`;
  const ig = sinProtocolo.match(/^instagram\.com\/([^/?#]+)/i);
  if (ig) return `@${ig[1]}`;
  return sinProtocolo;
}

function renderVacio() {
  const email = cuenta?.email || '';
  stickerList.innerHTML = `
    <div class="sticker-card sticker-vacio">
      <p><b>No encontramos productos en esta cuenta.</b></p>
      <p class="sticker-vacio-texto">Estás con <b class="sticker-vacio-email"></b>. Si lo compraste o lo activaste con otro mail, entrá con ese.</p>
      <div class="sticker-actions">
        <button type="button" class="btn-primary sticker-vacio-otro">Entrar con otro mail</button>
        <a class="btn-ghost" href="${WHATSAPP_AYUDA}" target="_blank" rel="noopener">Escribinos por WhatsApp</a>
      </div>
    </div>`;
  stickerList.querySelector('.sticker-vacio-email').textContent = email || 'este mail';
  stickerList.querySelector('.sticker-vacio-otro').addEventListener('click', cerrarSesion);
}

function renderStickers(stickers) {
  stickerList.innerHTML = '';
  if (!stickers.length) {
    renderVacio();
    return;
  }
  const sinConfigurar = stickers.filter((s) => s.estado === 'activo' && !s.destino);
  stickers.forEach((sticker) => {
    const card = crearTarjeta(sticker);
    stickerList.appendChild(card);
  });
  // Un solo producto sin destino: abrimos el formulario directo, es lo único
  // que tiene para hacer.
  if (sinConfigurar.length === 1 && stickers.length === 1) {
    const card = stickerList.querySelector('.sticker-card');
    abrirEdicion(card, sinConfigurar[0], { enfocar: false });
  }
}

function crearTarjeta(sticker) {
  const card = document.createElement('div');
  const activo = sticker.estado === 'activo';
  const falta = activo && !sticker.destino;
  card.className = `sticker-card${falta ? ' is-pendiente' : ''}`;

  const destinoTipo = sticker.destino?.tipo ? destinoMeta(sticker.destino.tipo) : null;
  const funcionIcono = sticker.funcion || sticker.destino?.tipo || null;
  const modelo = sticker.modelo ? sticker.modelo.charAt(0).toUpperCase() + sticker.modelo.slice(1) : 'Producto';
  const pill = falta
    ? '<span class="sticker-pill is-falta">Falta configurar</span>'
    : `<span class="sticker-pill${activo ? ' is-ok' : ''}">${ESTADO_LABELS[sticker.estado] || sticker.estado}</span>`;

  let cuerpo;
  if (sticker.destino) {
    cuerpo = `
      <div class="sticker-destino">
        <span class="sticker-destino-label">Cuando lo tocan con el celular, abre:</span>
        <span class="sticker-destino-valor"><b>${escaparHtml(destinoTipo ? destinoTipo.label : sticker.destino.tipo)}</b> · ${escaparHtml(destinoLegible(sticker.destino.tipo, sticker.destino.valor))}</span>
      </div>`;
  } else if (activo) {
    cuerpo = `<div class="sticker-destino sticker-destino-empty">Todavía no le dijiste a dónde llevar. Configuralo y queda listo para usar.</div>`;
  } else if (sticker.estado === 'vendido_pendiente') {
    cuerpo = `<div class="sticker-destino sticker-destino-empty">Estamos confirmando el pago. En unos minutos vas a poder configurarlo desde acá.</div>`;
  } else {
    cuerpo = `<div class="sticker-destino sticker-destino-empty">Todavía no está activado.</div>`;
  }

  card.innerHTML = `
    <div class="sticker-card-head">
      <div class="sticker-icon">${iconoFuncion(funcionIcono)}</div>
      <div class="sticker-headinfo">
        <div class="sticker-meta">${escaparHtml(modelo)}</div>
        <div class="sticker-code">Código ${escaparHtml(sticker.codigoPublico)}</div>
      </div>
      ${pill}
    </div>
    ${cuerpo}
    ${activo ? `<button type="button" class="${falta ? 'btn-primary' : 'btn-ghost'} sticker-edit-btn">${falta ? 'Configurar ahora' : 'Editar a dónde lleva'}</button>` : ''}
    <div class="sticker-edit-form modal-form" hidden></div>
    <p class="modal-status sticker-guardado"></p>
  `;

  if (activo) {
    const editButton = card.querySelector('.sticker-edit-btn');
    editButton.addEventListener('click', () => abrirEdicion(card, sticker));
  }
  return card;
}

function cerrarEdicion(card) {
  const editForm = card.querySelector('.sticker-edit-form');
  editForm.hidden = true;
  editForm.innerHTML = '';
  card.querySelector('.sticker-edit-btn').hidden = false;
}

// enfocar: false cuando se abre solo (al entrar): no le saltamos el teclado.
async function abrirEdicion(card, sticker, { enfocar = true } = {}) {
  const editButton = card.querySelector('.sticker-edit-btn');
  const editForm = card.querySelector('.sticker-edit-form');
  setStatus(card.querySelector('.sticker-guardado'), '', '');
  await cargarDestinoConfig();
  editButton.hidden = true;
  editForm.hidden = false;
  if (!DESTINO_TIPOS.length) {
    editForm.innerHTML = `
      <p class="modal-status is-error">No se pudo cargar la lista de destinos. Recargá la página.</p>
      <button type="button" class="btn-ghost edit-cancel-btn">Cerrar</button>`;
    editForm.querySelector('.edit-cancel-btn').addEventListener('click', () => cerrarEdicion(card));
    return;
  }
  // La función la fija el admin. Si el sticker la trae, el comprador solo
  // carga el valor de ESA función (se muestra como dato, no como selector).
  // El stock viejo sin función asignada sigue con el selector completo.
  const funcionFija = sticker.funcion || null;
  const tipoInicial = funcionFija || sticker.destino?.tipo || DESTINO_TIPOS[0].id;
  const metaInicial = destinoMeta(tipoInicial);
  const selectorTipo = funcionFija
    ? `<input type="hidden" class="edit-tipo" value="${escaparAttr(funcionFija)}">
       <p class="edit-funcion">Este producto abre <b>${escaparHtml(metaInicial.label)}</b>.</p>`
    : `<label>
        <span>¿Qué querés que abra?</span>
        <select class="edit-tipo">
          ${DESTINO_TIPOS.map((t) => `<option value="${t.id}" ${tipoInicial === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </label>`;
  // Funciones multi-campo (alias): un input por campo, prellenado desde el
  // JSON guardado. El resto sigue con el único input de siempre.
  const campos = metaInicial.campos || null;
  let datosGuardados = {};
  if (campos) {
    try {
      datosGuardados = JSON.parse(sticker.destino?.valor || '{}') || {};
    } catch {
      datosGuardados = {};
    }
  }
  const cuerpoValor = campos
    ? campos
        .map(
          (c) => `
      <label>
        <span>${c.label}</span>
        <input type="text" class="edit-campo" data-key="${c.key}" value="${escaparAttr(datosGuardados[c.key] ?? '')}" placeholder="${escaparAttr(c.placeholder || '')}" autocomplete="off">
        ${c.ayuda ? `<small class="field-hint">${c.ayuda}</small>` : ''}
      </label>`
        )
        .join('')
    : `
      <label>
        <span class="edit-valor-label">${metaInicial.campo}</span>
        <input type="text" class="edit-valor" value="${escaparAttr(sticker.destino?.valor || '')}" placeholder="${escaparAttr(metaInicial.placeholder)}" autocomplete="off">
        <small class="field-hint edit-valor-hint"${metaInicial.ayuda ? '' : ' hidden'}>${metaInicial.ayuda}</small>
      </label>`;
  editForm.innerHTML = `
    ${selectorTipo}
    ${cuerpoValor}
    <div class="sticker-actions">
      <button type="button" class="btn-primary edit-save-btn">Guardar</button>
      <button type="button" class="btn-ghost edit-cancel-btn">Cancelar</button>
    </div>
    <p class="modal-status edit-status"></p>
  `;
  if (enfocar) {
    editForm.querySelector('.edit-valor, .edit-campo')?.focus({ preventScroll: true });
    editForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Al cambiar la función (solo stock viejo sin función fija), el campo de
  // valor cambia de etiqueta/ejemplo.
  const tipoSel = editForm.querySelector('.edit-tipo');
  const valorLabel = editForm.querySelector('.edit-valor-label');
  const valorInput = editForm.querySelector('.edit-valor');
  const valorHint = editForm.querySelector('.edit-valor-hint');
  if (!campos && tipoSel.tagName === 'SELECT') {
    tipoSel.addEventListener('change', () => {
      const m = destinoMeta(tipoSel.value);
      valorLabel.textContent = m.campo;
      valorInput.placeholder = m.placeholder;
      valorHint.textContent = m.ayuda || '';
      valorHint.hidden = !m.ayuda;
    });
  }

  editForm.querySelector('.edit-cancel-btn').addEventListener('click', () => cerrarEdicion(card));
  editForm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      editForm.querySelector('.edit-save-btn').click();
    }
  });

  const saveBtn = editForm.querySelector('.edit-save-btn');
  saveBtn.addEventListener('click', async () => {
    const tipo = editForm.querySelector('.edit-tipo').value;
    const status = editForm.querySelector('.edit-status');
    let valor;
    if (campos) {
      const obj = {};
      editForm.querySelectorAll('.edit-campo').forEach((inp) => {
        obj[inp.dataset.key] = inp.value.trim();
      });
      const faltan = campos.filter((c) => c.requerido && !obj[c.key]);
      if (faltan.length) {
        setStatus(status, 'is-error', `Completá: ${faltan.map((c) => c.label).join(', ')}.`);
        return;
      }
      valor = JSON.stringify(obj);
    } else {
      valor = editForm.querySelector('.edit-valor').value.trim();
      if (!valor) {
        setStatus(status, 'is-error', 'Completá este campo para guardar.');
        editForm.querySelector('.edit-valor').focus();
        return;
      }
    }
    setStatus(status, '', 'Guardando...');
    saveBtn.disabled = true;
    try {
      const updated = await api(`/stickers/${sticker.id}/destino`, {
        method: 'PATCH',
        body: JSON.stringify({ tipo, valor }),
      });
      const nuevo = crearTarjeta({ ...sticker, destino: updated });
      card.replaceWith(nuevo);
      setStatus(nuevo.querySelector('.sticker-guardado'), 'is-success', '✓ Guardado. Ya funciona con el destino nuevo.');
      mostrarSugerenciaPassword();
    } catch (err) {
      saveBtn.disabled = false;
      if (err.status === 401) {
        sesionVencida();
        return;
      }
      setStatus(status, 'is-error', err.message);
    }
  });
}

// Login con Google — opcional, se muestra solo si el backend tiene credenciales cargadas.
async function checkGoogleLogin() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/config`);
    const data = await res.json();
    googleButton.hidden = !data.googleEnabled;
    googleDivider.hidden = !data.googleEnabled;
  } catch {
    googleButton.hidden = true;
    googleDivider.hidden = true;
  }
}
googleButton.addEventListener('click', () => {
  window.location.href = `${API_BASE}/api/auth/google/start`;
});

// Google nos redirige de vuelta acá con ?token=... (login ok) o ?google_error=....
const params = new URLSearchParams(window.location.search);
const googleToken = params.get('token');
const googleError = params.get('google_error');
if (googleToken || googleError) {
  window.history.replaceState({}, '', window.location.pathname);
}
if (googleToken) {
  setToken(googleToken);
} else if (googleError) {
  loginStatus.className = 'modal-status is-error';
  loginStatus.textContent =
    googleError === 'not_configured'
      ? 'Login con Google todavía no está configurado.'
      : googleError === 'email_no_verificado'
        ? 'Tu cuenta de Google no tiene el mail verificado. Entrá con un código por mail.'
        : 'No se pudo iniciar sesión con Google. Probá de nuevo.';
}

checkGoogleLogin();

// Si ya había una sesión activa o Google / la activación nos acaba de loguear, entramos directo.
if (getToken()) {
  showDashboard({ sugerirPassword: Boolean(googleToken) }).catch(() => showLogin());
} else {
  resetLogin();
  showLogin();
}
