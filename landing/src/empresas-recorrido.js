// Variante /empresas-v2, "Un segundo que es de tu marca": la demo de fondo se
// para detrás del paso que está pasando, y el paso 03 dice WhatsApp / Instagram
// según la demo. Mismo comportamiento que en empresas.js, sin el arranque.
const NOMBRE_DESTINO = { wa: 'WhatsApp', ig: 'Instagram' };
const ACCION_DESTINO = { wa: 'escribirle', ig: 'seguirlo' };
const recorrido = document.querySelector('.emp-recorrido');
const demoPasos = recorrido?.querySelector('[data-empresas-demo]');
const palabraPaso = recorrido?.querySelector('[data-destino-paso]');
const accionPaso = recorrido?.querySelector('[data-destino-accion]');

demoPasos?.addEventListener('demo-fase', (e) => {
  recorrido.dataset.fase = e.detail;
});
demoPasos?.addEventListener('demo-destino', (e) => {
  if (!palabraPaso || !NOMBRE_DESTINO[e.detail]) return;
  palabraPaso.dataset.destino = e.detail;
  palabraPaso.textContent = NOMBRE_DESTINO[e.detail];
  if (accionPaso) accionPaso.textContent = ACCION_DESTINO[e.detail];
  palabraPaso.classList.remove('cambia');
  void palabraPaso.offsetWidth; // reinicia la animación de entrada
  palabraPaso.classList.add('cambia');
});
