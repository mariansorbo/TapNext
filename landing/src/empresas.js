import './styles.css';
import './pixel.js';
import './pap.js';
import './visita.js';
import './nav-sesion.js';
import './empresas-demo.js';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';
import { colorMayoritario, paletaPantalla } from './color-logo.js';
import { encuadreAutomatico, colorDeBordes } from './encuadre.js';

applyBrand('Para empresas');
initFaqAccordion();

// Botón del combo: antes de ir a WhatsApp, un modal chico pregunta por un
// código de referido. No se valida: viaja en el mensaje y el descuento se
// aplica a mano al cotizar. Sin JS, el link va directo a WhatsApp.
const WHATSAPP = 'https://wa.me/541171082780';
const MENSAJE_COMBO = 'Hola, quiero el combo de fin de año para mi equipo.';

function initReferido() {
  const botones = document.querySelectorAll('[data-referido]');
  if (!botones.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay referido-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="referido-titulo">
      <button type="button" class="modal-close" aria-label="Cerrar">✕</button>
      <h3 id="referido-titulo">¿Tenés un código de referido?</h3>
      <p class="modal-sub">Si alguien te recomendó NextTap, ingresá su código y te aplicamos el descuento en la cotización.</p>
      <form class="modal-form" novalidate>
        <label>Código de referido
          <input type="text" name="codigo" placeholder="Ej: JUAN10" autocomplete="off" autocapitalize="characters" maxlength="30">
        </label>
        <button type="submit" class="btn-primary modal-submit">Continuar a WhatsApp</button>
        <button type="button" class="btn-ghost referido-sin" data-sin-codigo>No tengo código</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('form');
  const input = form.querySelector('input');

  const abrir = () => {
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => input.focus(), 50);
  };
  const cerrar = () => {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  };
  const irAWhatsApp = (codigo) => {
    const texto = codigo ? `${MENSAJE_COMBO} Tengo el código de referido: ${codigo}` : MENSAJE_COMBO;
    window.open(`${WHATSAPP}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    cerrar();
    form.reset();
  };

  botones.forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      abrir();
    }),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    irAWhatsApp(input.value.trim().toUpperCase());
  });
  form.querySelector('[data-sin-codigo]').addEventListener('click', () => irAWhatsApp(''));
  overlay.querySelector('.modal-close').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) cerrar();
  });
}
initReferido();

// "Subís tu logo y listo": tiras de pantallas del tap con logos inventados de
// la página de prueba. Encuadre y fondo calculados igual que el editor de Mi
// panel (src/encuadre.js, src/color-logo.js), sin nada escrito a mano.
const LOGOS = [
  'cafe-brasa.svg',
  'gimnasio-fuerza.svg',
  'vivero-verde-raiz.svg',
  'pixel-norte.svg',
  'sastreria-ortiz.svg',
  'heladeria-polo.svg',
];
const LADO = 300;

const tira = document.getElementById('emp-logos');

function cargar(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function colorDe(canvas) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, 128, 128);
  return colorMayoritario(ctx.getImageData(0, 0, 128, 128).data);
}

if (tira) {
  LOGOS.forEach(async (logo) => {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'emp-logo-pantalla';
    tarjeta.innerHTML = '<div class="emp-org-img"><img alt=""></div><div class="emp-mark">Next<span class="tap">Tap</span></div>';
    tira.appendChild(tarjeta);
    try {
      const cuadro = encuadreAutomatico(await cargar(`/images/prueba-logos/${logo}`)).canvas;
      const chico = document.createElement('canvas');
      chico.width = chico.height = LADO;
      chico.getContext('2d').drawImage(cuadro, 0, 0, LADO, LADO);
      tarjeta.querySelector('img').src = chico.toDataURL('image/png');
      const p = paletaPantalla(colorDe(cuadro), colorDeBordes(cuadro));
      tarjeta.style.setProperty('--fondo', p.fondo);
      tarjeta.style.setProperty('--texto', p.texto);
      tarjeta.style.setProperty('--pista', p.pista);
      tarjeta.style.setProperty('--acento', p.acento);
      tarjeta.style.setProperty('--acento-texto', p.acentoTexto);
      tarjeta.style.setProperty('--sombra', p.sombra);
    } catch {
      tarjeta.remove();
    }
  });
}
