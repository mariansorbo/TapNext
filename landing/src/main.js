import './styles.css';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';

applyBrand('Conectá con tus clientes en un toque');
initFaqAccordion();

// Hero tag: cycle through the destinations a tap can open. La cajita crece
// y se achica (pulso) en cada cambio, sincronizado con el fade del ícono.
const TAG_ICONS = {
  WhatsApp: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.06L2 22l5.06-1.33A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm5.2 14.2c-.22.62-1.28 1.18-1.76 1.25-.45.07-1.02.1-1.64-.1-.38-.12-.87-.28-1.5-.55-2.64-1.14-4.36-3.8-4.5-3.98-.13-.18-1.07-1.42-1.07-2.72 0-1.3.68-1.93.92-2.2.24-.26.53-.33.71-.33h.5c.16 0 .38-.06.6.46.22.53.75 1.83.82 1.96.07.13.11.29.02.47-.09.18-.14.29-.27.45-.13.16-.28.36-.4.48-.13.13-.27.28-.12.55.16.27.7 1.16 1.5 1.88.99.9 1.85 1.18 2.12 1.31.27.13.43.11.6-.05.16-.17.65-.76.82-1.02.17-.26.35-.22.58-.13.24.08 1.5.71 1.76.84.26.13.43.19.49.3.06.11.06.65-.16 1.23z"/></svg>`,
  Instagram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3 7.17 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.17L15 3H9Zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>`,
  'Menú': `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2a1 1 0 0 1 1 1v6.5a1.5 1.5 0 0 1-1 1.41V22a1 1 0 1 1-2 0v-11.09A1.5 1.5 0 0 1 3 9.5V3a1 1 0 0 1 2 0v6a.5.5 0 0 0 1 0V3a1 1 0 0 1 1-1v6a.5.5 0 0 0 1 0V3a1 1 0 0 1 1-1Zm10 2c-2.21 0-4 2.24-4 5s1.79 5 3 5.86V22a1 1 0 1 0 2 0V3a1 1 0 0 0-1-1Z"/></svg>`,
  Pago: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15.93V19h-2v-1.07a3.5 3.5 0 0 1-2.83-2.9l1.9-.4c.16.77.86 1.37 1.68 1.37.9 0 1.6-.5 1.6-1.2 0-.66-.46-1-1.73-1.33-1.7-.44-3.12-1-3.12-2.9 0-1.44 1.1-2.5 2.6-2.77V6h2v1.05a3.2 3.2 0 0 1 2.5 2.42l-1.87.5c-.2-.62-.77-1.05-1.5-1.05-.8 0-1.36.44-1.36 1.02 0 .6.5.9 1.77 1.24 1.87.5 3.1 1.15 3.1 2.98 0 1.53-1.16 2.6-2.74 2.77Z"/></svg>`,
  'Reseña': `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.2 21 12 17.77 5.8 21 7 14.14l-5-4.87 7.1-1.01L12 2Z"/></svg>`,
};
const dests = Object.keys(TAG_ICONS);
const tagDest = document.getElementById('tagdest');
const tagFlip = document.getElementById('tagflip');
const tagOrb = document.getElementById('tagorb');
let destIndex = 0;

function cycleDest() {
  const dest = dests[destIndex % dests.length];

  if (destIndex === 0) {
    if (tagFlip) tagFlip.innerHTML = TAG_ICONS[dest];
    tagDest.textContent = '→ ' + dest;
  } else {
    tagDest.style.opacity = 0;
    const currentSvg = tagFlip ? tagFlip.firstElementChild : null;
    if (currentSvg) currentSvg.style.opacity = 0;
    if (tagOrb) tagOrb.classList.add('is-pulsing');
    setTimeout(() => {
      if (tagFlip) tagFlip.innerHTML = TAG_ICONS[dest];
      tagDest.textContent = '→ ' + dest;
      tagDest.style.opacity = 1;
      if (tagOrb) tagOrb.classList.remove('is-pulsing');
    }, 300); // mitad del pulso (.6s): en el pico del crecimiento cambia el contenido
  }

  destIndex++;
}

if (tagDest) {
  cycleDest();
  setInterval(cycleDest, 2200);
}

// Fondo de video: fixed detrás de todo, con parallax sutil. Se esconde de
// un corte (sin fundido, sin transición) apenas se llega a "Formatos" —
// "termina ahí" en vez de oscurecer la pantalla mientras se desvanece.
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
  // El corte se resuelve antes de que "Formatos" empiece a entrar en
  // pantalla, no recién cuando su borde superior toca el tope.
  function computeLimit() {
    return formatosEl ? Math.max(formatosEl.offsetTop - window.innerHeight, 0) : Infinity;
  }
  let buffer = window.innerHeight * 0.08;
  let limit = computeLimit();
  let ticking = false;
  let hidden = false;

  function applyEffects() {
    const y = window.scrollY;

    const offset = Math.min(y * SPEED, buffer);
    bgVideo.style.transform = `translate3d(0, ${-offset}px, 0)`;

    const shouldHide = y >= limit;
    if (shouldHide !== hidden) {
      hidden = shouldHide;
      bgVideo.classList.toggle('is-hidden', hidden);
      if (bgOverlay) bgOverlay.classList.toggle('is-hidden', hidden);
      if (bgFill) bgFill.classList.toggle('is-hidden', hidden);
      if (hidden) bgVideo.pause(); else tryPlay();
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
    limit = computeLimit();
    applyEffects();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      limit = computeLimit();
      applyEffects();
    });
  }
  applyEffects();
}

// "Un toque, y ya está": playlist de 3 clips con crossfade suave entre uno y
// el siguiente (dos <video> superpuestos, el que entra se precarga mientras
// el actual todavía está en pantalla).
const photoVideos = document.querySelectorAll('.photo-video');
if (photoVideos.length === 2) {
  const PLAYLIST = [
    '/videos/vida-real-1.mp4',
    '/videos/vida-real-2.mp4',
    '/videos/vida-real-4.mp4',
  ];
  const CROSSFADE_MS = 900;
  let clipIndex = 0;
  let frontIndex = 0; // qué elemento de photoVideos está visible

  function preloadNext() {
    const back = photoVideos[1 - frontIndex];
    back.src = PLAYLIST[(clipIndex + 1) % PLAYLIST.length];
    back.load();
  }

  function armEnded(el) {
    el.addEventListener('ended', crossfadeToNext, { once: true });
  }

  function crossfadeToNext() {
    const front = photoVideos[frontIndex];
    const back = photoVideos[1 - frontIndex];

    back.currentTime = 0;
    back.play().catch(() => {});
    back.classList.add('active');
    front.classList.remove('active');
    armEnded(back);

    clipIndex = (clipIndex + 1) % PLAYLIST.length;
    frontIndex = 1 - frontIndex;
    // Recién cuando "front" terminó de desvanecerse y se pausó lo reutilizamos
    // como buffer del próximo clip — cambiarle el src antes lo cortaba en seco
    // mientras todavía se veía, y eso rompía la transición.
    setTimeout(() => {
      front.pause();
      preloadNext();
    }, CROSSFADE_MS);
  }

  photoVideos[0].src = PLAYLIST[0];
  photoVideos[0].classList.add('active');
  photoVideos[0].play().catch(() => {});
  armEnded(photoVideos[0]);
  preloadNext();

  ['touchstart', 'scroll', 'click'].forEach((evt) => {
    window.addEventListener(evt, () => {
      const front = photoVideos[frontIndex];
      if (front.paused) front.play().catch(() => {});
    }, { passive: true, once: true });
  });
}

// Carrusel "Mirá cómo se usa": la tarjeta de WhatsApp tiene un video real.
const carouselVideo = document.querySelector('.video-real');
if (carouselVideo) {
  const tryPlay = () => carouselVideo.play().catch(() => {});
  tryPlay();
  ['touchstart', 'scroll', 'click'].forEach((evt) => {
    window.addEventListener(evt, () => { if (carouselVideo.paused) tryPlay(); }, { passive: true, once: true });
  });
}
