// Meta Pixel — se carga en todas las páginas públicas (no en admin/vendedor/mi-panel).
// event_id opcional: se usa para dedupear con el mismo evento mandado por CAPI del lado servidor.
const PIXEL_ID = '2192903191273005';

/* eslint-disable */
!(function (f, b, e, v, n, t, s) {
  if (f.fbq) return;
  n = f.fbq = function () {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = !0;
  n.version = '2.0';
  n.queue = [];
  t = b.createElement(e);
  t.async = !0;
  t.src = v;
  s = b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t, s);
})(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
/* eslint-enable */

window.fbq('init', PIXEL_ID);
window.fbq('track', 'PageView');

export function trackEvent(name, params, eventId) {
  if (typeof window.fbq !== 'function') return;
  const opts = eventId ? { eventID: eventId } : undefined;
  window.fbq('track', name, params || {}, opts);
}
