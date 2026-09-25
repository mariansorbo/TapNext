// Registro anónimo de páginas vistas y del recorrido (ver server/tracking.js y
// "Datos recabados del tráfico web" en el vault). Nada de esto bloquea la
// página ni pide permisos; si algo falla, la página sigue igual.
//
// El visitante lo identifica la cookie nt_vid, que crea el SERVIDOR: las
// llamadas van a /t/visita y /t/evento del mismo dominio (rewrite de Vercel
// → Render), así la cookie es propia y Safari no la borra a los 7 días.

const SESION_KEY = 'nexttap_sesion';
const VISITANTE_KEY = 'nexttap_vid';

// Acceder a sessionStorage puede tirar (storage bloqueado): siempre dentro del try.
const guardado = (key) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const guardar = (key, valor) => {
  try {
    sessionStorage.setItem(key, valor);
  } catch {
    // storage bloqueado: se sigue sin guardar
  }
};

function idRandom() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Una sesión = esta pestaña mientras siga abierta (sessionStorage).
const sesionId = guardado(SESION_KEY) || idRandom();
guardar(SESION_KEY, sesionId);

// Lo que el navegador expone por JS sin pedir permiso. deviceMemory y
// connection solo existen en Chrome/Android; en Safari quedan null.
function senales() {
  const conn = navigator.connection || {};
  return {
    idioma: navigator.language || null,
    idiomas: (navigator.languages || []).join(','),
    zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    pantalla: window.screen.width ? `${window.screen.width}x${window.screen.height}` : null,
    pixelRatio: window.devicePixelRatio || null,
    profundidadColor: window.screen.colorDepth || null,
    modoOscuro: window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : null,
    tactil: typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints > 0 : null,
    puntosTactiles: navigator.maxTouchPoints ?? null,
    nucleos: navigator.hardwareConcurrency || null,
    memoriaGb: navigator.deviceMemory || null,
    conexion: conn.effectiveType || null,
    ahorroDatos: typeof conn.saveData === 'boolean' ? conn.saveData : null,
    plataforma: navigator.platform || null,
  };
}

// Huella: hash de las señales + user-agent. Agrupa dispositivos "iguales"
// aunque borren la cookie o entren en incógnito. No es única: dos iPhone del
// mismo modelo, iOS e idioma dan la misma huella. A propósito no usa canvas,
// WebGL ni fuentes (eso sí es fingerprinting fino, y Safari lo bloquea).
async function huella(s) {
  try {
    const base = [
      navigator.userAgent, s.idiomas, s.zonaHoraria, s.pantalla, s.pixelRatio, s.profundidadColor,
      s.nucleos, s.memoriaGb, s.puntosTactiles, s.plataforma,
    ].join('|');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base));
    return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null; // crypto.subtle solo existe en https / localhost
  }
}

function postTexto(url, datos) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(datos),
    credentials: 'same-origin',
    keepalive: true,
  });
}

// Página vista. La respuesta trae el id del visitante (el de la cookie).
const visitantePromesa = (async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const s = senales();
    const res = await postTexto('/t/visita', {
      sesionId,
      pagina: window.location.pathname,
      utm: {
        source: params.get('utm_source'),
        medium: params.get('utm_medium'),
        campaign: params.get('utm_campaign'),
        content: params.get('utm_content'),
        term: params.get('utm_term'),
      },
      vendedorToken: params.get('s') || params.get('ref'),
      referer: document.referrer || null,
      senales: s,
      huella: await huella(s),
    });
    const data = res.ok && res.status !== 204 ? await res.json() : null;
    if (data?.visitanteId) {
      guardar(VISITANTE_KEY, data.visitanteId);
      return data.visitanteId;
    }
  } catch {
    // sin red / bloqueado por un adblock: seguimos sin id
  }
  return guardado(VISITANTE_KEY);
})();

// Id del visitante para mandarlo en la compra. Espera la página vista como
// mucho 1,5 s: nunca demora el pago por esto.
export function obtenerVisitanteId() {
  const tope = new Promise((ok) => setTimeout(() => ok(guardado(VISITANTE_KEY)), 1500));
  return Promise.race([visitantePromesa, tope]);
}

// Evento del recorrido. Los nombres válidos están en server/tracking.js (EVENTOS).
export function evento(nombre, datos) {
  try {
    const payload = JSON.stringify({
      nombre,
      datos: datos || null,
      pagina: window.location.pathname,
      sesionId,
      visitanteId: guardado(VISITANTE_KEY),
    });
    const blob = new Blob([payload], { type: 'text/plain' });
    if (!(navigator.sendBeacon && navigator.sendBeacon('/t/evento', blob))) {
      fetch('/t/evento', { method: 'POST', body: blob, credentials: 'same-origin', keepalive: true }).catch(() => {});
    }
  } catch {
    // nunca rompe la página
  }
}
