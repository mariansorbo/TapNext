import './styles.css';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';
import { BRAND_ICONS } from './brand-icons.js';

// Ambos flujos (comprar.html presencial y pedido.html online) comparten el
// mismo carrito: el comprador elige un primer producto (función+modelo) y,
// en un paso aparte, se le pregunta si quiere sumar más — ahí aparece un
// mini formulario tipo carrito (función+modelo+cantidad) para agregar
// cuantos quiera, en la misma compra/pago.
// En ambos casos el destino (a dónde redirige el NFC) NO se pide acá — se
// configura después, desde el panel del comprador, una vez que pagó.
const isPresencial = document.body.dataset.flow === 'presencial';

applyBrand(isPresencial ? 'Comprá tu sticker' : 'Pedí tu sticker');
initFaqAccordion();

// Atribuye esta visita al sticker "NextTap oficial" del vendedor, si vino con
// el link presencial (?s=<token opaco>) — solo aplica en comprar.html.
// El token se guarda en sessionStorage con timestamp: si el comprador navega
// un rato sin el parámetro en la URL (ej. vuelve del checkout), la atribución
// sigue en pie mientras no pase el TTL; pasado ese tiempo se pierde a propósito
// para no atribuirle la venta a un vendedor con el que ya no está el comprador.
const VENDOR_TOKEN_TTL_MS = 25 * 60_000;
const VENDOR_TOKEN_KEY = 'nexttap_vendedor_token';

function readVendorToken() {
  const params = new URLSearchParams(window.location.search);
  // ?s= es el link nuevo (token opaco); ?ref= es el link viejo (codigo_ref
  // legible) — se acepta como fallback TEMPORAL mientras se reimprimen los
  // stickers ya repartidos. Sacar el fallback a ?ref= una vez reimpresos todos.
  const fromUrl = params.get('s') || params.get('ref');
  if (fromUrl) {
    sessionStorage.setItem(VENDOR_TOKEN_KEY, JSON.stringify({ token: fromUrl, ts: Date.now() }));
    return fromUrl;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(VENDOR_TOKEN_KEY) || 'null');
    if (saved && Date.now() - saved.ts < VENDOR_TOKEN_TTL_MS) return saved.token;
  } catch {
    // sessionStorage corrupto/inaccesible — se ignora, sigue sin atribución
  }
  return null;
}

const vendorToken = readVendorToken();
const refKicker = document.getElementById('buy-ref-kicker');

const PAY_STEP = 6;
// Los pasos "función" y "modelo" viejos se fusionaron en un paso 1 único que
// muestra combos (modelo+función) como opciones, y el paso "carrito" se sacó:
// la cantidad se elige en el mismo paso 1.
const STEP_SEQUENCE = [1, 3, 4, PAY_STEP];

// Mismo patrón que mi-panel.js: en local pasa por el proxy de Vite, en producción
// apunta a la URL pública de la API (Render).
const API_BASE = import.meta.env.VITE_API_BASE || '';

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de conexión con el servidor.');
  return data;
}

const FUNCTIONS = [
  { id: 'whatsapp', icon: BRAND_ICONS.whatsapp, label: 'WhatsApp', desc: 'Abre un chat directo' },
  { id: 'instagram', icon: BRAND_ICONS.instagram, label: 'Instagram', desc: 'Lleva a tu perfil' },
  { id: 'pago', icon: BRAND_ICONS.mercadopago, label: 'Pago', desc: 'Cobrá al instante' },
  { id: 'menu', icon: BRAND_ICONS.menu, label: 'Menú', desc: 'Tu carta digital' },
  { id: 'review', icon: BRAND_ICONS.googleMaps, label: 'Reseña', desc: 'Sumá reseñas en Google' },
  { id: 'web', icon: BRAND_ICONS.web, label: 'Web propia', desc: 'Tu sitio' },
  { id: 'agenda', icon: BRAND_ICONS.googleCalendar, label: 'Agenda', desc: 'Reservas y turnos' },
  { id: 'linktree', icon: BRAND_ICONS.linktree, label: 'LinkTree', desc: 'Todos tus links' },
];

const MODELS = [
  { id: 'llavero', label: 'Llavero', desc: 'Para llevar encima', price: 8500, icon: `<img src="/images/modelo-llavero.png" alt="Llavero" loading="lazy">` },
  { id: 'tarjeta', label: 'Tarjeta', desc: 'Para dejar en el mostrador', price: 7500, icon: `<img src="/images/modelo-tarjeta.png" alt="Tarjeta" loading="lazy">` },
  { id: 'placa', label: 'Placa', desc: 'Para pegar en la pared', price: 11000, icon: `<img src="/images/modelo-placa.png" alt="Placa" loading="lazy">` },
  { id: 'suelto', label: 'Suelto', desc: 'Solo el sticker, sin impresión 3D', price: 4500 },
];

// Precio real por modelo (mismo para cualquier función), cargado desde el
// panel de Admin (ver /api/public/precios). Hasta que resuelva, usamos el
// price de MODELS como fallback.
let PRECIOS_MAP = {};
function getPrecio(modeloId) {
  if (modeloId in PRECIOS_MAP) return PRECIOS_MAP[modeloId];
  return MODELS.find((m) => m.id === modeloId)?.price || 0;
}
api('/public/precios')
  .then((rows) => {
    PRECIOS_MAP = Object.fromEntries(rows.map((r) => [r.modelo, r.precio]));
  })
  .catch(() => {
    // si falla, seguimos con el fallback de MODELS.price
  });

const state = {
  quantities: {}, // comboId -> cantidad elegida (>= 0), una por combo
  cart: [], // se arma al salir del paso 1: un item { functionId, modelId } por unidad
  contacto: '',
  otpVerified: false,
  authToken: null,
};

// Modelo por defecto del flujo online (a pedido, sin límite de stock): ahí el
// paso 1 ofrece todas las funciones sobre este modelo. En el presencial las
// opciones se reemplazan por los combos reales del vendedor (fetch de stock).
const DEFAULT_MODEL = 'llavero';
const MAX_POR_COMBO = 20;

// Cada opción del paso 1 es un combo función+modelo con su propia cantidad. La
// tarjeta muestra la función en grande, el modelo ("<Modelo> NFC") de subtítulo
// y un stepper − N +. `max` = tope de unidades (stock del combo, o 20 online).
function comboItem(funcId, modelId, max = MAX_POR_COMBO) {
  const fn = FUNCTIONS.find((f) => f.id === funcId);
  const model = MODELS.find((m) => m.id === modelId);
  return {
    id: `${modelId}__${funcId}`,
    funcId,
    modelId,
    label: fn ? fn.label : funcId,
    desc: `${model ? model.label : modelId} NFC`,
    icon: fn ? fn.icon : '',
    max: Math.max(1, Math.min(Number(max) || MAX_POR_COMBO, MAX_POR_COMBO)),
  };
}

let comboItems = FUNCTIONS.map((f) => comboItem(f.id, DEFAULT_MODEL));

// Promo del link presencial (?s=<token de promo>), si aplica: { slug, nombre,
// unidadesPack }. La trae /public/vendedores/:ref/stock. null = venta estándar.
let promo = null;

const comboOptions = document.getElementById('combo-options');
const promoNote = document.getElementById('promo-note');

function totalUnidades() {
  return Object.values(state.quantities).reduce((s, n) => s + (n || 0), 0);
}

// Aviso del paso 1 cuando entraste por un link de promo: cuánto falta para el
// pack (el mínimo real lo valida el server en POST /api/ventas).
function renderPromoNote() {
  if (!promoNote) return;
  if (!promo) {
    promoNote.hidden = true;
    return;
  }
  const faltan = promo.unidadesPack - totalUnidades();
  promoNote.hidden = false;
  if (faltan <= 0) {
    promoNote.className = 'wizard-step-note is-ok';
    promoNote.textContent = `✓ Descuento ${promo.nombre} aplicado.`;
  } else {
    promoNote.className = 'wizard-step-note is-warn';
    promoNote.textContent =
      totalUnidades() === 0
        ? `Entraste con un link ${promo.nombre}: elegí al menos ${promo.unidadesPack} unidades para el descuento.`
        : `Sumá ${faltan} más para el ${promo.nombre}.`;
  }
}

function setQty(item, n) {
  const q = Math.max(0, Math.min(n, item.max));
  if (q === 0) delete state.quantities[item.id];
  else state.quantities[item.id] = q;
  renderCombos();
  updateNextButton();
}

function renderCombos() {
  comboOptions.innerHTML = '';
  if (!comboItems.length) {
    comboOptions.innerHTML =
      '<p class="modal-status is-error">Este vendedor no tiene stock disponible en este momento.</p>';
    return;
  }
  comboItems.forEach((item) => {
    const qty = state.quantities[item.id] || 0;
    const card = document.createElement('div');
    card.className = 'option-card combo-card' + (qty > 0 ? ' is-selected' : '');
    card.dataset.id = item.id;
    card.innerHTML = `
      <div class="option-text">
        <div class="option-label">${item.label}</div>
        <div class="option-desc">${item.desc}</div>
      </div>
      <div class="combo-right">
        ${item.icon ? `<div class="option-icon">${item.icon}</div>` : ''}
        <div class="combo-stepper">
          <button type="button" class="combo-minus" aria-label="Restar"${qty === 0 ? ' disabled' : ''}>−</button>
          <span class="combo-qty">${qty}</span>
          <button type="button" class="combo-plus" aria-label="Sumar"${qty >= item.max ? ' disabled' : ''}>+</button>
        </div>
      </div>
    `;
    card.querySelector('.combo-minus').addEventListener('click', () => setQty(item, qty - 1));
    card.querySelector('.combo-plus').addEventListener('click', () => setQty(item, qty + 1));
    comboOptions.appendChild(card);
  });
  renderPromoNote();
}
renderCombos();

// Arma el carrito con las cantidades de cada combo del paso 1. Se llama al salir
// del paso 1, así volver atrás y cambiar rehace todo.
function syncCartFromStep1() {
  state.cart = [];
  comboItems.forEach((item) => {
    const n = state.quantities[item.id] || 0;
    for (let i = 0; i < n; i++) state.cart.push({ functionId: item.funcId, modelId: item.modelId });
  });
}

// Venta presencial: el vendedor solo tiene consigo los impresos 3D (con su NFC
// ya adentro) que el admin le cargó a él — el comprador solo puede elegir un
// combo (modelo+función) que ese vendedor tenga físicamente en mano.
if (isPresencial && vendorToken) {
  api(`/public/vendedores/${vendorToken}/stock`)
    .then((data) => {
      refKicker.textContent = `Recomendado por ${data.vendedor}`;
      promo = data.promo || null;
      const combos = (data.combos || []).filter((c) => c.cantidad > 0 && c.funcion);
      if (combos.length) {
        comboItems = combos.map((c) => comboItem(c.funcion, c.modelo, c.cantidad));
      } else {
        // El vendedor tiene stock pero sin función asignada (falta cargarla en
        // Admin) — no lo dejamos sin vender: ofrecemos todas las funciones sobre
        // los modelos que sí tiene en mano (tope = stock total de ese modelo).
        const conStock = (data.modelos || []).filter((m) => m.cantidad > 0);
        const modelos = conStock.length ? conStock : [{ modelo: DEFAULT_MODEL, cantidad: MAX_POR_COMBO }];
        comboItems = modelos.flatMap((m) => FUNCTIONS.map((f) => comboItem(f.id, m.modelo, m.cantidad)));
      }
      renderCombos();
      updateNextButton();
    })
    .catch(() => {
      // si falla la consulta, dejamos el catálogo completo como fallback
    });
}

const modal = document.getElementById('wizard-modal');
const startButton = document.getElementById('start-wizard');
const closeButton = document.getElementById('wizard-close');
const backButton = document.getElementById('wizard-back');
const nextButton = document.getElementById('wizard-next');
const payButton = document.getElementById('wizard-pay');
const doneButton = document.getElementById('wizard-done');
const wizardNav = document.getElementById('wizard-nav');
const progressEl = document.getElementById('wizard-progress');
const steps = [...document.querySelectorAll('.wizard-step')];
const tycCheckbox = document.getElementById('wizard-tyc');
const whatsappInput = document.getElementById('wizard-whatsapp');
const verifTitleEl = document.getElementById('verif-title');
const verifLabelEl = document.getElementById('verif-label');
const sendOtpButton = document.getElementById('send-otp');

// Canal de verificación activo (email / whatsapp / ...). Lo define el backend;
// acá solo adaptamos los textos y el tipo de input. Fallback razonable por si
// /auth/config no responde.
const verif = { canal: 'email', nombre: 'email', tipoInput: 'email', placeholder: 'vos@ejemplo.com' };
api('/auth/config')
  .then((cfg) => {
    if (!cfg?.verificacion) return;
    Object.assign(verif, cfg.verificacion);
    whatsappInput.type = verif.tipoInput;
    whatsappInput.placeholder = verif.placeholder;
    if (verifTitleEl) verifTitleEl.textContent = `Validá tu ${verif.nombre}`;
    if (verifLabelEl) verifLabelEl.textContent = `Tu ${verif.nombre}`;
    sendOtpButton.textContent = `📲 Enviar código por ${verif.nombre}`;
  })
  .catch(() => {});
const otpCodeField = document.getElementById('otp-code-field');
const otpInput = document.getElementById('wizard-otp');
const confirmOtpButton = document.getElementById('confirm-otp');
const otpStatus = document.getElementById('otp-status');
const summaryBox = document.getElementById('wizard-summary');
const successSummary = document.getElementById('wizard-success-summary');

progressEl.innerHTML = STEP_SEQUENCE.map(() => '<span class="wizard-dot"></span>').join('');
const dots = [...progressEl.querySelectorAll('.wizard-dot')];

let currentStep = STEP_SEQUENCE[0];

function showStep(step) {
  currentStep = step;
  const seqIndex = STEP_SEQUENCE.indexOf(step);

  steps.forEach((el) => el.classList.toggle('is-active', el.dataset.step === String(step)));
  dots.forEach((dot, i) => {
    dot.classList.toggle('is-active', i === seqIndex);
    dot.classList.toggle('is-done', i < seqIndex || step === 'success');
  });

  const activeStepEl = steps.find((el) => el.dataset.step === String(step));
  const kickerEl = activeStepEl?.querySelector('.step-kicker');
  if (kickerEl) kickerEl.textContent = `Paso ${seqIndex + 1} de ${STEP_SEQUENCE.length}`;

  const isFormStep = step !== PAY_STEP && step !== 'success';
  wizardNav.hidden = !isFormStep;
  backButton.disabled = seqIndex <= 0;

  if (step === PAY_STEP) {
    renderSummary();
  }
  updateNextButton();
}

function updateNextButton() {
  if (currentStep === 1) {
    const total = totalUnidades();
    // Con link de promo, no se puede avanzar sin llegar al pack (el server
    // igual lo rechazaría con 400).
    nextButton.disabled = total === 0 || (promo && total < promo.unidadesPack);
  }
  else if (currentStep === 3) nextButton.disabled = !tycCheckbox.checked;
  else if (currentStep === 4) nextButton.disabled = !state.otpVerified;
  else nextButton.disabled = false;
}

tycCheckbox.addEventListener('change', updateNextButton);
whatsappInput.addEventListener('input', () => {
  sendOtpButton.disabled = !whatsappInput.value.trim();
});

sendOtpButton.addEventListener('click', async () => {
  const destino = whatsappInput.value.trim();
  if (!destino) return;
  sendOtpButton.disabled = true;
  try {
    const data = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ destino }) });
    otpCodeField.hidden = false;
    otpStatus.className = 'modal-status';
    otpStatus.textContent = data.debug_otp
      ? `Código autocompletado (demo, no hay ${verif.nombre} real conectado).`
      : 'Código enviado.';
    if (data.debug_otp) otpInput.value = data.debug_otp;
    sendOtpButton.textContent = '📲 Reenviar código';
  } catch (err) {
    otpStatus.className = 'modal-status is-error';
    otpStatus.textContent = err.message;
  } finally {
    sendOtpButton.disabled = false;
  }
});

confirmOtpButton.addEventListener('click', async () => {
  const destino = whatsappInput.value.trim();
  const code = otpInput.value.trim();
  if (!code) {
    otpStatus.textContent = 'Ingresá el código.';
    otpStatus.className = 'modal-status is-error';
    return;
  }
  confirmOtpButton.disabled = true;
  try {
    const data = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ destino, code }) });
    state.otpVerified = true;
    state.authToken = data.token;
    sessionStorage.setItem('tap_panel_token', data.token);
    otpStatus.textContent = '✓ Verificado.';
    otpStatus.className = 'modal-status is-success';
    whatsappInput.disabled = true;
    sendOtpButton.disabled = true;
    otpInput.disabled = true;
    updateNextButton();
    // Confirmado el código, avanza solo al siguiente paso — no hace falta
    // que el usuario toque "Siguiente" a mano.
    const i = STEP_SEQUENCE.indexOf(currentStep);
    if (i < STEP_SEQUENCE.length - 1) showStep(STEP_SEQUENCE[i + 1]);
  } catch (err) {
    otpStatus.textContent = err.message;
    otpStatus.className = 'modal-status is-error';
    confirmOtpButton.disabled = false;
    updateNextButton();
  }
});

function renderSummary() {
  state.contacto = whatsappInput.value.trim();

  const total = state.cart.reduce((sum, item) => sum + getPrecio(item.modelId), 0);
  // El carrito son N unidades del mismo combo (paso 1) — se agrupa para el resumen.
  const groups = [];
  state.cart.forEach((item) => {
    const key = `${item.modelId}__${item.functionId}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.qty += 1;
    else groups.push({ key, ...item, qty: 1 });
  });
  summaryBox.innerHTML = `
    <div class="cart-summary-title">Tu compra (${state.cart.length} unidad${state.cart.length === 1 ? '' : 'es'})</div>
    ${groups
      .map((item) => {
        const fn = FUNCTIONS.find((f) => f.id === item.functionId);
        const model = MODELS.find((m) => m.id === item.modelId);
        const precio = getPrecio(item.modelId);
        return `<div><span class="inline-icon">${fn.icon}</span> <b>${model.label} · ${fn.label}</b>${item.qty > 1 ? ` ×${item.qty}` : ''} — $${(precio * item.qty).toLocaleString('es-AR')}</div>`;
      })
      .join('')}
    <div><b>${verif.nombre}:</b> ${state.contacto}</div>
    <div class="wizard-pay-note">Pagás y ya podés empezar a usar tu NFC. El destino de cada uno (a dónde redirige) lo vas a poder configurar y editar cuando quieras, desde tu panel.</div>
  `;
  payButton.textContent = `Pagar $${total.toLocaleString('es-AR')} y empezar a usar mi NFC`;
  payButton.disabled = state.cart.length === 0;
}

function openWizard() {
  Object.assign(state, {
    quantities: {},
    cart: [],
    contacto: '',
    otpVerified: false,
  });
  renderCombos();
  tycCheckbox.checked = false;
  whatsappInput.value = '';
  whatsappInput.disabled = false;
  sendOtpButton.disabled = true;
  sendOtpButton.textContent = `📲 Enviar código por ${verif.nombre}`;
  otpCodeField.hidden = true;
  otpInput.value = '';
  otpInput.disabled = false;
  confirmOtpButton.disabled = false;
  otpStatus.textContent = '';
  otpStatus.className = 'modal-status';
  payButton.disabled = false;
  payButton.textContent = 'Pagar';
  closeTyc();
  showStep(STEP_SEQUENCE[0]);
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeWizard() {
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

startButton.addEventListener('click', openWizard);
closeButton.addEventListener('click', closeWizard);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeWizard();
});

// Full Términos y Condiciones — opens on top of the wizard, closes back to it.
const tycModal = document.getElementById('tyc-modal');
const openTycButton = document.getElementById('open-tyc');
const closeTycButton = document.getElementById('tyc-close');

function openTyc() {
  tycModal.classList.add('is-open');
  tycModal.setAttribute('aria-hidden', 'false');
}
function closeTyc() {
  tycModal.classList.remove('is-open');
  tycModal.setAttribute('aria-hidden', 'true');
}
openTycButton.addEventListener('click', openTyc);
closeTycButton.addEventListener('click', closeTyc);
tycModal.addEventListener('click', (e) => {
  if (e.target === tycModal) closeTyc();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (tycModal.classList.contains('is-open')) closeTyc();
  else if (modal.classList.contains('is-open')) closeWizard();
});

nextButton.addEventListener('click', () => {
  if (currentStep === 1) syncCartFromStep1();
  const i = STEP_SEQUENCE.indexOf(currentStep);
  if (i < STEP_SEQUENCE.length - 1) showStep(STEP_SEQUENCE[i + 1]);
});
backButton.addEventListener('click', () => {
  const i = STEP_SEQUENCE.indexOf(currentStep);
  if (i > 0) showStep(STEP_SEQUENCE[i - 1]);
});

payButton.addEventListener('click', async () => {
  payButton.disabled = true;
  payButton.textContent = 'Redirigiendo a Mercado Pago...';
  try {
    const items = state.cart.map((item) => ({ modelo: item.modelId, destinoTipo: item.functionId, destinoValor: '' }));
    const data = await api('/ventas', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ items, vendedorToken: vendorToken || '' }),
    });
    // Mercado Pago se encarga del cobro real — al volver, back_urls trae ?venta=&pago=.
    window.location.href = data.initPoint;
  } catch (err) {
    payButton.disabled = false;
    payButton.textContent = 'Pagar';
    alert(err.message);
  }
});

doneButton.addEventListener('click', closeWizard);

// Vuelta desde Mercado Pago (back_urls de la preferencia) — el pago en sí ya se
// resolvió allá; acá solo mostramos el resultado. La confirmación real (activar
// el/los sticker/s) la hace el webhook server-to-server, no esta vista.
async function checkReturnFromMercadoPago() {
  const params = new URLSearchParams(window.location.search);
  const ventaId = params.get('venta');
  const pago = params.get('pago');
  if (!ventaId || !pago) return;

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  wizardNav.hidden = true;
  showStep('success');

  if (pago === 'error') {
    successSummary.textContent = 'El pago no se pudo completar. No te cobramos nada — podés intentar de nuevo.';
    return;
  }

  successSummary.textContent = 'Confirmando tu pago con Mercado Pago...';
  // El webhook puede tardar unos segundos más que el redirect del usuario — reintentamos brevemente.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const token = state.authToken || sessionStorage.getItem('tap_panel_token');
      if (!token) break;
      const venta = await api(`/ventas/${ventaId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (venta.estadoPago === 'confirmado') {
        // Mostramos el ID de cada sticker para que el comprador pueda cotejarlo
        // contra el que le entrega el vendedor en mano — si no coincide, es la
        // señal de que se equivocaron de imprimible.
        const detalle = venta.items
          .map((it) => `<div><b>${it.modelo}</b>: tu ID es <code class="pickup-id">${it.stickerCodigo}</code></div>`)
          .join('');
        successSummary.innerHTML = `
          ${venta.items.length > 1 ? 'Tus stickers ya están activos.' : 'Tu sticker ya está activo.'}
          ${detalle}
          <div class="wizard-pay-note">Fijate que el ID que te entregue el vendedor coincida con este — así te asegurás de llevarte el que es. Te llevamos a tu panel para configurar el destino...</div>
        `;
        setTimeout(() => {
          window.location.href = '/mi-panel.html';
        }, 5000);
        return;
      }
      if (venta.estadoPago === 'rechazado') {
        successSummary.textContent = 'El pago fue rechazado. No te cobramos nada — podés intentar de nuevo.';
        return;
      }
    } catch {
      break;
    }
  }
  successSummary.textContent = 'Tu pago está en revisión. Te avisamos por WhatsApp apenas se confirme.';
}
checkReturnFromMercadoPago();
