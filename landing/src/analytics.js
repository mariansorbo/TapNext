// Google Analytics 4 (gtag.js) — se importa desde pixel.js, así carga en las
// mismas páginas públicas que el Pixel (no en admin/vendedor/mi-panel).
// Complementa al tracking propio (visita.js / server/tracking.js): no lo
// reemplaza ni comparte nada con él.
const GA_ID = 'G-S3ZNNJL4LF';

const params = new URLSearchParams(window.location.search);

// Vuelta desde Mercado Pago (?venta=&pago=): el referrer es mercadopago.com, y
// sin esto GA abriría una sesión nueva atribuida a MP en vez de a la campaña
// que trajo al comprador.
const volvioDePago = params.has('venta') && params.has('pago');

// DebugView de GA: siempre en `npm run dev`, y en producción con ?ga_debug=1.
const debug = import.meta.env.DEV || params.has('ga_debug');

window.dataLayer = window.dataLayer || [];
window.gtag = function gtag() {
  window.dataLayer.push(arguments);
};

const s = document.createElement('script');
s.async = true;
s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
document.head.appendChild(s);

window.gtag('js', new Date());
// page_location se fija acá, al evaluar el módulo: gtag.js llega async y para
// entonces comprar.js ya pudo haber hecho replaceState (saca ?iniciar=1). Así
// las UTMs y el gclid llegan tal cual entró el visitante.
window.gtag('config', GA_ID, {
  page_location: window.location.href,
  ...(volvioDePago && { ignore_referrer: true }),
  ...(debug && { debug_mode: true }),
});

export function gaEvent(name, eventParams) {
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', name, eventParams || {});
}

// client_id y session_id de gtag, para que el purchase que manda el server
// (server/ga4.js) quede en la misma sesión y campaña. Si gtag.js no cargó
// (bloqueador), a los 1,5 s devuelve nulls y la compra sigue igual.
function gaGet(campo) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 1500);
    window.gtag('get', GA_ID, campo, (v) => {
      clearTimeout(t);
      resolve(v == null ? null : String(v));
    });
  });
}

export async function obtenerGaIds() {
  const [gaClientId, gaSessionId] = await Promise.all([gaGet('client_id'), gaGet('session_id')]);
  return { gaClientId, gaSessionId };
}
