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

// Formulario "Contanos de tu equipo" (cierre de la página): lo recibe
// server/contacto-empresas.js y llega por mail a ventas@next-tap.tech.
const API_BASE = import.meta.env.VITE_API_BASE || '';
const ABIERTA_EN = Date.now();

function initFormContacto() {
  const form = document.getElementById('emp-form');
  if (!form) return;
  const estado = form.querySelector('.emp-form-estado');
  const boton = form.querySelector('button[type="submit"]');
  const mostrar = (msj, error = false) => {
    estado.textContent = msj;
    estado.classList.toggle('is-error', error);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form));
    if (!datos.nombre.trim() || !datos.empresa.trim()) return mostrar('Completá tu nombre y el de tu empresa.', true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(datos.email.trim())) return mostrar('Revisá tu mail: así te respondemos.', true);

    boton.disabled = true;
    mostrar('Enviando…');
    try {
      const res = await fetch(`${API_BASE}/api/contacto-empresas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...datos, ms: Date.now() - ABIERTA_EN }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'No pudimos enviar tu mensaje.');
      form.reset();
      mostrar('¡Listo! Recibimos tu consulta y te respondemos por mail.');
    } catch (err) {
      mostrar(`${err.message} Si preferís, escribinos por WhatsApp.`, true);
    } finally {
      boton.disabled = false;
    }
  });
}
initFormContacto();

// "Por qué": carrusel que rota solo cada CARRUSEL_MS y se puede deslizar a mano
// (scroll-snap) o elegir con los puntitos. Si la persona lo toca, espera un
// rato antes de volver a rotar. Con "reducir movimiento" no rota solo.
const CARRUSEL_MS = 5000;
const CARRUSEL_PAUSA_MS = 9000;

function initCarrusel(raiz) {
  const pista = raiz.querySelector('.emp-carrusel-pista');
  const items = [...pista.children];
  const puntos = raiz.querySelector('.emp-carrusel-puntos');
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let actual = 0;
  let timer = null;
  let visible = false;

  const ir = (i) => pista.scrollTo({ left: i * pista.clientWidth, behavior: quieto ? 'auto' : 'smooth' });
  const botones = items.map((item, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', item.querySelector('h3')?.textContent || `Argumento ${i + 1}`);
    b.addEventListener('click', () => {
      ir(i);
      pausar();
    });
    puntos.appendChild(b);
    return b;
  });
  const marcar = (i) => {
    actual = i;
    botones.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
  };

  function programar(ms = CARRUSEL_MS) {
    clearTimeout(timer);
    if (quieto || !visible) return;
    timer = setTimeout(() => {
      ir((actual + 1) % items.length);
      programar();
    }, ms);
  }
  const pausar = () => programar(CARRUSEL_PAUSA_MS);

  let espera;
  pista.addEventListener('scroll', () => {
    clearTimeout(espera);
    espera = setTimeout(() => marcar(Math.round(pista.scrollLeft / pista.clientWidth)), 60);
  });
  ['pointerdown', 'touchstart', 'wheel'].forEach((ev) => pista.addEventListener(ev, pausar, { passive: true }));

  new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting;
      if (visible) programar();
      else clearTimeout(timer);
    },
    { threshold: 0.4 },
  ).observe(raiz);

  marcar(0);
}
document.querySelectorAll('[data-carrusel]').forEach(initCarrusel);

// "El proceso": las seis ilustraciones se mueven todo el tiempo. Cada una
// repite su animación cada PROCESO_MS, arrancando PROCESO_DESFASE_MS después
// de la anterior: se ve como una ola que corre de 01 a 06 (de izquierda a
// derecha en compu). Solo corre a la vista; con "reducir movimiento" quedan
// quietas en su estado final.
const PROCESO_MS = 3200;
const PROCESO_DESFASE_MS = 450;
function initProceso(ol) {
  const pasos = [...ol.children];
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return ol.classList.add('quieto');
  let timers = [];
  const animar = (li) => {
    li.classList.remove('on');
    void li.offsetWidth; // reinicia sus animaciones
    li.classList.add('on');
  };
  const arrancar = () =>
    pasos.forEach((li, i) => {
      timers.push(
        setTimeout(() => {
          animar(li);
          timers.push(setInterval(() => animar(li), PROCESO_MS));
        }, i * PROCESO_DESFASE_MS),
      );
    });
  const parar = () => {
    timers.forEach((t) => (clearTimeout(t), clearInterval(t)));
    timers = [];
  };
  new IntersectionObserver(
    ([e]) => {
      parar();
      if (e.isIntersecting) arrancar();
    },
    { threshold: 0.15 },
  ).observe(ol);
}
document.querySelectorAll('.emp-proceso').forEach(initProceso);

// "su WhatsApp / su Instagram" según el llavero que usa una demo en cada vuelta:
// el título del arranque sigue a la demo de al lado, y el paso 03 ("Se abre su
// …") a la que corre detrás de los pasos (en celular esa no se ve: sigue a la
// del arranque).
const NOMBRE_DESTINO = { wa: 'WhatsApp', ig: 'Instagram' };
const ACCION_DESTINO = { wa: 'escribirle', ig: 'seguirlo' };
const accionPaso = document.querySelector('[data-destino-accion]');
function cambiarDestino(palabra, destino) {
  if (!palabra || !NOMBRE_DESTINO[destino]) return;
  palabra.dataset.destino = destino;
  palabra.textContent = NOMBRE_DESTINO[destino];
  palabra.classList.remove('cambia');
  void palabra.offsetWidth; // reinicia la animación de entrada
  palabra.classList.add('cambia');
}
const demoArranque = document.querySelector('.emp-hero [data-empresas-demo]');
const demoPasos = document.querySelector('.emp-recorrido [data-empresas-demo]');
const palabraTitulo = document.querySelector('[data-destino-titulo]');
const palabraPaso = document.querySelector('[data-destino-paso]');
const demoPasosVisible = () => demoPasos && getComputedStyle(demoPasos).display !== 'none';
demoArranque?.addEventListener('demo-destino', (e) => {
  cambiarDestino(palabraTitulo, e.detail);
  if (!demoPasosVisible()) cambiarDestino(palabraPaso, e.detail);
});
demoPasos?.addEventListener('demo-destino', (e) => cambiarDestino(palabraPaso, e.detail));
// El texto del paso 03 acompaña a su palabra: "listo para escribirle / seguirlo".
new MutationObserver(() => {
  const accion = ACCION_DESTINO[palabraPaso?.dataset.destino];
  if (accion && accionPaso) accionPaso.textContent = accion;
}).observe(palabraPaso || document.createElement('i'), { attributes: true, attributeFilter: ['data-destino'] });

// "Un segundo que es de tu marca": la demo de fondo se para detrás del paso
// que está pasando (acerca el llavero → aparece tu empresa → se abre el contacto).
document.querySelectorAll('.emp-recorrido').forEach((recorrido) => {
  recorrido.querySelector('[data-empresas-demo]')?.addEventListener('demo-fase', (e) => {
    recorrido.dataset.fase = e.detail;
  });
});

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
