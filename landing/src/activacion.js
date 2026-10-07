import './styles.css';
import './visita.js';
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
  alias: 'tus datos de transferencia',
};

// Paso 3 ("Listo") según la función que fijó el admin: qué carga el comprador.
const FUNCION_PASO_LISTO = {
  whatsapp: 'cargás tu número y listo.',
  instagram: 'cargás tu usuario de Instagram y listo.',
  pago: 'pegás tu link de pago y listo.',
  menu: 'pegás el link de tu menú y listo.',
  review: 'pegás el link de reseñas de Google de tu negocio y listo.',
  web: 'pegás el link de tu web y listo.',
  agenda: 'pegás el link de tu agenda y listo.',
  linktree: 'cargás tu usuario de Linktree y listo.',
  alias: 'cargás tu alias y listo.',
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
  const pasoListo = FUNCION_PASO_LISTO[info.funcion];
  const paso3 = document.querySelector('.activacion-pasos li:nth-child(3)');
  if (pasoListo && paso3) paso3.innerHTML = `<b>Listo</b> — ${pasoListo}`;

  if (info.liberada) {
    // Activación gratis: se verifica el email por código antes de activar.
    const paso2 = document.querySelector('.activacion-pasos li:nth-child(2)');
    if (paso2) paso2.innerHTML = '<b>Verificá tu email</b> con el código que te mandamos — sin pago, es un regalo.';
    pagarButton.textContent = 'Enviar código';
    if (formHint) {
      formHint.textContent = 'Te mandamos un código de un solo uso a ese mail. Si ya activaste otro producto con este email, este se suma a tu cuenta.';
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
  // Mi panel prellena el login con este mail (misma clave que mi-panel.js):
  // al volver de Mercado Pago no hay sesión y tiene que entrar con código.
  try {
    localStorage.setItem('tap_ultimo_email', email);
  } catch {
    /* sin storage: escribe el mail a mano */
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
