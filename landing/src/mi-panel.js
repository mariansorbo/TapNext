import './styles.css';
import { applyBrand } from './brand.js';

applyBrand('Mi panel');

// Fallback si el backend no devuelve la config de destinos (versión vieja).
// El backend manda label/campo/placeholder/ayuda por tipo — ver /api/auth/config.
const DESTINO_TIPOS_FALLBACK = [
  { id: 'whatsapp', label: 'WhatsApp', campo: 'Número de WhatsApp', placeholder: '11 2233 4455', ayuda: 'Con característica, sin el 0 ni el 15.' },
  { id: 'instagram', label: 'Instagram', campo: 'Usuario de Instagram', placeholder: 'tunegocio', ayuda: 'Solo tu usuario, sin @ ni el link completo.' },
  { id: 'pago', label: 'Link de pago', campo: 'Link de pago', placeholder: 'link.mercadopago.com.ar/tunegocio', ayuda: '' },
  { id: 'menu', label: 'Menú / carta', campo: 'Link del menú', placeholder: 'tunegocio.com/menu', ayuda: '' },
  { id: 'review', label: 'Reseñas', campo: 'Link para dejar reseña', placeholder: 'g.page/r/...', ayuda: '' },
  { id: 'web', label: 'Web propia', campo: 'Tu sitio web', placeholder: 'tunegocio.com', ayuda: 'Le agregamos https:// solo.' },
  { id: 'agenda', label: 'Agenda / turnos', campo: 'Link de tu agenda', placeholder: 'calendly.com/tunegocio', ayuda: '' },
  { id: 'linktree', label: 'Linktree', campo: 'Usuario de Linktree', placeholder: 'tunegocio', ayuda: 'Solo tu usuario, sin el link completo.' },
];
let DESTINO_TIPOS = DESTINO_TIPOS_FALLBACK;
const destinoMeta = (id) => DESTINO_TIPOS.find((t) => t.id === id) || { id, label: id, campo: 'Valor', placeholder: '', ayuda: '' };

let destinoConfigCargada = false;
async function cargarDestinoConfig() {
  if (destinoConfigCargada) return;
  try {
    const res = await fetch(`${API_BASE}/api/auth/config`);
    const data = await res.json();
    if (Array.isArray(data.destinos) && data.destinos.length) DESTINO_TIPOS = data.destinos;
  } catch {
    /* nos quedamos con el fallback */
  }
  destinoConfigCargada = true;
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
const loginWhatsapp = document.getElementById('login-whatsapp');
const sendOtpButton = document.getElementById('send-login-otp');
const otpField = document.getElementById('login-otp-field');
const otpInput = document.getElementById('login-otp');
const confirmOtpButton = document.getElementById('confirm-login-otp');
const loginStatus = document.getElementById('login-status');
const stickerList = document.getElementById('sticker-list');
const dashboardTitle = document.getElementById('dashboard-title');
const logoutButton = document.getElementById('logout-button');
const accountEmailInput = document.getElementById('account-email');
const saveEmailButton = document.getElementById('save-email');
const emailStatus = document.getElementById('email-status');
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
  if (!res.ok) throw new Error(data.error || 'Error de conexión con el servidor.');
  return data;
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

async function loadAccount() {
  try {
    const me = await api('/me');
    accountEmailInput.value = me.email || '';
    if (me.nombre) dashboardTitle.textContent = `Hola, ${me.nombre}`;
  } catch {
    // si falla, dejamos el campo vacío — no es crítico para ver los stickers
  }
}

saveEmailButton.addEventListener('click', async () => {
  const email = accountEmailInput.value.trim();
  emailStatus.className = 'modal-status';
  emailStatus.textContent = 'Guardando...';
  try {
    await api('/me', { method: 'PATCH', body: JSON.stringify({ email }) });
    emailStatus.className = 'modal-status is-success';
    emailStatus.textContent = email ? 'Guardado.' : 'Mail eliminado.';
  } catch (err) {
    emailStatus.className = 'modal-status is-error';
    emailStatus.textContent = err.message;
  }
});

sendOtpButton.addEventListener('click', async () => {
  const destino = loginWhatsapp.value.trim();
  if (!destino) {
    loginStatus.className = 'modal-status is-error';
    loginStatus.textContent = `Ingresá tu ${verif.nombre} primero.`;
    loginWhatsapp.focus();
    return;
  }
  loginStatus.className = 'modal-status';
  loginStatus.textContent = 'Enviando código...';
  try {
    const data = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ destino }) });
    otpField.hidden = false;
    sendOtpButton.textContent = 'Reenviar código';
    loginStatus.className = 'modal-status is-success';
    if (data.debug_otp) {
      otpInput.value = data.debug_otp;
      loginStatus.textContent = `Código autocompletado (demo, no hay ${verif.nombre} real conectado).`;
    } else {
      loginStatus.textContent = 'Código enviado.';
    }
  } catch (err) {
    loginStatus.className = 'modal-status is-error';
    loginStatus.textContent = err.message;
  }
});

confirmOtpButton.addEventListener('click', async () => {
  const destino = loginWhatsapp.value.trim();
  const code = otpInput.value.trim();
  if (!code) return;
  loginStatus.className = 'modal-status';
  loginStatus.textContent = 'Verificando...';
  try {
    const data = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ destino, code }) });
    setToken(data.token);
    dashboardTitle.textContent = data.comprador.nombre ? `Hola, ${data.comprador.nombre}` : 'Tus stickers';
    loginStatus.textContent = '';
    await showDashboard();
  } catch (err) {
    loginStatus.className = 'modal-status is-error';
    loginStatus.textContent = err.message;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await api('/auth/session', { method: 'DELETE' });
  } catch {
    // sigue el logout local aunque falle el pedido al server
  }
  clearToken();
  loginWhatsapp.value = '';
  otpInput.value = '';
  otpField.hidden = true;
  sendOtpButton.textContent = 'Enviar código';
  loginStatus.textContent = '';
  accountEmailInput.value = '';
  emailStatus.textContent = '';
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
    card.innerHTML = `
      <div class="sticker-card-head">
        <div>
          <div class="sticker-code">${sticker.codigoPublico}</div>
          <div class="sticker-meta">${sticker.modelo || ''} · ${ESTADO_LABELS[sticker.estado] || sticker.estado}</div>
        </div>
        ${sticker.estado === 'activo' ? '<button type="button" class="btn-ghost sticker-edit-btn">Editar</button>' : ''}
      </div>
      ${
        sticker.destino
          ? `<div class="sticker-destino"><b>${destinoTipo ? destinoTipo.label : sticker.destino.tipo}:</b> ${sticker.destino.valor}</div>`
          : sticker.estado === 'activo'
            ? '<div class="sticker-destino sticker-destino-empty">Todavía no configuraste a dónde redirige — elegí un destino con "Editar".</div>'
            : '<div class="sticker-destino sticker-destino-empty">Todavía no está activado — no tiene destino configurado.</div>'
      }
      <div class="sticker-edit-form modal-form" hidden></div>
    `;

    if (sticker.estado === 'activo') {
      const editButton = card.querySelector('.sticker-edit-btn');
      const editForm = card.querySelector('.sticker-edit-form');
      editButton.addEventListener('click', () => {
        const isOpen = !editForm.hidden;
        if (isOpen) {
          editForm.hidden = true;
          editForm.innerHTML = '';
          editButton.textContent = 'Editar';
          return;
        }
        editForm.hidden = false;
        editButton.textContent = 'Cancelar';
        const tipoInicial = sticker.destino?.tipo || DESTINO_TIPOS[0].id;
        const metaInicial = destinoMeta(tipoInicial);
        editForm.innerHTML = `
          <label>
            <span>Tipo de destino</span>
            <select class="edit-tipo">
              ${DESTINO_TIPOS.map((t) => `<option value="${t.id}" ${tipoInicial === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </label>
          <label>
            <span class="edit-valor-label">${metaInicial.campo}</span>
            <input type="text" class="edit-valor" value="${sticker.destino?.valor || ''}" placeholder="${metaInicial.placeholder}">
            <small class="field-hint edit-valor-hint"${metaInicial.ayuda ? '' : ' hidden'}>${metaInicial.ayuda}</small>
          </label>
          <button type="button" class="btn-primary modal-submit edit-save-btn">Guardar</button>
          <p class="modal-status edit-status"></p>
        `;

        // Al cambiar la función, el campo de valor cambia de etiqueta/ejemplo.
        const tipoSel = editForm.querySelector('.edit-tipo');
        const valorLabel = editForm.querySelector('.edit-valor-label');
        const valorInput = editForm.querySelector('.edit-valor');
        const valorHint = editForm.querySelector('.edit-valor-hint');
        tipoSel.addEventListener('change', () => {
          const m = destinoMeta(tipoSel.value);
          valorLabel.textContent = m.campo;
          valorInput.placeholder = m.placeholder;
          valorHint.textContent = m.ayuda || '';
          valorHint.hidden = !m.ayuda;
        });

        editForm.querySelector('.edit-save-btn').addEventListener('click', async () => {
          const tipo = editForm.querySelector('.edit-tipo').value;
          const valor = editForm.querySelector('.edit-valor').value.trim();
          const status = editForm.querySelector('.edit-status');
          if (!valor) {
            status.className = 'modal-status is-error';
            status.textContent = 'Completá el valor del destino.';
            return;
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

// Canal de verificación activo (email / whatsapp / ...) — fallback por si falla.
const verif = { canal: 'email', nombre: 'email', tipoInput: 'email', placeholder: 'vos@ejemplo.com' };
const verifTitleEl = document.getElementById('verif-title');
const verifSubEl = document.getElementById('verif-sub');
const verifLabelEl = document.getElementById('verif-label');

// Login con Google — opcional, se muestra solo si el backend tiene credenciales cargadas.
// De paso trae la config del canal de verificación (misma llamada).
async function checkGoogleLogin() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/config`);
    const data = await res.json();
    googleButton.hidden = !data.googleEnabled;
    googleDivider.hidden = !data.googleEnabled;
    if (data.verificacion) {
      Object.assign(verif, data.verificacion);
      loginWhatsapp.type = verif.tipoInput;
      loginWhatsapp.placeholder = verif.placeholder;
      loginWhatsapp.value = '';
      if (verifTitleEl) verifTitleEl.textContent = `Entrá con tu ${verif.nombre}.`;
      if (verifSubEl) verifSubEl.textContent = `Sin contraseñas. Te mandamos un código por ${verif.nombre} para confirmar que sos vos.`;
      if (verifLabelEl) verifLabelEl.textContent = `Tu ${verif.nombre}`;
    }
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
      : 'No se pudo iniciar sesión con Google. Probá de nuevo.';
}

checkGoogleLogin();

// Si ya había una sesión activa (misma pestaña) o Google nos acaba de loguear, entramos directo.
if (getToken()) {
  showDashboard().catch(() => showLogin());
} else {
  showLogin();
}
