import './styles.css';
import { applyBrand } from './brand.js';

applyBrand('Activar llavero');

const FUNCION_CTA = {
  whatsapp: 'tu WhatsApp',
  instagram: 'tu Instagram',
  pago: 'tu link de pago',
  menu: 'tu menú',
  review: 'tus reseñas',
  web: 'tu web',
  agenda: 'tu agenda',
  linktree: 'tu Linktree',
};

// Mismo key que usa mi-panel.js — al verificar dejamos la sesión lista para
// que el comprador pueda editar sin volver a loguearse.
const TOKEN_KEY = 'tap_panel_token';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const loadingView = document.getElementById('loading-view');
const errorView = document.getElementById('error-view');
const errorText = document.getElementById('error-text');
const doneView = document.getElementById('done-view');
const pagoView = document.getElementById('pago-view');
const pagoText = document.getElementById('pago-text');
const pagoPanelLink = document.getElementById('pago-panel-link');
const formView = document.getElementById('form-view');
const modeloLabel = document.getElementById('modelo-label');
const ctaDestino = document.getElementById('cta-destino');
const precioLabel = document.getElementById('precio-label');
const destinoInput = document.getElementById('destino');
const sendOtpButton = document.getElementById('send-otp');
const otpField = document.getElementById('otp-field');
const otpInput = document.getElementById('otp');
const verificarButton = document.getElementById('verificar');
const pagarButton = document.getElementById('pagar');
const statusEl = document.getElementById('status');

function getCodigo() {
  const q = new URLSearchParams(window.location.search).get('c');
  if (q) return q.trim();
  const m = window.location.pathname.match(/\/activacion\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).trim() : '';
}
const codigo = getCodigo();
const params = new URLSearchParams(window.location.search);

let sesionToken = null;
try {
  sesionToken = sessionStorage.getItem(TOKEN_KEY);
} catch {
  /* sessionStorage bloqueado */
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de conexión con el servidor.');
  return data;
}

function show(view) {
  [loadingView, errorView, doneView, pagoView, formView].forEach((v) => (v.hidden = v !== view));
}
function setStatus(kind, text) {
  statusEl.className = kind ? `modal-status ${kind}` : 'modal-status';
  statusEl.textContent = text;
}
function formatoPrecio(n) {
  return Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

// --- Post-pago: MP nos devuelve a ?pago=exito|error|pendiente ---
async function esperarActivacion() {
  show(pagoView);
  for (let i = 0; i < 20; i++) {
    try {
      const info = await api(`/activacion/${encodeURIComponent(codigo)}`);
      if (info.estado === 'activo') {
        window.location.replace('/mi-panel.html');
        return;
      }
    } catch {
      /* reintentamos */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  pagoText.textContent =
    'El pago puede tardar un ratito en confirmarse. Entrá a Mi panel en unos minutos para configurar tu llavero.';
  pagoPanelLink.hidden = false;
}

async function init() {
  if (!codigo) {
    errorText.textContent = 'Falta el código del llavero en el link.';
    show(errorView);
    return;
  }

  let info;
  try {
    info = await api(`/activacion/${encodeURIComponent(codigo)}`);
  } catch (err) {
    errorText.textContent = err.message;
    show(errorView);
    return;
  }

  if (info.estado === 'activo') {
    if (info.destino) window.location.replace(info.destino);
    else show(doneView);
    return;
  }

  if (params.get('pago') === 'exito' || params.get('pago') === 'pendiente') {
    esperarActivacion();
    return;
  }

  modeloLabel.textContent = info.modelo || 'llavero';
  ctaDestino.textContent = FUNCION_CTA[info.funcion] || 'tu contenido';
  if (info.precio != null) precioLabel.textContent = `(${formatoPrecio(info.precio)})`;

  if (!info.pagosHabilitados) {
    setStatus('is-error', 'Los pagos todavía no están habilitados. Probá más tarde.');
  }

  if (params.get('pago') === 'error') {
    setStatus('is-error', 'El pago no se completó. Podés intentar de nuevo.');
  }

  // Si ya teníamos sesión (misma pestaña), saltamos directo al paso de pago.
  if (sesionToken) {
    otpField.hidden = true;
    sendOtpButton.hidden = true;
    destinoInput.closest('.modal-form').hidden = true;
    pagarButton.hidden = false;
  }

  show(formView);
}

sendOtpButton.addEventListener('click', async () => {
  const destino = destinoInput.value.trim();
  if (!destino) {
    setStatus('is-error', 'Ingresá tu email.');
    return;
  }
  sendOtpButton.disabled = true;
  setStatus('', 'Enviando código...');
  try {
    const data = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ destino }) });
    otpField.hidden = false;
    sendOtpButton.textContent = 'Reenviar código';
    if (data.debug_otp) {
      otpInput.value = data.debug_otp;
      setStatus('is-success', 'Código autocompletado (demo, sin envío real conectado).');
    } else {
      setStatus('is-success', 'Te mandamos un código por email.');
    }
  } catch (err) {
    setStatus('is-error', err.message);
  } finally {
    sendOtpButton.disabled = false;
  }
});

verificarButton.addEventListener('click', async () => {
  const destino = destinoInput.value.trim();
  const code = otpInput.value.trim();
  if (!code) {
    setStatus('is-error', 'Ingresá el código que te llegó.');
    return;
  }
  verificarButton.disabled = true;
  setStatus('', 'Verificando...');
  try {
    const data = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ destino, code }) });
    sesionToken = data.token;
    try {
      sessionStorage.setItem(TOKEN_KEY, sesionToken);
    } catch {
      /* noop */
    }
    otpField.hidden = true;
    sendOtpButton.hidden = true;
    destinoInput.closest('.modal-form').hidden = true;
    pagarButton.hidden = false;
    setStatus('is-success', 'Email verificado. Último paso: el pago.');
  } catch (err) {
    verificarButton.disabled = false;
    setStatus('is-error', err.message);
  }
});

pagarButton.addEventListener('click', async () => {
  if (!sesionToken) {
    setStatus('is-error', 'Verificá tu email primero.');
    return;
  }
  pagarButton.disabled = true;
  setStatus('', 'Abriendo el pago...');
  try {
    const data = await api(`/activacion/${encodeURIComponent(codigo)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sesionToken}` },
    });
    if (data.initPoint) {
      window.location.href = data.initPoint;
    } else {
      throw new Error('No se pudo iniciar el pago.');
    }
  } catch (err) {
    pagarButton.disabled = false;
    setStatus('is-error', err.message);
  }
});

init();
