import './styles.css';
import { applyBrand } from './brand.js';

applyBrand('Panel de vendedor');

const TOKEN_KEY = 'tap_vendedor_token';

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginWhatsapp = document.getElementById('login-whatsapp');
const loginPassword = document.getElementById('login-password');
const loginButton = document.getElementById('login-button');
const loginStatus = document.getElementById('login-status');
const dashboardTitle = document.getElementById('dashboard-title');
const logoutButton = document.getElementById('logout-button');
const pendientesList = document.getElementById('pendientes-list');

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
  const res = await fetch(`${API_BASE}/api/vendedor${path}`, {
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
  await loadPendientes();
}

loginButton.addEventListener('click', async () => {
  const whatsapp = loginWhatsapp.value.trim();
  const password = loginPassword.value;
  if (!whatsapp || !password) {
    loginStatus.className = 'modal-status is-error';
    loginStatus.textContent = 'Completá WhatsApp y contraseña.';
    return;
  }
  loginStatus.className = 'modal-status';
  loginStatus.textContent = 'Ingresando...';
  try {
    const data = await api('/login', { method: 'POST', body: JSON.stringify({ whatsapp, password }) });
    setToken(data.token);
    dashboardTitle.textContent = data.vendedor.nombre ? `Hola, ${data.vendedor.nombre}` : 'Pendientes de entrega';
    loginStatus.textContent = '';
    await showDashboard();
  } catch (err) {
    loginStatus.className = 'modal-status is-error';
    loginStatus.textContent = err.message;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await api('/session', { method: 'DELETE' });
  } catch {
    // sigue el logout local aunque falle el pedido al server
  }
  clearToken();
  loginWhatsapp.value = '';
  loginPassword.value = '';
  loginStatus.textContent = '';
  showLogin();
});

async function loadPendientes() {
  pendientesList.innerHTML = '<p class="section-lead">Cargando...</p>';
  try {
    const pendientes = await api('/pendientes');
    renderPendientes(pendientes);
  } catch (err) {
    if (err.message.includes('expirada') || err.message.includes('autenticación')) {
      clearToken();
      showLogin();
      return;
    }
    pendientesList.innerHTML = `<p class="modal-status is-error">${err.message}</p>`;
  }
}

function renderPendientes(pendientes) {
  if (!pendientes.length) {
    pendientesList.innerHTML = '<p class="section-lead">No tenés entregas pendientes.</p>';
    return;
  }

  pendientesList.innerHTML = '';
  pendientes.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'sticker-card';
    card.innerHTML = `
      <div class="sticker-card-head">
        <div>
          <div class="sticker-code pickup-id">${p.codigoPublico}</div>
          <div class="sticker-meta">${p.modelo}${p.comprador ? ` · comprador: ${p.comprador.whatsapp}` : ''}</div>
        </div>
        <button type="button" class="btn-ghost entregar-btn">Marcar entregado</button>
      </div>
      <p class="modal-status entregar-status"></p>
    `;

    card.querySelector('.entregar-btn').addEventListener('click', async () => {
      if (!confirm(`¿Confirmás que ya le entregaste el imprimible ${p.codigoPublico} al comprador?`)) return;
      const status = card.querySelector('.entregar-status');
      status.className = 'modal-status';
      status.textContent = 'Guardando...';
      try {
        await api(`/pendientes/${p.id}/entregar`, { method: 'PATCH' });
        await loadPendientes();
      } catch (err) {
        status.className = 'modal-status is-error';
        status.textContent = err.message;
      }
    });

    pendientesList.appendChild(card);
  });
}

if (getToken()) {
  showDashboard().catch(() => showLogin());
} else {
  showLogin();
}
