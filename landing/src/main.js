import './styles.css';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';

applyBrand('Conectá con tus clientes en un toque');
initFaqAccordion();

// Hero tag: cycle through the destinations a tap can open, con su ícono.
const TAG_ICONS = {
  WhatsApp: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 8c-8.8 0-16 6.6-16 14.7 0 4 1.7 7.6 4.5 10.3L11 40l7.4-2.4c1.7.6 3.6.9 5.6.9 8.8 0 16-6.6 16-14.7S32.8 8 24 8z"/>
    <path d="M17 21.5c0-.5.4-1 1-1h1.2c.4 0 .8.3.9.7l.8 2.5c.1.4 0 .8-.3 1l-1 .9c1 2 2.6 3.6 4.6 4.6l.9-1c.3-.3.7-.4 1-.3l2.5.8c.4.1.7.5.7.9V32c0 .6-.4 1-1 1h-1c-6.1 0-11-4.9-11-11v-.5z"/>
  </svg>`,
  Instagram: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="7" y="7" width="34" height="34" rx="9"/>
    <circle cx="24" cy="24" r="8"/>
    <circle cx="33" cy="15" r="1.5" fill="currentColor" stroke="none"/>
  </svg>`,
  'Menú': `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 6v13a3 3 0 003 3 3 3 0 003-3V6M15 6v10M21 6v10M18 22v20"/>
    <path d="M33 6c-3.2 0-5.5 3.4-5.5 8.5S29.8 23 33 23M33 6v36"/>
  </svg>`,
  Pago: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="7" y="13" width="34" height="24" rx="4"/>
    <line x1="7" y1="20" x2="41" y2="20"/>
    <line x1="13" y1="30" x2="23" y2="30"/>
  </svg>`,
  'Reseña': `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 6l5.4 11.4L42 19.2l-9 8.9 2.1 12.7L24 34.9l-11.1 5.9L15 28.1l-9-8.9 12.6-1.8L24 6z"/>
  </svg>`,
};
const dests = Object.keys(TAG_ICONS);
const tagDest = document.getElementById('tagdest');
const tagIcon = document.getElementById('tagicon');
let destIndex = 0;

function cycleDest() {
  tagDest.style.opacity = 0;
  if (tagIcon) tagIcon.style.opacity = 0;
  setTimeout(() => {
    const dest = dests[destIndex % dests.length];
    tagDest.textContent = '→ ' + dest;
    tagDest.style.opacity = 1;
    if (tagIcon) {
      tagIcon.innerHTML = TAG_ICONS[dest];
      tagIcon.style.opacity = 1;
    }
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
  const FADE_RANGE = 320; // px de transición antes del límite
  // El límite tiene que quedar resuelto antes de que "Formatos" empiece a
  // entrar en pantalla, no recién cuando su borde superior llega al tope.
  function computeFadeEnd() {
    return formatosEl ? Math.max(formatosEl.offsetTop - window.innerHeight, 0) : Infinity;
  }
  let buffer = window.innerHeight * 0.08;
  let fadeEnd = computeFadeEnd();
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
    fadeEnd = computeFadeEnd();
    applyEffects();
  });
  // Las fuentes web pueden correr el layout después del primer render;
  // recalculamos el límite cuando terminan de cargar.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      fadeEnd = computeFadeEnd();
      applyEffects();
    });
  }
  applyEffects();
}
