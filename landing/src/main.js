import './styles.css';
import './pixel.js';
import './visita.js';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';

applyBrand('Conectá con tus clientes en un toque');
initFaqAccordion();

// Fondo de video: sticky detrás del hero + "por qué NFC" (ver CSS). El
// scroll normal del navegador lo va tapando progresivamente al final de esa
// zona — nada de fade ni de corte por JS. Acá solo sumamos un parallax sutil.
const bgVideo = document.querySelector('.bg-video');

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
  let buffer = window.innerHeight * 0.08;
  let ticking = false;

  function applyParallax() {
    const offset = Math.min(window.scrollY * SPEED, buffer);
    bgVideo.style.transform = `translate3d(0, ${-offset}px, 0)`;
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(applyParallax);
      ticking = true;
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    buffer = window.innerHeight * 0.08;
    applyParallax();
  });
  applyParallax();
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

// Carrusel "Mirá cómo se usa": algunas tarjetas tienen video real.
const carouselVideos = document.querySelectorAll('.video-real');
if (carouselVideos.length) {
  const tryPlayAll = () => carouselVideos.forEach((v) => v.play().catch(() => {}));
  tryPlayAll();
  ['touchstart', 'scroll', 'click'].forEach((evt) => {
    window.addEventListener(evt, () => {
      carouselVideos.forEach((v) => { if (v.paused) v.play().catch(() => {}); });
    }, { passive: true, once: true });
  });
}
