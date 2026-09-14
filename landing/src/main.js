import './styles.css';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';

applyBrand('Conectá con tus clientes en un toque');
initFaqAccordion();

// Hero tag: cycle through the destinations a tap can open.
const dests = ['WhatsApp', 'Instagram', 'Menú', 'Pago', 'Reseña'];
const tagDest = document.getElementById('tagdest');
let destIndex = 0;

function cycleDest() {
  tagDest.style.opacity = 0;
  setTimeout(() => {
    tagDest.textContent = '→ ' + dests[destIndex % dests.length];
    tagDest.style.opacity = 1;
    destIndex++;
  }, 300);
}

if (tagDest) {
  cycleDest();
  setInterval(cycleDest, 2200);
}

// Fondo de video con parallax: el fondo se mueve más lento que el contenido,
// y se desvanece a fondo sólido al llegar a la sección "Formatos".
const bgVideo = document.querySelector('.bg-video');
const bgOverlay = document.querySelector('.bg-video-overlay');
const bgFill = document.querySelector('.bg-video-fill');
const formatosEl = document.getElementById('formatos');

if (bgVideo) {
  // Algunos navegadores/webviews móviles ignoran el autoplay del HTML;
  // forzamos el play() y reintentamos en el primer toque/scroll si quedó pausado.
  bgVideo.muted = true;
  const tryPlay = () => bgVideo.play().catch(() => {});
  tryPlay();
  ['touchstart', 'scroll', 'click'].forEach((evt) => {
    window.addEventListener(evt, () => { if (bgVideo.paused) tryPlay(); }, { passive: true, once: true });
  });

  const SPEED = 0.15; // 0 = fondo fijo, 1 = misma velocidad que el scroll
  const FADE_RANGE = 320; // px de transición antes de llegar a "Formatos"
  let buffer = window.innerHeight * 0.08;
  let fadeEnd = formatosEl ? formatosEl.offsetTop : Infinity;
  let ticking = false;
  let hidden = false;

  function applyEffects() {
    const y = window.scrollY;

    const offset = Math.min(y * SPEED, buffer);
    bgVideo.style.transform = `translate3d(0, ${-offset}px, 0)`;

    const fadeStart = fadeEnd - FADE_RANGE;
    const opacity = fadeEnd === Infinity
      ? 1
      : Math.min(Math.max(1 - (y - fadeStart) / FADE_RANGE, 0), 1);
    bgVideo.style.opacity = opacity;
    if (bgOverlay) bgOverlay.style.opacity = opacity;
    if (bgFill) bgFill.style.opacity = opacity;

    if (opacity === 0 && !hidden) {
      bgVideo.pause();
      hidden = true;
    } else if (opacity > 0 && hidden) {
      bgVideo.play();
      hidden = false;
    }

    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(applyEffects);
      ticking = true;
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    buffer = window.innerHeight * 0.08;
    fadeEnd = formatosEl ? formatosEl.offsetTop : Infinity;
    applyEffects();
  });
  applyEffects();
}
