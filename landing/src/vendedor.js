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

// Poll del panel: mientras el vendedor lo tiene abierto, las ventas nuevas y el
// stock se refrescan solos sin que tenga que recargar la página.
const POLL_MS = 10_000;
let pollTimer = null;

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => {
    if (dashboardView.hidden) return;
    loadStock({ silencioso: true });
    loadVentas({ silencioso: true });
    loadComision();
  }, POLL_MS);
}

function showLogin() {
  stopPoll();
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
  startPoll();
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

// `silencioso` = refresco por poll: no muestra "Cargando..." ni pisa la vista si falla.
async function loadStock({ silencioso = false } = {}) {
  if (!silencioso) stockList.innerHTML = '<p class="section-lead">Cargando...</p>';
  try {
    // Stock = cuántas unidades tenés de cada combo. Cola = quién está esperando
    // (con código de retiro). Con late binding no entregás una unidad puntual:
    // agarrás cualquiera del combo y la confirmás con el código.
    const [grupos, cola] = await Promise.all([api('/stock'), api('/cola').catch(() => ({ combos: [] }))]);
    renderStock(grupos, cola);
  } catch (err) {
    if (err.message.includes('expirada') || err.message.includes('autenticación')) {
      clearToken();
      showLogin();
      return;
    }
    if (!silencioso) stockList.innerHTML = `<p class="modal-status is-error">${err.message}</p>`;
  }
}

const FUNC_LABEL = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', pago: 'Pago', menu: 'Menú',
  review: 'Reseña', web: 'Web propia', agenda: 'Agenda', linktree: 'LinkTree',
};
const MODELO_LABEL = { llavero: 'Llavero', tarjeta: 'Tarjeta', placa: 'Placa', suelto: 'Suelto' };
const comboNombre = (modelo, funcion) =>
  `${MODELO_LABEL[modelo] || modelo}${funcion ? ` · ${FUNC_LABEL[funcion] || funcion}` : ' · sin función'}`;

// Cuántos pedidos en espera se muestran por combo antes del "ver más".
const PROXIMAS = 5;

// Combos con la lista completa desplegada (por "ver más"). Se guarda entre
// refrescos del poll para que no se colapse sola mientras el vendedor mira.
const combosAbiertos = new Set();

const comboKey = (modelo, funcion) => `${modelo || 'suelto'}__${funcion || ''}`;

// grupos (stock): [{ modelo, funcion, unidades: [...] }]
// cola: { combos: [{ modelo, funcion, pedidos: [{ ventaId, mail, codigoRetiro, restantesItems }] }] }
function renderStock(grupos, cola = { combos: [] }) {
  const stockPorCombo = new Map();
  (Array.isArray(grupos) ? grupos : []).forEach((g) => stockPorCombo.set(comboKey(g.modelo, g.funcion), g.unidades.length));

  const colaCombos = (cola && cola.combos) || [];
  // Todos los combos que tienen stock o cola.
  const keys = new Set([...stockPorCombo.keys(), ...colaCombos.map((c) => comboKey(c.modelo, c.funcion))]);

  if (!keys.size) {
    stockList.innerHTML = '<p class="section-lead">No tenés stock asignado todavía.</p>';
    return;
  }
  stockList.innerHTML = '';
  [...keys].forEach((key) => {
    const [modelo, funcion] = [key.split('__')[0], key.split('__')[1] || null];
    const enStock = stockPorCombo.get(key) || 0;
    const grupoCola = colaCombos.find((c) => comboKey(c.modelo, c.funcion) === key);
    const pedidos = grupoCola ? grupoCola.pedidos : [];
    const abierto = combosAbiertos.has(key);
    const extra = pedidos.slice(PROXIMAS);
    const card = document.createElement('div');
    card.className = 'sticker-card combo-entrega';
    const pedidoHtml = (p, i, oculta) =>
      `<div class="combo-entrega-unidad${oculta ? ' is-extra' : ''}"${oculta ? ' hidden' : ''}>` +
      `<span class="combo-entrega-pos">#${i + 1}</span>` +
      `<span class="sticker-code pickup-id">${p.codigoRetiro || '----'}</span>` +
      `<span class="combo-entrega-mail">${p.mail || 'sin mail'}</span></div>`;
    card.innerHTML = `
      <div class="combo-entrega-head">
        <b>${comboNombre(modelo, funcion)}</b>
        <span class="combo-entrega-total">${enStock} en stock · ${pedidos.length} esperando</span>
      </div>
      ${
        pedidos.length
          ? `<div class="combo-entrega-proximas">
        ${pedidos.slice(0, PROXIMAS).map((p, i) => pedidoHtml(p, i, false)).join('')}
        ${extra.map((p, i) => pedidoHtml(p, i + PROXIMAS, !abierto)).join('')}
      </div>
      ${extra.length ? `<button type="button" class="btn-ghost combo-entrega-mas">${abierto ? 'Ver menos' : `Ver los otros ${extra.length}`}</button>` : ''}`
          : '<p class="section-lead" style="margin:8px 0 0">Nadie esperando este combo.</p>'
      }
    `;
    const btn = card.querySelector('.combo-entrega-mas');
    if (btn) {
      btn.addEventListener('click', () => {
        const ahora = !combosAbiertos.has(key);
        if (ahora) combosAbiertos.add(key);
        else combosAbiertos.delete(key);
        card.querySelectorAll('.combo-entrega-unidad.is-extra').forEach((el) => {
          el.hidden = !ahora;
        });
        btn.textContent = ahora ? 'Ver menos' : `Ver los otros ${extra.length}`;
      });
    }
    stockList.appendChild(card);
  });
}

async function loadVentas({ silencioso = false } = {}) {
  if (!silencioso) ventasList.innerHTML = '<p class="section-lead">Cargando...</p>';
  try {
    const ventas = await api('/ventas');
    renderVentas(ventas);
  } catch (err) {
    if (err.message.includes('expirada') || err.message.includes('autenticación')) {
      clearToken();
      showLogin();
      return;
    }
    if (!silencioso) ventasList.innerHTML = `<p class="modal-status is-error">${err.message}</p>`;
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
