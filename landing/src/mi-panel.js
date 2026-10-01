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
  vendido_pendiente: 'Vendido, sin activar',
  en_stock: 'En stock',
  inactivo: 'Inactivo',
};

const TOKEN_KEY = 'tap_panel_token';

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginStatus = document.getElementById('login-status');
const stickerList = document.getElementById('sticker-list');
const dashboardTitle = document.getElementById('dashboard-title');
const logoutButton = document.getElementById('logout-button');
const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const forgotPasswordLink = document.getElementById('forgot-password');
const resetCodeForm = document.getElementById('reset-code-form');
const resetCodeLead = document.getElementById('reset-code-lead');
const resetCodeInput = document.getElementById('reset-code');
const resetResendLink = document.getElementById('reset-resend');
const resetBackLink = document.getElementById('reset-back');
const resetPasswordForm = document.getElementById('reset-password-form');
const resetUsername = document.getElementById('reset-username');
const resetPasswordInput = document.getElementById('reset-password');
const resetPassword2Input = document.getElementById('reset-password-2');
const firstTimeLink = document.getElementById('first-time');
const resetPasswordLead = document.getElementById('reset-password-lead');
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

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}
function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
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

async function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  await Promise.all([loadStickers(), loadAccount()]);
}

// --- Cuenta: mail (solo lectura) + contraseña ---
// El mail es la identidad con la que se entra: no se edita acá. La contraseña
// se crea (si la cuenta nació en una compra, sin contraseña) o se cambia
// pidiendo la actual, como en cualquier cuenta.
let cuenta = null;

async function loadAccount() {
  try {
    cuenta = await api('/me');
    if (cuenta.nombre) dashboardTitle.textContent = `Hola, ${cuenta.nombre}`;
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

passwordAbrir.addEventListener('click', () => {
  setStatus(passwordStatus, '', '');
  passwordForm.hidden = false;
  passwordAbrir.hidden = true;
  passwordActualField.hidden = !cuenta.tienePassword;
  (cuenta.tienePassword ? passwordActualInput : passwordNuevaInput).focus();
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
  if (cuenta.tienePassword && !passwordActual) {
    setStatus(passwordStatus, 'is-error', 'Ingresá tu contraseña actual.');
    passwordActualInput.focus();
    return;
  }
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
  renderCuenta();
  setStatus(
    passwordStatus,
    'is-success',
    habia ? 'Contraseña cambiada. Cerramos tus otras sesiones.' : 'Contraseña creada. La próxima vez entrás con tu mail y contraseña.'
  );
});

// --- Login ---
// Lo estándar: mail + contraseña. "Olvidé mi contraseña" y "¿Primera vez?
// Creá tu contraseña" (las cuentas nacen en la compra, sin contraseña) son el
// mismo flujo: código al mail → contraseña nueva → adentro.

function mostrarPasoLogin(paso) {
  loginForm.hidden = paso !== 'login';
  resetCodeForm.hidden = paso !== 'codigo';
  resetPasswordForm.hidden = paso !== 'nueva';
}

function resetLogin() {
  [loginEmailInput, loginPasswordInput, resetCodeInput, resetPasswordInput, resetPassword2Input].forEach(
    (i) => (i.value = '')
  );
  setStatus(loginStatus, '', '');
  mostrarPasoLogin('login');
}

async function entrarAlPanel(data) {
  setToken(data.token);
  dashboardTitle.textContent = data.comprador?.nombre ? `Hola, ${data.comprador.nombre}` : 'Tus productos';
  setStatus(loginStatus, '', '');
  await showDashboard();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;
  if (!email || !password) {
    setStatus(loginStatus, 'is-error', 'Completá tu mail y tu contraseña.');
    (email ? loginPasswordInput : loginEmailInput).focus();
    return;
  }
  setStatus(loginStatus, '', 'Verificando...');
  try {
    const data = await api('/auth/password/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    loginPasswordInput.value = '';
    await entrarAlPanel(data);
  } catch (err) {
    // Lo más común: alguien que todavía no creó su contraseña.
    const pista = err.status === 401 ? ' Si es tu primera vez, tocá "Creá tu contraseña".' : '';
    setStatus(loginStatus, 'is-error', err.message + pista);
  }
});

let resetEmail = '';

async function enviarCodigoReset() {
  setStatus(loginStatus, '', 'Enviando código...');
  const data = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ destino: resetEmail }) });
  resetCodeLead.textContent = `Te mandamos un código de 6 dígitos a ${resetEmail}. Vence en 5 minutos.`;
  if (data.debug_otp) {
    resetCodeInput.value = data.debug_otp;
    setStatus(loginStatus, 'is-error', `MODO DEMO — el mail no está configurado. Tu código es ${data.debug_otp}.`);
  } else {
    setStatus(loginStatus, '', '');
  }
}

// modo: 'olvido' | 'primera' — solo cambia el texto del paso final.
async function iniciarReset(modo) {
  const email = loginEmailInput.value.trim();
  if (!email) {
    setStatus(loginStatus, 'is-error', 'Escribí tu mail arriba y volvé a tocar el link.');
    loginEmailInput.focus();
    return;
  }
  resetEmail = email;
  resetPasswordLead.textContent = modo === 'primera' ? 'Creá tu contraseña.' : 'Elegí tu contraseña nueva.';
  try {
    await enviarCodigoReset();
    mostrarPasoLogin('codigo');
    resetCodeInput.focus();
  } catch (err) {
    setStatus(loginStatus, 'is-error', err.message);
  }
}

forgotPasswordLink.addEventListener('click', () => iniciarReset('olvido'));
firstTimeLink.addEventListener('click', () => iniciarReset('primera'));

resetResendLink.addEventListener('click', async () => {
  try {
    await enviarCodigoReset();
    setStatus(loginStatus, 'is-success', 'Te mandamos un código nuevo.');
  } catch (err) {
    setStatus(loginStatus, 'is-error', err.message);
  }
});

resetBackLink.addEventListener('click', () => {
  setStatus(loginStatus, '', '');
  mostrarPasoLogin('login');
});

let sesionDelCodigo = null; // sesión abierta con el código, para entrar tras elegir contraseña

resetCodeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = resetCodeInput.value.trim();
  if (!code) return;
  setStatus(loginStatus, '', 'Verificando...');
  try {
    const data = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ destino: resetEmail, code }) });
    // La sesión ya está abierta (y es "reciente"): con ella se crea la
    // contraseña sin pedir la anterior.
    setToken(data.token);
    sesionDelCodigo = data;
    resetUsername.value = resetEmail;
    setStatus(loginStatus, '', '');
    mostrarPasoLogin('nueva');
    resetPasswordInput.focus();
  } catch (err) {
    setStatus(loginStatus, 'is-error', err.message);
  }
});

resetPasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = resetPasswordInput.value;
  if (password.length < 8) {
    setStatus(loginStatus, 'is-error', 'La contraseña tiene que tener al menos 8 caracteres.');
    resetPasswordInput.focus();
    return;
  }
  if (password !== resetPassword2Input.value) {
    setStatus(loginStatus, 'is-error', 'Las contraseñas no coinciden.');
    resetPassword2Input.focus();
    return;
  }
  setStatus(loginStatus, '', 'Guardando...');
  try {
    await api('/me/password', { method: 'POST', body: JSON.stringify({ password }) });
    await entrarAlPanel(sesionDelCodigo);
    resetLogin();
  } catch (err) {
    setStatus(loginStatus, 'is-error', err.message);
  }
});

logoutButton.addEventListener('click', async () => {
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
});

async function loadStickers() {
  stickerList.innerHTML = '<p class="section-lead">Cargando...</p>';
  try {
    await cargarDestinoConfig();
    const stickers = await api('/me/stickers');
    renderStickers(stickers);
  } catch (err) {
    if (err.message.includes('expirada') || err.message.includes('autenticación')) {
      clearToken();
      showLogin();
      return;
    }
    stickerList.innerHTML = `<p class="modal-status is-error">${err.message}</p>`;
  }
}

function renderStickers(stickers) {
  stickerList.innerHTML = '';
  stickers.forEach((sticker) => {
    const card = document.createElement('div');
    card.className = 'sticker-card';

    const destinoTipo = sticker.destino?.tipo ? destinoMeta(sticker.destino.tipo) : null;
    const funcionIcono = sticker.funcion || sticker.destino?.tipo || null;
    card.innerHTML = `
      <div class="sticker-card-head">
        <div class="sticker-icon">${iconoFuncion(funcionIcono)}</div>
        <div class="sticker-headinfo">
          <div class="sticker-meta">${sticker.modelo || ''} · ${ESTADO_LABELS[sticker.estado] || sticker.estado}</div>
          <div class="sticker-code">${sticker.codigoPublico}</div>
        </div>
        ${sticker.estado === 'activo' ? '<button type="button" class="btn-ghost sticker-edit-btn">Editar</button>' : ''}
      </div>
      ${
        sticker.destino
          ? `<div class="sticker-destino"><b>${destinoTipo ? destinoTipo.label : sticker.destino.tipo}:</b> ${resumenDestino(sticker.destino.tipo, sticker.destino.valor)}</div>`
          : sticker.estado === 'activo'
            ? '<div class="sticker-destino sticker-destino-empty">Todavía no configuraste a dónde redirige — elegí un destino con "Editar".</div>'
            : '<div class="sticker-destino sticker-destino-empty">Todavía no está activado — no tiene destino configurado.</div>'
      }
      <div class="sticker-edit-form modal-form" hidden></div>
    `;

    if (sticker.estado === 'activo') {
      const editButton = card.querySelector('.sticker-edit-btn');
      const editForm = card.querySelector('.sticker-edit-form');
      editButton.addEventListener('click', async () => {
        const isOpen = !editForm.hidden;
        if (isOpen) {
          editForm.hidden = true;
          editForm.innerHTML = '';
          editButton.textContent = 'Editar';
          return;
        }
        await cargarDestinoConfig();
        if (!DESTINO_TIPOS.length) {
          editForm.hidden = false;
          editForm.innerHTML = '<p class="modal-status is-error">No se pudo cargar la lista de destinos. Recargá la página.</p>';
          editButton.textContent = 'Cancelar';
          return;
        }
        editForm.hidden = false;
        editButton.textContent = 'Cancelar';
        // La función la fija el admin. Si el sticker la trae, no se muestra el
        // selector: el comprador solo carga el valor de ESA función. El stock
        // viejo sin función asignada sigue con el selector completo.
        const funcionFija = sticker.funcion || null;
        const tipoInicial = funcionFija || sticker.destino?.tipo || DESTINO_TIPOS[0].id;
        const metaInicial = destinoMeta(tipoInicial);
        // Con función fija se listan todas las opciones (así el comprador ve
        // qué otras funciones existen) pero solo la propia queda seleccionable:
        // el resto va con `disabled` para que el navegador las muestre en gris
        // y no se puedan elegir.
        const selectorTipo = funcionFija
          ? `<label>
              <span>Función</span>
              <select class="edit-tipo edit-tipo-fija">
                ${DESTINO_TIPOS.map((t) => `<option value="${t.id}" ${t.id === funcionFija ? 'selected' : 'disabled'}>${t.label}</option>`).join('')}
              </select>
            </label>`
          : `<label>
              <span>Tipo de destino</span>
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
            <input type="text" class="edit-valor" value="${escaparAttr(sticker.destino?.valor || '')}" placeholder="${escaparAttr(metaInicial.placeholder)}">
            <small class="field-hint edit-valor-hint"${metaInicial.ayuda ? '' : ' hidden'}>${metaInicial.ayuda}</small>
          </label>`;
        editForm.innerHTML = `
          ${selectorTipo}
          ${cuerpoValor}
          <button type="button" class="btn-primary modal-submit edit-save-btn">Guardar</button>
          <p class="modal-status edit-status"></p>
        `;

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

        editForm.querySelector('.edit-save-btn').addEventListener('click', async () => {
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
              status.className = 'modal-status is-error';
              status.textContent = `Completá: ${faltan.map((c) => c.label).join(', ')}.`;
              return;
            }
            valor = JSON.stringify(obj);
          } else {
            valor = editForm.querySelector('.edit-valor').value.trim();
            if (!valor) {
              status.className = 'modal-status is-error';
              status.textContent = 'Completá el valor del destino.';
              return;
            }
          }
          status.className = 'modal-status';
          status.textContent = 'Guardando...';
          try {
            const updated = await api(`/stickers/${sticker.id}/destino`, {
              method: 'PATCH',
              body: JSON.stringify({ tipo, valor }),
            });
            sticker.destino = updated;
            status.className = 'modal-status is-success';
            status.textContent = 'Guardado.';
            setTimeout(() => loadStickers(), 700);
          } catch (err) {
            status.className = 'modal-status is-error';
            status.textContent = err.message;
          }
        });
      });
    }

    stickerList.appendChild(card);
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

// Si ya había una sesión activa (misma pestaña) o Google nos acaba de loguear, entramos directo.
if (getToken()) {
  showDashboard().catch(() => showLogin());
} else {
  showLogin();
}
