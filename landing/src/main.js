import './styles.css';
import './pixel.js';
import './pap.js';
import './visita.js';
import './nav-sesion.js';
import './sorteo.js';
import './empresas-demo.js';
import './empresas-recorrido.js';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';

applyBrand('Conectá con tus clientes en un toque');
initFaqAccordion();

// Hero: "Compartí distinto" rota a "Instagram" y "WhatsApp" y vuelve a
// "distinto" (3 s en distinto, 2 s en cada red). Con "reducir movimiento" queda fija.
const PALABRAS_HERO = [
  { texto: 'distinto', ms: 3000 },
  { texto: 'Instagram', red: 'ig', ms: 2000 },
  { texto: 'WhatsApp', red: 'wa', ms: 2000 },
];
const palabraHero = document.querySelector('[data-palabra-rota]');
if (palabraHero && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  // Las tres palabras van al mismo tamaño de letra. Para que ninguna corra el
  // texto: el título se ensancha (hasta donde da la pantalla) para que "Compartí <palabra>." entre
  // en un renglón. Así el título queda igual con cualquiera de las tres.
  const titulo = palabraHero.closest('h1');
  const medidor = document.createElement('span');
  medidor.setAttribute('aria-hidden', 'true');
  medidor.style.cssText = 'position:absolute; visibility:hidden; white-space:nowrap;';
  titulo.appendChild(medidor);
  const ancho = (html) => {
    medidor.innerHTML = html;
    return Math.ceil(medidor.getBoundingClientRect().width);
  };
  const ajustar = () => {
    const palabra = Math.max(...PALABRAS_HERO.map((p) => ancho(`<em>${p.texto}</em>`)));
    // La palabra mide lo suyo (el punto queda pegado); el renglón sigue reservando
    // el ancho de la más larga con el min-width del título, así no se corre nada.
    palabraHero.style.width = `${ancho(`<em>${palabraHero.textContent}</em>`)}px`;
    // La frase entera, con la palabra ya en su ancho fijo: medir "Compartí " suelto
    // pierde el espacio del final y el punto terminaba en el renglón de abajo.
    const linea =
      ancho(`Compartí <em style="display:inline-block; width:${palabra}px"></em>.`) + 4;
    const hero = titulo.closest('.hero');
    const cs = getComputedStyle(hero);
    const disponible = hero.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    titulo.style.minWidth = linea <= disponible ? `${linea}px` : '';
  };
  ajustar();
  addEventListener('resize', ajustar);
  document.fonts?.ready.then(ajustar);

  // Variante con mensaje de empresas (data-hero-b en título y bajada): después
  // de las tres palabras se muestra ese texto y vuelve a empezar.
  const heroB = [...document.querySelectorAll('[data-hero-b]')];
  const heroA = [...document.querySelectorAll('[data-hero-a]')];
  if (heroB.length) PALABRAS_HERO.push({ alt: true, ms: 6000 });
  let viendoB = false;
  const mostrar = (verB) => {
    if (verB === viendoB) return; // la bajada cambia una vez por vuelta, no con cada palabra
    viendoB = verB;
    [...heroA, ...heroB].forEach((el) => {
      const activo = heroB.includes(el) === verB;
      el.dataset.activo = String(activo);
      if (activo) {
        el.classList.remove('cambia');
        void el.offsetWidth;
        el.classList.add('cambia');
      }
    });
  };

  let n = 0;
  const siguiente = () => {
    setTimeout(() => {
      n = (n + 1) % PALABRAS_HERO.length;
      const p = PALABRAS_HERO[n];
      if (p.alt) {
        mostrar(true);
        siguiente();
        return;
      }
      if (heroB.length) mostrar(false);
      palabraHero.textContent = p.texto;
      ajustar();
      if (p.red) palabraHero.dataset.red = p.red;
      else delete palabraHero.dataset.red;
      palabraHero.classList.remove('cambia');
      void palabraHero.offsetWidth; // reinicia la animación de entrada
      palabraHero.classList.add('cambia');
      siguiente();
    }, PALABRAS_HERO[n].ms);
  };
  siguiente();
}

// Videos: sin menú de clic derecho ("Guardar video como…"), sin botón de
// descarga ni picture-in-picture. No es blindaje, pero saca la descarga fácil.
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest?.('video')) e.preventDefault();
});
document.querySelectorAll('video').forEach((v) => {
  v.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
  v.disablePictureInPicture = true;
  v.disableRemotePlayback = true;
});

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

// "Un toque, y ya está": playlist de 4 clips con crossfade suave entre uno y
// el siguiente (dos <video> superpuestos, el que entra se precarga mientras
// el actual todavía está en pantalla).
const photoVideos = document.querySelectorAll('.photo-video');
if (photoVideos.length === 2) {
  const PLAYLIST = [
    '/videos/vida-real-1.mp4',
    '/videos/vida-real-11.mp4',
    '/videos/vida-real-13a.mp4',
    '/videos/vida-real-9a.mp4',
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
