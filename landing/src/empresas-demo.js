// Demo de la sección "Para empresas" de la landing: un teléfono desbloqueado
// (iPhone / Android) al que una mano le acerca el llavero; aparece la pantalla
// del tap de una organización (logo + NextTap, ~1 s) y después el contacto. Los logos son los inventados de la página de prueba y
// pasan por el mismo encuadre (src/encuadre.js) y el mismo fondo
// (src/color-logo.js) que usa el editor de Mi panel, así se ve igual que el
// tap real. Corre solo mientras la sección está en pantalla.
import { colorMayoritario, paletaPantalla } from './color-logo.js';
import { encuadreAutomatico, colorDeBordes } from './encuadre.js';

// Tres casos, todos "Tu marca" en variantes distintas (solo texto sobre
// blanco, isotipo que llena el cuadro, apaisado transparente), así se ve que
// el fondo y el encuadre se adaptan a cualquier logo.
const ORGS = [
  { logo: '/images/tu-marca-1.svg', destino: 'wa' },
  { logo: '/images/tu-marca-2.svg', destino: 'ig' },
  { logo: '/images/tu-marca-3.svg', destino: 'wa' },
];
// El dueño del llavero es siempre el mismo personaje.
const PERSONA = 'Juan Pérez';
const USUARIO = 'juan.perez';
// Foto de Unsplash (Josias Garibay, licencia Unsplash), recortada a 400×400.
const FOTO = '/images/juan-perez.jpg';
// El llavero que acerca la mano, según a dónde lleva el tap.
const LLAVERO = {
  wa: '/images/modelos/whatsapp-llavero.png',
  ig: '/images/modelos/instagram-llavero.png',
};
// La mano (vista desde arriba, pellizcando la argolla) entra desde afuera del
// plano —grande, cerca de la cámara, arriba a la derecha—, apoya el llavero en
// la parte de arriba del teléfono con un empujoncito y vuelve a salir.
// Translate en % del propio elemento: -36%/-57% centra el llavero en el punto
// de anclaje del CSS (.emp-mano left/top).
const CONTACTO = 'translate(-36%, -57%) scale(1) rotate(0deg)';
const EMPUJE = 'translate(-36%, -57%) scale(0.93) rotate(0deg)';
const AFUERA = 'translate(25%, -115%) scale(1.7) rotate(-8deg)';
const MANO_IDA = [
  { transform: AFUERA, opacity: 0 },
  { transform: 'translate(-5%, -80%) scale(1.3) rotate(-4deg)', opacity: 1, offset: 0.35 },
  { transform: 'translate(-36%, -57%) scale(1.04) rotate(0deg)', opacity: 1, offset: 0.82 },
  { transform: EMPUJE, opacity: 1 },
];
const MANO_VUELTA = [
  { transform: EMPUJE, opacity: 1 },
  { transform: CONTACTO, opacity: 1, offset: 0.2 },
  { transform: AFUERA, opacity: 0 },
];
const MS_IDA = 750;
const MS_VUELTA = 650;
const MS_TAP = 1800;
const MS_CONTACTO = 1700;
const MS_HOME = 900;
const LADO = 400; // px de la imagen que se muestra (el editor sube 1080)

// Pantalla de inicio desbloqueada (antes del tap), una vuelta iPhone y otra
// Android: apps de siempre, dibujadas simples (viewBox 24×24), sin logos.
const ICONOS = {
  telefono: '<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 005.2 5.2l1.3-2 4 1.5v3a2 2 0 01-2 2A15.5 15.5 0 014.5 5.5a2 2 0 012-2z"/>',
  mensajes: '<path d="M12 4c4.7 0 8 3 8 6.7s-3.3 6.6-8 6.6c-1 0-2-.1-2.8-.4L5 19l1-3.4C4.8 14.4 4 12.7 4 10.7 4 7 7.3 4 12 4z"/>',
  camara: '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13.5" r="3.3"/>',
  fotos: '<g stroke="none" opacity=".85"><circle cx="12" cy="7.5" r="3.6" fill="#F9A825"/><circle cx="16.5" cy="12" r="3.6" fill="#43A047"/><circle cx="12" cy="16.5" r="3.6" fill="#1E88E5"/><circle cx="7.5" cy="12" r="3.6" fill="#E53935"/></g>',
  reloj: '<circle cx="12" cy="12" r="8" fill="#fff" stroke="none"/><path d="M12 7.5V12l3 2" stroke="#1C1C1E"/>',
  clima: '<circle cx="9" cy="9" r="3.5" fill="#FFD60A" stroke="none"/><path d="M8 18h9a3.5 3.5 0 000-7 4.5 4.5 0 00-8.6 1.5A2.8 2.8 0 008 18z" fill="#fff" stroke="none"/>',
  mapas: '<path d="M12 20.5s-5.5-5.4-5.5-10a5.5 5.5 0 0111 0c0 4.6-5.5 10-5.5 10z"/><circle cx="12" cy="10.3" r="2"/>',
  notas: '<path d="M7 9h10M7 13h10M7 17h6" stroke="#8E6D00"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2L18 18M6 18l1.8-1.8M16.2 7.8L18 6"/>',
  navegador: '<circle cx="12" cy="12" r="8"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="#fff"/>',
  musica: '<path d="M9.5 17V6.5l9-2V15"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="15" r="2"/>',
  correo: '<path d="M4 6.5h16v11H4z"/><path d="M4 7l8 6 8-6"/>',
};
const CLAROS = ['#fff', '#FFD60A'];
const HOY = new Date();
const DIA = new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(HOY).replace('.', '');
const FECHA = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'long' }).format(HOY);

function app([nombre, color, icono], conNombre = true) {
  const dentro =
    icono === 'calendario'
      ? `<span class="cal"><small>${DIA}</small>${HOY.getDate()}</span>`
      : `<svg viewBox="0 0 24 24">${ICONOS[icono]}</svg>`;
  return `<span class="app"><i style="--c:${color}"${CLAROS.includes(color) ? ' class="claro"' : ''}>${dentro}</i>${conNombre ? nombre : ''}</span>`;
}
const fila = (apps, conNombre) => apps.map((a) => app(a, conNombre)).join('');
const estado = (hora) => `<div class="home-status"><span>${hora}</span><span class="bat"></span></div>`;

const HOME = {
  ios:
    estado('9:41') +
    `<div class="home-grid">${fila([
      ['Calendario', '#fff', 'calendario'], ['Fotos', '#fff', 'fotos'], ['Cámara', '#3A3A3C', 'camara'], ['Reloj', '#1C1C1E', 'reloj'],
      ['Clima', '#2F80ED', 'clima'], ['Mapas', '#34C759', 'mapas'], ['Notas', '#FFD60A', 'notas'], ['Ajustes', '#8E8E93', 'ajustes'],
    ])}</div>` +
    '<div class="home-buscar">Buscar</div>' +
    `<div class="home-dock">${fila([
      ['Teléfono', '#34C759', 'telefono'], ['Navegador', '#0A84FF', 'navegador'], ['Mensajes', '#34C759', 'mensajes'], ['Música', '#FA2D48', 'musica'],
    ], false)}</div>`,
  android:
    estado('10:30') +
    '<div class="home-reloj">10:30</div>' +
    `<div class="home-fecha">${FECHA}</div>` +
    `<div class="home-grid">${fila([
      ['Calendario', '#fff', 'calendario'], ['Fotos', '#fff', 'fotos'], ['Correo', '#EA4335', 'correo'], ['Mapas', '#34A853', 'mapas'],
    ])}</div>` +
    `<div class="home-dock">${fila([
      ['Teléfono', '#1A73E8', 'telefono'], ['Mensajes', '#0B57D0', 'mensajes'], ['Navegador', '#F9AB00', 'navegador'], ['Cámara', '#5F6368', 'camara'],
    ], false)}</div>` +
    '<div class="home-buscar">Buscar</div>',
};

// El teléfono y la mano se arman acá, así la misma demo va en la landing y en
// empresas.html: cada página solo pone <figure class="empresas-demo" data-empresas-demo>.
const PLANTILLA = `
  <div class="empresas-phone" aria-hidden="true">
    <div class="emp-pantalla emp-home emp-ios"></div>
    <div class="emp-pantalla emp-home emp-android"></div>
    <div class="emp-pantalla emp-tap">
      <div class="emp-org-img"><img alt=""></div>
      <div class="emp-mark">Next<span class="tap">Tap</span></div>
      <div class="emp-bar"><i></i></div>
    </div>
    <div class="emp-pantalla emp-wa">
      <div class="wa-top">
        <span class="wa-back">‹</span>
        <span class="emp-av"></span>
        <div class="wa-quien"><b class="emp-nombre"></b><small>en línea</small></div>
      </div>
      <div class="wa-chat"></div>
      <div class="wa-input"><span>Mensaje</span><b></b></div>
    </div>
    <div class="emp-pantalla emp-ig">
      <div class="ig-top"><b class="emp-usuario"></b></div>
      <div class="ig-perfil">
        <span class="ig-anillo"><span class="emp-av"></span></span>
        <div class="ig-stats">
          <div><b>48</b><small>posts</small></div>
          <div><b>1.204</b><small>seguidores</small></div>
          <div><b>389</b><small>seguidos</small></div>
        </div>
      </div>
      <div class="ig-bio"><b class="emp-nombre"></b><i></i><i class="corta"></i></div>
      <div class="ig-btns"><span class="seguir">Seguir</span><span>Mensaje</span></div>
      <div class="ig-grid"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </div>
    <span class="emp-camara"></span>
  </div>
  <div class="emp-mano" aria-hidden="true">
    <svg viewBox="0 0 240 240">
      <image class="mano-llavero" href="/images/modelos/whatsapp-llavero.png" x="20" y="70" width="132" height="132" transform="rotate(-12 86 136)"/>
      <!-- Mano vista desde arriba: solo el índice y el pulgar, pellizcando la
           argolla del llavero (arriba a la izquierda). El resto de la mano
           queda afuera del cuadro, arriba a la derecha. -->
      <g stroke-linecap="round">
        <ellipse cx="330" cy="-50" rx="120" ry="95" transform="rotate(-30 330 -50)" fill="#E3AE88"/>
        <line x1="250" y1="-80" x2="78" y2="58" stroke="#CF9670" stroke-width="44" transform="translate(3 4)"/>
        <line x1="250" y1="-80" x2="78" y2="58" stroke="#E8B48E" stroke-width="43"/>
        <ellipse cx="86" cy="54" rx="13" ry="11" transform="rotate(-39 86 54)" fill="#F4D3BD"/>
        <line x1="300" y1="30" x2="104" y2="92" stroke="#CF9670" stroke-width="50" transform="translate(3 4)"/>
        <line x1="300" y1="30" x2="104" y2="92" stroke="#EDBC97" stroke-width="49"/>
        <ellipse cx="111" cy="90" rx="15" ry="12.5" transform="rotate(-17 111 90)" fill="#F7DCC9"/>
      </g>
    </svg>
  </div>`;


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

// Los logos se preparan una sola vez aunque haya más de una demo en la página.
let preparados = null;
const prepararTodos = () =>
  (preparados ??= Promise.allSettled(ORGS.map(preparar)).then((rs) =>
    rs.filter((r) => r.status === 'fulfilled').map((r) => r.value),
  ));

async function preparar(o) {
  const img = await cargar(o.logo);
  const cuadro = encuadreAutomatico(img).canvas;
  cargar(LLAVERO[o.destino]).catch(() => {}); // que esté en caché antes de la primera pasada
  const chico = document.createElement('canvas');
  chico.width = chico.height = LADO;
  chico.getContext('2d').drawImage(cuadro, 0, 0, LADO, LADO);
  return { ...o, src: chico.toDataURL('image/png'), pal: paletaPantalla(colorDe(cuadro), colorDeBordes(cuadro)) };
}

// Cada <figure data-empresas-demo> es una demo independiente. En cada momento
// de la secuencia avisa con un evento "demo-fase" (detail: 'acerca' | 'tap' |
// 'contacto'), así quien la use puede acompañarla (ver empresas.js).
document.querySelectorAll('[data-empresas-demo]').forEach(montar);

function montar(figura) {
  figura.insertAdjacentHTML('afterbegin', PLANTILLA);
  const phone = figura.querySelector('.empresas-phone');
  const fase = (nombre) => figura.dispatchEvent(new CustomEvent('demo-fase', { detail: nombre }));
  const tap = phone.querySelector('.emp-tap');
  const destinos = { wa: phone.querySelector('.emp-wa'), ig: phone.querySelector('.emp-ig') };
  const imgEl = tap.querySelector('img');
  const mano = figura.querySelector('.emp-mano');
  const llavero = mano?.querySelector('.mano-llavero');
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let orgs = null;
  let i = 0;
  let vuelta = 0;
  let corriendo = false;
  let visible = false;

  phone.querySelectorAll('.emp-av').forEach((el) => (el.innerHTML = `<img src="${FOTO}" alt="">`));
  phone.querySelectorAll('.emp-nombre').forEach((el) => (el.textContent = PERSONA));
  phone.querySelectorAll('.emp-usuario').forEach((el) => (el.textContent = USUARIO));
  const homes = { ios: phone.querySelector('.emp-ios'), android: phone.querySelector('.emp-android') };
  homes.ios.innerHTML = HOME.ios;
  homes.android.innerHTML = HOME.android;
  const apagar = (salvo) => phone.querySelectorAll('.emp-pantalla.on').forEach((el) => el !== salvo && el.classList.remove('on'));

  // El teléfono desbloqueado, en su pantalla de inicio. Si cambia el sistema,
  // cambia el teléfono entero: el que estaba sale por la izquierda y el nuevo
  // entra por la derecha, para que se note que es otro celular.
  async function mostrarHome(sistema) {
    const cambia = !phone.classList.contains(sistema) && !quieto;
    if (cambia && (phone.classList.contains('ios') || phone.classList.contains('android'))) {
      await phone.animate(
        [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-70%) rotate(-8deg)', opacity: 0 }],
        { duration: 380, easing: 'cubic-bezier(.5,0,.75,.4)' },
      ).finished;
      phone.style.opacity = '0';
    }
    phone.classList.toggle('cambiando', cambia);
    phone.classList.toggle('ios', sistema === 'ios');
    phone.classList.toggle('android', sistema === 'android');
    homes[sistema].classList.add('on');
    apagar(homes[sistema]);
    if (cambia) {
      void phone.offsetWidth;
      phone.classList.remove('cambiando');
      phone.style.opacity = '';
      await phone.animate(
        [{ transform: 'translateX(70%) rotate(8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 480, easing: 'cubic-bezier(.2,.7,.3,1)' },
      ).finished;
    }
  }

  function mostrarTap(o) {
    imgEl.src = o.src;
    const p = o.pal;
    tap.style.setProperty('--fondo', p.fondo);
    tap.style.setProperty('--texto', p.texto);
    tap.style.setProperty('--pista', p.pista);
    tap.style.setProperty('--acento', p.acento);
    tap.style.setProperty('--acento-texto', p.acentoTexto);
    tap.style.setProperty('--sombra', p.sombra);
    tap.classList.remove('on');
    void tap.offsetWidth; // reinicia la animación de la marca
    tap.classList.add('on');
    apagar(tap);
  }

  function mostrarContacto(o) {
    // Después del tap se abre el chat de WhatsApp o el perfil de Instagram de la persona.
    const d = destinos[o.destino];
    d.classList.add('on');
  }

  // Una vuelta: pantalla de inicio (iPhone o Android, alternando) → la mano
  // acerca el llavero → al tocar aparece la pantalla de la empresa (y la mano
  // se va) → se abre el WhatsApp o el Instagram → siguiente.
  async function ciclo() {
    const o = orgs[i];
    corriendo = true;
    // Con tres casos, el sistema alterna por vuelta (no por caso): nunca dos iguales seguidos.
    fase('acerca');
    await mostrarHome(vuelta++ % 2 ? 'android' : 'ios');
    if (quieto || !mano) return mostrarTap(o);
    llavero.setAttribute('href', LLAVERO[o.destino]);
    await new Promise((r) => setTimeout(r, MS_HOME));
    const ida = mano.animate(MANO_IDA, { duration: MS_IDA, easing: 'cubic-bezier(.25,.7,.3,1)', fill: 'forwards' });
    ida.onfinish = () => {
      mostrarTap(o);
      fase('tap');
      mano.animate(MANO_VUELTA, { duration: MS_VUELTA, delay: 120, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'forwards' });
      setTimeout(() => {
        mostrarContacto(o);
        fase('contacto');
        setTimeout(() => {
          i = (i + 1) % orgs.length;
          if (visible && !document.hidden) ciclo();
          else corriendo = false;
        }, MS_CONTACTO);
      }, MS_TAP);
    };
  }

  function seguir() {
    if (orgs && visible && !document.hidden && !corriendo) ciclo();
  }

  new IntersectionObserver(
    async ([e]) => {
      visible = e.isIntersecting;
      if (visible && !orgs) {
        orgs = await prepararTodos();
        if (!orgs.length) return;
      }
      seguir();
    },
    { threshold: 0.3 },
  ).observe(phone);
  document.addEventListener('visibilitychange', seguir);
}
