import './styles.css';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';

// comprar.html (presencial): el vendedor entrega el sticker en mano, sin envío.
// pedido.html (compra regular por la web): hay que despachar el sticker, así que suma el paso de delivery.
const isPresencial = document.body.dataset.flow === 'presencial';

applyBrand(isPresencial ? 'Creá tu sticker' : 'Pedí tu sticker');
initFaqAccordion();

// Attribute this visit to a vendor's demo sticker, if present (?ref=nacho) — solo aplica en comprar.html.
const ref = new URLSearchParams(window.location.search).get('ref');
const refKicker = document.getElementById('buy-ref-kicker');
if (ref) {
  refKicker.textContent = `Recomendado por ${ref}`;
}

const PAY_STEP = 6;
const STEP_SEQUENCE = isPresencial ? [1, 2, 3, 4, PAY_STEP] : [1, 2, 3, 4, 5, PAY_STEP];

const FUNCTIONS = [
  { id: 'whatsapp', label: 'WhatsApp', desc: 'Abre un chat directo', fieldLabel: 'Tu link de WhatsApp', placeholder: 'wa.me/5491112345678' },
  { id: 'instagram', label: 'Instagram', desc: 'Lleva a tu perfil', fieldLabel: 'Tu usuario de Instagram', placeholder: 'instagram.com/tunegocio' },
  { id: 'pago', label: 'Pago', desc: 'Cobrá al instante', fieldLabel: 'Tu link de pago', placeholder: 'link.mercadopago.com.ar/...' },
  { id: 'menu', label: 'Menú', desc: 'Tu carta digital', fieldLabel: 'Link a tu menú', placeholder: 'tunegocio.com/menu' },
  { id: 'review', label: 'Reseña', desc: 'Sumá reseñas en Google', fieldLabel: 'Tu link de reseñas de Google', placeholder: 'g.page/r/...' },
  { id: 'web', label: 'Web propia', desc: 'Tu sitio', fieldLabel: 'Tu sitio web', placeholder: 'tunegocio.com' },
  { id: 'agenda', label: 'Agenda', desc: 'Reservas y turnos', fieldLabel: 'Tu link de reservas', placeholder: 'calendly.com/tunegocio' },
  { id: 'linktree', label: 'LinkTree', desc: 'Todos tus links', fieldLabel: 'Tus links (los armamos juntos)', placeholder: 'Contanos qué links querés incluir' },
];

const MODELS = [
  { id: 'llavero', label: 'Llavero', desc: 'Para llevar encima', price: 8500 },
  { id: 'tarjeta', label: 'Tarjeta', desc: 'Para dejar en el mostrador', price: 7500 },
  { id: 'placa', label: 'Placa', desc: 'Para pegar fija', price: 11000 },
];

const state = {
  functionId: null,
  modelId: null,
  destination: '',
  whatsapp: '',
  otpVerified: false,
  deliveryCp: '',
  deliveryPrice: null,
  deliveryPlazo: null,
};

function renderOptions(container, items, key) {
  container.innerHTML = '';
  items.forEach((item) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'option-card';
    card.dataset.id = item.id;
    card.innerHTML = `<div class="option-label">${item.label}</div><div class="option-desc">${item.desc}</div>`;
    card.addEventListener('click', () => {
      state[key] = item.id;
      container.querySelectorAll('.option-card').forEach((c) => c.classList.remove('is-selected'));
      card.classList.add('is-selected');
      updateNextButton();
    });
    container.appendChild(card);
  });
}

const functionOptions = document.getElementById('function-options');
const modelOptions = document.getElementById('model-options');
renderOptions(functionOptions, FUNCTIONS, 'functionId');
renderOptions(modelOptions, MODELS, 'modelId');

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
const destinationLabel = document.getElementById('destination-label');
const destinationInput = document.getElementById('destination-value');
const tycCheckbox = document.getElementById('wizard-tyc');
const whatsappInput = document.getElementById('wizard-whatsapp');
const sendOtpButton = document.getElementById('send-otp');
const otpCodeField = document.getElementById('otp-code-field');
const otpInput = document.getElementById('wizard-otp');
const confirmOtpButton = document.getElementById('confirm-otp');
const otpStatus = document.getElementById('otp-status');
const deliveryCpInput = document.getElementById('delivery-cp');
const calcDeliveryButton = document.getElementById('calc-delivery');
const deliveryResult = document.getElementById('delivery-result');
const summaryBox = document.getElementById('wizard-summary');
const successSummary = document.getElementById('wizard-success-summary');

// Dots: uno por paso de la secuencia activa (5 en presencial, 6 con delivery).
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
  backButton.disabled = seqIndex === 0;

  if (step === 3) {
    const fn = FUNCTIONS.find((f) => f.id === state.functionId);
    destinationLabel.textContent = fn.fieldLabel;
    destinationInput.placeholder = fn.placeholder;
  }
  if (step === PAY_STEP) {
    renderSummary();
  }
  updateNextButton();
}

function updateNextButton() {
  if (currentStep === 1) nextButton.disabled = !state.functionId;
  else if (currentStep === 2) nextButton.disabled = !state.modelId;
  else if (currentStep === 3) nextButton.disabled = !(destinationInput.value.trim() && tycCheckbox.checked);
  else if (currentStep === 4) nextButton.disabled = !state.otpVerified;
  else if (currentStep === 5) nextButton.disabled = state.deliveryPrice === null;
  else nextButton.disabled = false;
}

destinationInput.addEventListener('input', updateNextButton);
tycCheckbox.addEventListener('change', updateNextButton);
whatsappInput.addEventListener('input', () => {
  sendOtpButton.disabled = !whatsappInput.value.trim();
});

// OTP is simulated client-side — no real WhatsApp/SMS is sent, this is UI-only.
sendOtpButton.addEventListener('click', () => {
  if (!whatsappInput.value.trim()) return;
  otpCodeField.hidden = false;
  otpStatus.textContent = '';
  otpStatus.className = 'modal-status';
  sendOtpButton.textContent = 'Reenviar código';
});

confirmOtpButton.addEventListener('click', () => {
  if (!otpInput.value.trim()) {
    otpStatus.textContent = 'Ingresá el código.';
    otpStatus.className = 'modal-status is-error';
    return;
  }
  state.otpVerified = true;
  otpStatus.textContent = '✓ Número verificado.';
  otpStatus.className = 'modal-status is-success';
  whatsappInput.disabled = true;
  sendOtpButton.disabled = true;
  otpInput.disabled = true;
  confirmOtpButton.disabled = true;
  updateNextButton();
});

// Delivery es simulado — no hay integración real con un correo/courier todavía.
calcDeliveryButton.addEventListener('click', () => {
  const cp = deliveryCpInput.value.trim();
  if (!cp) return;
  calcDeliveryButton.disabled = true;
  calcDeliveryButton.textContent = 'Calculando...';

  setTimeout(() => {
    const digitSum = (cp.match(/\d/g) || []).reduce((sum, d) => sum + Number(d), 0) || 1;
    const price = Math.round((1200 + digitSum * 45) / 50) * 50;
    const plazoOptions = ['2-3 días hábiles', '3-5 días hábiles', '5-7 días hábiles'];
    const plazo = plazoOptions[digitSum % plazoOptions.length];

    state.deliveryCp = cp;
    state.deliveryPrice = price;
    state.deliveryPlazo = plazo;

    deliveryResult.hidden = false;
    deliveryResult.innerHTML = `<div><b>Envío a CP ${cp}:</b> $${price.toLocaleString('es-AR')} · Llega en ${plazo}.</div>`;
    calcDeliveryButton.disabled = false;
    calcDeliveryButton.textContent = 'Recalcular';
    updateNextButton();
  }, 700);
});

function renderSummary() {
  const fn = FUNCTIONS.find((f) => f.id === state.functionId);
  const model = MODELS.find((m) => m.id === state.modelId);
  state.destination = destinationInput.value.trim();
  state.whatsapp = whatsappInput.value.trim();

  const hasDelivery = !isPresencial && state.deliveryPrice !== null;
  const total = model.price + (hasDelivery ? state.deliveryPrice : 0);

  summaryBox.innerHTML = `
    <div><b>Función:</b> ${fn.label}</div>
    <div><b>Modelo:</b> ${model.label}</div>
    <div><b>Destino:</b> ${state.destination}</div>
    <div><b>WhatsApp:</b> ${state.whatsapp}</div>
    ${hasDelivery ? `<div><b>Envío a CP ${state.deliveryCp}:</b> $${state.deliveryPrice.toLocaleString('es-AR')} · ${state.deliveryPlazo}</div>` : ''}
  `;
  payButton.textContent = `Pagar $${total.toLocaleString('es-AR')}`;
  payButton.disabled = false;
}

function openWizard() {
  Object.assign(state, {
    functionId: null,
    modelId: null,
    destination: '',
    whatsapp: '',
    otpVerified: false,
    deliveryCp: '',
    deliveryPrice: null,
    deliveryPlazo: null,
  });
  functionOptions.querySelectorAll('.option-card').forEach((c) => c.classList.remove('is-selected'));
  modelOptions.querySelectorAll('.option-card').forEach((c) => c.classList.remove('is-selected'));
  destinationInput.value = '';
  tycCheckbox.checked = false;
  whatsappInput.value = '';
  whatsappInput.disabled = false;
  sendOtpButton.disabled = true;
  sendOtpButton.textContent = 'Enviar código por WhatsApp';
  otpCodeField.hidden = true;
  otpInput.value = '';
  otpInput.disabled = false;
  confirmOtpButton.disabled = false;
  otpStatus.textContent = '';
  otpStatus.className = 'modal-status';
  deliveryCpInput.value = '';
  deliveryResult.hidden = true;
  deliveryResult.innerHTML = '';
  calcDeliveryButton.disabled = false;
  calcDeliveryButton.textContent = 'Calcular envío';
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
  const i = STEP_SEQUENCE.indexOf(currentStep);
  if (i < STEP_SEQUENCE.length - 1) showStep(STEP_SEQUENCE[i + 1]);
});
backButton.addEventListener('click', () => {
  const i = STEP_SEQUENCE.indexOf(currentStep);
  if (i > 0) showStep(STEP_SEQUENCE[i - 1]);
});

// No real payment processor connected yet — this simulates the wait and outcome.
payButton.addEventListener('click', () => {
  payButton.disabled = true;
  payButton.textContent = 'Procesando pago...';
  setTimeout(() => {
    const fn = FUNCTIONS.find((f) => f.id === state.functionId);
    const model = MODELS.find((m) => m.id === state.modelId);
    const deliveryNote = !isPresencial && state.deliveryPrice !== null
      ? ` Lo enviamos a CP ${state.deliveryCp}, llega en ${state.deliveryPlazo}.`
      : '';
    successSummary.textContent = `Sticker ${model.label} configurado para ${fn.label} → ${state.destination}.${deliveryNote}`;
    showStep('success');
  }, 1800);
});

doneButton.addEventListener('click', closeWizard);
