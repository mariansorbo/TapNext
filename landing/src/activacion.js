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
const emailInput = document.getElementById('email');
const otpField = document.getElementById('otp-field');
const otpInput = document.getElementById('otp');
const formHint = document.getElementById('form-hint');
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
let infoActual = null;

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
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  infoActual = info;
  modeloLabel.textContent = info.modelo || 'llavero';
  ctaDestino.textContent = FUNCION_CTA[info.funcion] || 'tu contenido';
  if (info.precio != null) precioLabel.textContent = `(${formatoPrecio(info.precio)})`;

  if (info.liberada) {
    // Activación gratis: se verifica el email por código antes de activar.
    const paso2 = document.querySelector('.activacion-pasos li:nth-child(2)');
    if (paso2) paso2.innerHTML = '<b>Verificá tu email</b> con el código que te mandamos — sin pago, es un regalo.';
    pagarButton.textContent = 'Enviar código';
    if (formHint) {
      formHint.textContent = 'Te mandamos un código de un solo uso a ese mail. Si ya activaste otro NextTap con este email, este se suma a tu cuenta.';
    }
  } else if (!info.pagosHabilitados) {
    setStatus('is-error', 'Los pagos todavía no están habilitados. Probá más tarde.');
    pagarButton.disabled = true;
  }
  if (params.get('pago') === 'error') {
    setStatus('is-error', 'El pago no se completó. Podés intentar de nuevo.');
  }

  show(formView);
  emailInput.focus();
}

let otpEnviado = false;

// Activación GRATIS: pedir código → verificar → activar (2 pasos, mismo botón).
async function flujoGratis(email) {
  if (!otpEnviado) {
    pagarButton.disabled = true;
    setStatus('', 'Enviando código...');
    try {
      const r = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ email }) });
      otpEnviado = true;
      otpField.hidden = false;
      otpInput.focus();
      pagarButton.textContent = 'Activar gratis';
      pagarButton.disabled = false;
      emailInput.disabled = true;
      if (r.debug_otp) {
        otpInput.value = r.debug_otp;
        setStatus('is-error', `MODO DEMO — el mail no está configurado. Tu código es ${r.debug_otp}.`);
      } else {
        setStatus('is-success', 'Te mandamos un código al mail. Ponelo acá (revisá spam).');
      }
    } catch (err) {
      pagarButton.disabled = false;
      setStatus('is-error', err.message);
    }
    return;
  }

  const code = otpInput.value.trim();
  if (!code) {
    setStatus('is-error', 'Ingresá el código que te llegó por mail.');
    otpInput.focus();
    return;
  }
  pagarButton.disabled = true;
  setStatus('', 'Verificando...');
  try {
    const v = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
    const data = await api(`/activacion/${encodeURIComponent(codigo)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${v.token}` },
      body: JSON.stringify({}),
    });
    if (data.liberada && data.activado) {
      // Verificado + activo → entra a Mi panel ya logueado.
      window.location.replace(`/mi-panel.html?token=${encodeURIComponent(v.token)}`);
      return;
    }
    throw new Error('No se pudo activar.');
  } catch (err) {
    pagarButton.disabled = false;
    setStatus('is-error', err.message);
  }
}

pagarButton.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!RE_EMAIL.test(email)) {
    setStatus('is-error', 'Ingresá un email válido.');
    emailInput.focus();
    return;
  }

  if (infoActual?.liberada) {
    await flujoGratis(email);
    return;
  }

  // --- Activación con pago: email → Mercado Pago ---
  pagarButton.disabled = true;
  setStatus('', infoActual?.liberada ? 'Activando...' : 'Abriendo el pago...');
  try {
    const data = await api(`/activacion/${encodeURIComponent(codigo)}`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    if (data.liberada && data.activado) {
      // Activación liberada: ya quedó activo. A configurar el destino en Mi panel.
      window.location.replace('/mi-panel.html');
    } else if (data.initPoint) {
      window.location.href = data.initPoint;
    } else {
      throw new Error('No se pudo iniciar el pago.');
    }
  } catch (err) {
    pagarButton.disabled = false;
    setStatus('is-error', err.message);
  }
});

emailInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pagarButton.click();
});
otpInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pagarButton.click();
});

init();
