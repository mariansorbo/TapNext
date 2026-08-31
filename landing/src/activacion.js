import './styles.css';
import { applyBrand } from './brand.js';

applyBrand('Activar sticker');

const TIPO_LABELS = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  pago: 'Pago',
  menu: 'Menú',
  review: 'Reseña',
  web: 'Web propia',
  agenda: 'Agenda',
  linktree: 'LinkTree',
};

// Mismo key que usa mi-panel.js — al activar dejamos la sesión lista para
// que el comprador pueda seguir editando sin volver a loguearse.
const TOKEN_KEY = 'tap_panel_token';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const loadingView = document.getElementById('loading-view');
const errorView = document.getElementById('error-view');
const errorText = document.getElementById('error-text');
const doneView = document.getElementById('done-view');
const formView = document.getElementById('form-view');
const modeloLabel = document.getElementById('modelo-label');
const canalLabel = document.getElementById('canal-label');
const destinoLabel = document.getElementById('destino-label');
const tipoSelect = document.getElementById('tipo');
const valorInput = document.getElementById('valor');
const destinoInput = document.getElementById('destino');
const sendOtpButton = document.getElementById('send-otp');
const otpField = document.getElementById('otp-field');
const otpInput = document.getElementById('otp');
const activarButton = document.getElementById('activar');
const statusEl = document.getElementById('status');

// Canal de verificación activo (email hoy, whatsapp cuando se active). Lo dicta
// el backend vía /api/auth/config — el front no asume ninguno.
let canal = { canal: 'email', nombre: 'email', tipoInput: 'email', placeholder: 'vos@ejemplo.com' };

// El código puede venir como ?c=xxxx o como path /activacion/xxxx (rewrite de Vercel).
function getCodigo() {
  const q = new URLSearchParams(window.location.search).get('c');
  if (q) return q.trim();
  const m = window.location.pathname.match(/\/activacion\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).trim() : '';
}
const codigo = getCodigo();

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
  [loadingView, errorView, doneView, formView].forEach((v) => (v.hidden = v !== view));
}

function setStatus(kind, text) {
  statusEl.className = kind ? `modal-status ${kind}` : 'modal-status';
  statusEl.textContent = text;
}

// wa.me a partir de un número suelto; el resto se deja tal cual (aceptamos
// tanto una URL completa como algo escrito a mano).
function normalizarValor(tipo, valor) {
  const v = valor.trim();
  if (tipo === 'whatsapp' && /^[+()\d\s-]+$/.test(v)) {
    return `https://wa.me/${v.replace(/\D/g, '')}`;
  }
  if (/^https?:\/\//i.test(v)) return v;
  if (tipo === 'instagram') return `https://instagram.com/${v.replace(/^@/, '')}`;
  // Cualquier otro caso escrito sin protocolo pero con pinta de dominio/URL.
  if (/^[\w-]+\.[\w.-]+/.test(v)) return `https://${v}`;
  return v;
}

async function cargarCanal() {
  try {
    const cfg = await api('/auth/config');
    if (cfg.verificacion) canal = cfg.verificacion;
  } catch {
    // si falla, quedan los defaults (email)
  }
  canalLabel.textContent = canal.nombre;
  destinoLabel.textContent = canal.nombre === 'email' ? 'Tu email' : `Tu ${canal.nombre}`;
  destinoInput.type = canal.tipoInput || 'text';
  destinoInput.placeholder = canal.placeholder || '';
}

async function init() {
  if (!codigo) {
    errorText.textContent = 'Falta el código del sticker en el link.';
    show(errorView);
    return;
  }
  try {
    const [info] = await Promise.all([api(`/activacion/${encodeURIComponent(codigo)}`), cargarCanal()]);
    if (info.yaActivado) {
      // Ya tiene dueño: el tap va directo al destino configurado. Si todavía
      // no cargó ninguno, mostramos la pantalla de "ya activado".
      if (info.destino) {
        window.location.replace(info.destino);
        return;
      }
      show(doneView);
      return;
    }
    modeloLabel.textContent = info.modelo || 'llavero';
    tipoSelect.innerHTML = info.tipos
      .map((t) => `<option value="${t}">${TIPO_LABELS[t] || t}</option>`)
      .join('');
    show(formView);
  } catch (err) {
    errorText.textContent = err.message;
    show(errorView);
  }
}

// Validaciones del destino del sticker (tipo + valor) — comunes a los dos pasos.
function leerDestinoSticker() {
  const tipo = tipoSelect.value;
  const valor = normalizarValor(tipo, valorInput.value);
  if (!valor) {
    setStatus('is-error', 'Completá a dónde redirige el sticker.');
    return null;
  }
  return { tipo, valor };
}

sendOtpButton.addEventListener('click', async () => {
  if (!leerDestinoSticker()) return;
  const destino = destinoInput.value.trim();
  if (!destino) {
    setStatus('is-error', `Ingresá tu ${canal.nombre}.`);
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
      setStatus('is-success', `Código enviado a tu ${canal.nombre}.`);
    }
  } catch (err) {
    setStatus('is-error', err.message);
  } finally {
    sendOtpButton.disabled = false;
  }
});

activarButton.addEventListener('click', async () => {
  const destinoSticker = leerDestinoSticker();
  if (!destinoSticker) return;
  const destino = destinoInput.value.trim();
  const code = otpInput.value.trim();
  if (!code) {
    setStatus('is-error', 'Ingresá el código que te llegó.');
    return;
  }

  activarButton.disabled = true;
  setStatus('', 'Verificando...');
  try {
    // 1. Verificar identidad con el canal activo → token de sesión de comprador.
    const verif = await api('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ destino, code }),
    });
    // 2. Reclamar el sticker, ya autenticado.
    setStatus('', 'Activando...');
    await api(`/activacion/${encodeURIComponent(codigo)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${verif.token}` },
      body: JSON.stringify(destinoSticker),
    });
    try {
      sessionStorage.setItem(TOKEN_KEY, verif.token);
    } catch {
      // sessionStorage bloqueado — igual sigue, el comprador entra de nuevo con código
    }
    setStatus('is-success', 'Listo. Te llevamos a tu panel...');
    setTimeout(() => {
      window.location.href = '/mi-panel.html';
    }, 900);
  } catch (err) {
    activarButton.disabled = false;
    setStatus('is-error', err.message);
  }
});

init();
