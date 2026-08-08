import './styles.css';
import { applyBrand } from './brand.js';

applyBrand('Mi panel');

const DESTINO_TIPOS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'pago', label: 'Pago' },
  { id: 'menu', label: 'Menú' },
  { id: 'review', label: 'Reseña' },
  { id: 'web', label: 'Web propia' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'linktree', label: 'LinkTree' },
];
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
  const whatsapp = loginWhatsapp.value.trim();
  if (!whatsapp) {
    loginStatus.className = 'modal-status is-error';
    loginStatus.textContent = 'Ingresá tu WhatsApp primero.';
    loginWhatsapp.focus();
    return;
  }
  loginStatus.className = 'modal-status';
  loginStatus.textContent = 'Enviando código...';
  try {
    const data = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ whatsapp }) });
    otpField.hidden = false;
    sendOtpButton.textContent = 'Reenviar código';
    loginStatus.className = 'modal-status is-success';
    loginStatus.textContent = `Código enviado (demo, no hay WhatsApp real conectado): ${data.debug_otp}`;
  } catch (err) {
    loginStatus.className = 'modal-status is-error';
    loginStatus.textContent = err.message;
  }
});

confirmOtpButton.addEventListener('click', async () => {
  const whatsapp = loginWhatsapp.value.trim();
  const code = otpInput.value.trim();
  if (!code) return;
  loginStatus.className = 'modal-status';
  loginStatus.textContent = 'Verificando...';
  try {
    const data = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ whatsapp, code }) });
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

    const destinoTipo = DESTINO_TIPOS.find((t) => t.id === sticker.destino?.tipo);
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
        editForm.innerHTML = `
          <label>
            <span>Tipo de destino</span>
            <select class="edit-tipo">
              ${DESTINO_TIPOS.map((t) => `<option value="${t.id}" ${sticker.destino?.tipo === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Valor</span>
            <input type="text" class="edit-valor" value="${sticker.destino?.valor || ''}" placeholder="wa.me/... / instagram.com/... / etc.">
          </label>
          <button type="button" class="btn-primary modal-submit edit-save-btn">Guardar</button>
          <p class="modal-status edit-status"></p>
        `;

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

// Si ya había una sesión activa (misma pestaña), entramos directo al dashboard.
if (getToken()) {
  showDashboard().catch(() => showLogin());
} else {
  showLogin();
}
