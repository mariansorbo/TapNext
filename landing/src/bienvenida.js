// Bienvenida previa a la activación GRATIS (activacion.html → #bienvenida).
//
// "Ondas del tap": un punto violeta late en el centro, de cada latido sale una
// onda y esa onda va revelando "Bienvenido a NextApp". Después aparece el texto
// de regalo y el botón Empezar; si no tocan nada, pasa sola al formulario.
// Lleva sonido sintetizado y vibración corta (con botón para silenciar).
//
// Para verla sin chip: ?bienvenida=1 en la URL de activación (siempre se
// muestra, aunque ya se haya visto en la sesión). ?bienvenida=no la apaga.

const MODELO_TXT = { llavero: 'llavero', tarjeta: 'stand', placa: 'placa' };

// Segundo en que arranca el título (lo lee el CSS como --t-title).
const T_TITULO = 1.0;

const reducido = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function leerSonido() {
  try {
    return localStorage.getItem('nt_bv_sonido') !== '0';
  } catch {
    return true;
  }
}
function guardarSonido(v) {
  try {
    localStorage.setItem('nt_bv_sonido', v ? '1' : '0');
  } catch {
    /* sin storage: no pasa nada */
  }
}
function yaVista(codigo) {
  try {
    return sessionStorage.getItem(`nt_bv_${codigo}`) === '1';
  } catch {
    return false;
  }
}
function marcarVista(codigo) {
  try {
    sessionStorage.setItem(`nt_bv_${codigo}`, '1');
  } catch {
    /* idem */
  }
}

// ¿Hay que mostrar la bienvenida? Sí si es activación gratis y no se vio en esta
// sesión, o si la piden a mano con ?bienvenida=… (prueba).
export function debeMostrar(info, codigo, params) {
  const pedida = (params.get('bienvenida') || '').toLowerCase();
  if (['no', '0', 'sin'].includes(pedida)) return false;
  if (pedida) return true;
  if (info.liberada && !yaVista(codigo)) {
    marcarVista(codigo);
    return true;
  }
  return false;
}

// --- Sonido (WebAudio sintetizado: sin archivos) ---
// Ojo: los navegadores no dejan sonar ni vibrar hasta que la persona toca la
// pantalla. Un chip abre la página sin ese toque, así que al principio puede
// ser mudo; el primer toque lo destraba y "Empezar" siempre suena.
function crearAudio() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  try {
    ctx = Ctor ? new Ctor() : null;
  } catch {
    ctx = null;
  }
  const listo = () => Boolean(ctx) && ctx.state === 'running';
  const desbloquear = () => {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  };

  return {
    listo,
    desbloquear,
    // "tic" suave de tap
    tic() {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1600, t);
      o.frequency.exponentialRampToValueAtTime(760, t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.11);
    },
    // soplido que sube cuando se revela el título
    brillo() {
      const t = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * 0.95);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(5200, t + 0.85);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      s.connect(f).connect(g).connect(ctx.destination);
      s.start(t);
    },
  };
}

function vibrar(patron) {
  try {
    // Sin un toque previo el navegador lo bloquea (y ensucia la consola): no insistimos.
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(patron);
  } catch {
    /* no soportado (iOS) */
  }
}

let cancelarActual = null; // una sola bienvenida a la vez

export function mostrarBienvenida({ info, onFin }) {
  const el = document.getElementById('bienvenida');
  if (!el) {
    onFin?.();
    return;
  }
  cancelarActual?.();
  const $ = (id) => document.getElementById(id);
  const titulo = el.querySelector('.bv-titulo');
  const stage = el.querySelector('.bv-stage');

  // --- Textos ---
  el.classList.remove('bv-play', 'bv-saliendo');
  el.style.setProperty('--t-title', `${T_TITULO}s`);
  const queEs = MODELO_TXT[info.modelo] || 'llavero';
  $('bv-sub').textContent = info.organizacion
    ? `Este ${queEs} es un regalo de ${info.organizacion}. Activalo en un minuto.`
    : `Este ${queEs} es un regalo. Activalo gratis en un minuto.`;

  // --- Bloquea el resto de la página mientras dura ---
  const hermanos = [...document.body.children].filter((n) => n !== el && n.tagName !== 'SCRIPT');
  hermanos.forEach((n) => (n.inert = true));
  el.hidden = false;
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });

  // --- Sonido y botones ---
  const audio = crearAudio();
  let sonido = leerSonido();
  const btnSonido = $('bv-sonido');
  const pintarSonido = () => {
    el.classList.toggle('bv-silencio', !sonido);
    btnSonido.setAttribute('aria-pressed', String(sonido));
    btnSonido.setAttribute('aria-label', sonido ? 'Silenciar sonido' : 'Activar sonido');
  };
  pintarSonido();
  const sonar = (nombre) => {
    if (!sonido || !audio.listo()) return;
    try {
      audio[nombre]();
    } catch {
      /* el sonido nunca debe romper la bienvenida */
    }
  };
  audio.desbloquear();
  const destrabar = () => audio.desbloquear();
  el.addEventListener('pointerdown', destrabar, { once: true });
  el.addEventListener('keydown', destrabar, { once: true });

  let terminado = false;
  const timers = [];
  const onTecla = (e) => {
    if (e.key === 'Escape') terminar();
  };
  function terminar() {
    if (terminado) return;
    terminado = true;
    timers.forEach(clearTimeout);
    hermanos.forEach((n) => (n.inert = false));
    document.removeEventListener('keydown', onTecla);
    el.classList.add('bv-saliendo');
    setTimeout(() => {
      el.hidden = true;
      onFin?.();
    }, 700);
  }
  document.addEventListener('keydown', onTecla);
  cancelarActual = () => {
    terminado = true;
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', onTecla);
    hermanos.forEach((n) => (n.inert = false));
  };

  btnSonido.onclick = () => {
    sonido = !sonido;
    guardarSonido(sonido);
    pintarSonido();
    if (sonido) {
      audio.desbloquear();
      setTimeout(() => sonar('tic'), 80);
    }
  };
  $('bv-saltar').onclick = terminar;
  $('bv-empezar').onclick = () => {
    audio.desbloquear();
    vibrar(15);
    setTimeout(() => sonar('tic'), 60);
    terminar();
  };

  // La onda que revela el título sale del centro del escenario: medimos cuánto
  // más arriba está respecto del título (antes de arrancar las animaciones).
  const a = stage.getBoundingClientRect();
  const b = titulo.getBoundingClientRect();
  titulo.style.setProperty('--bv-dy', `${a.top + a.height / 2 - (b.top + b.height / 2)}px`);

  // --- Línea de tiempo (CSS anima; esto agrega sonido, vibración y el cierre) ---
  el.classList.add('bv-play');
  if (reducido()) return;
  const en = (seg, fn) => timers.push(setTimeout(fn, seg * 1000));
  en(0.15, () => {
    sonar('tic');
    vibrar(12);
  });
  en(1.25, () => sonar('tic'));
  en(T_TITULO, () => {
    sonar('brillo');
    vibrar(18);
  });
  // Si no hacen nada, pasa sola al formulario.
  en(T_TITULO + 3.8, terminar);
}
