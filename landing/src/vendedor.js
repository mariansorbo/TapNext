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
const stockList = document.getElementById('stock-list');
const ventasList = document.getElementById('ventas-list');
const comisionCard = document.getElementById('comision-card');

const MONEY = (n) => `$${Number(n).toLocaleString('es-AR')}`;

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
  api('/me')
    .then((me) => {
      if (me?.nombre) dashboardTitle.textContent = `Buen día, ${me.nombre}`;
    })
    .catch(() => {});
  await Promise.all([loadStock(), loadVentas(), loadComision()]);
}

// Rojo (deuda) a la izquierda, celeste (Base) al medio, verde (tramos altos) a
// la derecha. Un color por tramo positivo después de Base.
const SEG_COLORS_POS_ALTOS = ['#9CCC7A', '#5FB760', '#2F9E44', '#1E7A32'];
const BASE_CELESTE = '#6FC3E0';

async function loadComision() {
  let c;
  try {
    c = await api('/comision');
  } catch {
    comisionCard.hidden = true;
    return;
  }
  if (!c || !c.modeloActivo) {
    comisionCard.hidden = true;
    return;
  }
  comisionCard.hidden = false;
  renderComision(c);
}

function renderComision(c) {
  const tramos = c.tramos.slice().sort((a, b) => a.orden - b.orden);
  const bottom = tramos[0].desde_u; // -10
  const topSeg = tramos[tramos.length - 1];
  const top = Math.max(topSeg.desde_u + 10, (c.tramoActual.posicion || 0) + 4);
  const span = Math.max(1, top - bottom);
  const pctN = (n) => (Math.max(0, Math.min(span, n - bottom)) / span) * 100;
  const pct = (n) => `${pctN(n).toFixed(2)}%`;

  const enDeuda = c.deuda > 0;
  const pos = c.tramoActual.posicion || 0;
  const basePct = tramos.find((t) => t.etiqueta === 'Base')?.pct || 0;

  // Tira de escala: 6 segmentos, rojo → celeste → verde (verde a la derecha).
  // Cada segmento muestra su % de comisión; abajo van los límites de unidades.
  let altoIdx = 0;
  const strip = tramos
    .map((t, i) => {
      const hasta = i === tramos.length - 1 ? top : t.hasta_u;
      const w = ((Math.min(top, hasta) - Math.max(bottom, t.desde_u)) / span) * 100;
      const color =
        t.desde_u < 0
          ? i === 0
            ? '#b23b3b'
            : '#e07a7a'
          : t.etiqueta === 'Base'
            ? BASE_CELESTE
            : SEG_COLORS_POS_ALTOS[altoIdx++ % SEG_COLORS_POS_ALTOS.length];
      return `<span style="width:${w}%;background:${color}">${t.pct}%</span>`;
    })
    .join('');

  // Límites de unidades por categoría (bordes de cada segmento).
  const bordes = [bottom, ...tramos.map((t, i) => (i === tramos.length - 1 ? null : t.hasta_u)).filter((v) => v !== null), '+'];
  const boundsHtml = bordes
    .map((b) => {
      const val = b === '+' ? top : b;
      return `<span style="left:${pct(val)}">${b === '+' ? `${topSeg.desde_u}+` : b}</span>`;
    })
    .join('');

  const hint = enDeuda
    ? `${c.deuda} venta${c.deuda === 1 ? '' : 's'} más y volvés al ${basePct}% durante el día de hoy`
    : c.proximoTramo
      ? `${c.proximoTramo.faltanU} unidad${c.proximoTramo.faltanU === 1 ? '' : 'es'} más y tu comisión pasa al ${c.proximoTramo.pct}% durante el día de hoy`
      : 'Estás en el tramo más alto.';

  const markerLeft = pct(pos);

  comisionCard.innerHTML = `
    <div class="comision-top">
      <div class="comision-rate">${c.tramoActual.pct}% <small>de la venta</small></div>
      ${enDeuda ? `<span class="comision-tag is-debt">deuda −${c.deuda}</span>` : ''}
    </div>
    ${c.esSabadoHoy ? '<div class="comision-hint" style="margin-top:8px">Hoy es sábado: +10% sobre la comisión del día.</div>' : ''}

    <div class="comision-scale${c.extraMarginalHoy ? ' has-earned' : ''}">
      <div class="comision-scale-strip">
        ${strip}
        <div class="comision-scale-marker${enDeuda ? ' is-debt' : ''}" style="left:${markerLeft}"></div>
        ${c.extraMarginalHoy ? `<div class="comision-scale-earned" style="left:${markerLeft}">+${MONEY(c.extraMarginalHoy)} hoy</div>` : ''}
        <div class="comision-scale-here${enDeuda ? ' is-debt' : ''}" style="left:${markerLeft}">${enDeuda ? `en deuda −${c.deuda}` : `llevás ${pos} u hoy`}</div>
      </div>
      <div class="comision-scale-bounds">${boundsHtml}</div>
    </div>

    <div class="comision-hint${enDeuda ? ' is-debt' : ''}">${hint}</div>

    <div class="comision-stats">
      <span>Vendido hoy <b>${c.unidadesHoy} u</b></span>
      <span>Comisión del período <b>${MONEY(c.total)}</b></span>
    </div>`;
}

loginButton.addEventListener('click', async () => {
  const identificador = loginWhatsapp.value.trim();
  const password = loginPassword.value;
  if (!identificador || !password) {
    loginStatus.className = 'modal-status is-error';
    loginStatus.textContent = 'Completá email o WhatsApp y contraseña.';
    return;
  }
  loginStatus.className = 'modal-status';
  loginStatus.textContent = 'Ingresando...';
  try {
    const data = await api('/login', { method: 'POST', body: JSON.stringify({ identificador, password }) });
    setToken(data.token);
    dashboardTitle.textContent = data.vendedor.nombre ? `Buen día, ${data.vendedor.nombre}` : 'Pendientes de entrega';
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

async function loadStock() {
  stockList.innerHTML = '<p class="section-lead">Cargando...</p>';
  try {
    const stock = await api('/stock');
    renderStock(stock);
  } catch (err) {
    if (err.message.includes('expirada') || err.message.includes('autenticación')) {
      clearToken();
      showLogin();
      return;
    }
    stockList.innerHTML = `<p class="modal-status is-error">${err.message}</p>`;
  }
}

function renderStock(stock) {
  if (!stock.length) {
    stockList.innerHTML = '<p class="section-lead">No tenés stock asignado todavía.</p>';
    return;
  }
  stockList.innerHTML = '';
  stock.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'sticker-card';
    card.innerHTML = `
      <div class="sticker-card-head">
        <div>
          <div class="sticker-code pickup-id">${s.codigoPublico}</div>
          <div class="sticker-meta">${s.modelo}</div>
        </div>
      </div>
    `;
    stockList.appendChild(card);
  });
}

async function loadVentas() {
  ventasList.innerHTML = '<p class="section-lead">Cargando...</p>';
  try {
    const ventas = await api('/ventas');
    renderVentas(ventas);
  } catch (err) {
    if (err.message.includes('expirada') || err.message.includes('autenticación')) {
      clearToken();
      showLogin();
      return;
    }
    ventasList.innerHTML = `<p class="modal-status is-error">${err.message}</p>`;
  }
}

function renderVentas(ventas) {
  if (!ventas.length) {
    ventasList.innerHTML = '<p class="section-lead">Todavía no tenés ventas confirmadas.</p>';
    return;
  }
  ventasList.innerHTML = '';
  ventas.forEach((v) => {
    const card = document.createElement('div');
    card.className = 'sticker-card';
    card.innerHTML = `
      <div class="sticker-card-head">
        <div>
          <div class="sticker-code pickup-id">${v.codigoPublico}</div>
          <div class="sticker-meta">${v.modelo}${v.comprador ? ` · comprador: ${v.comprador.whatsapp}` : ''}</div>
        </div>
      </div>
    `;
    ventasList.appendChild(card);
  });
}

if (getToken()) {
  showDashboard().catch(() => showLogin());
} else {
  showLogin();
}
