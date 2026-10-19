// Google Analytics 4 — Measurement Protocol. Manda el `purchase` server-side
// desde el webhook de Mercado Pago, así GA ve todas las ventas confirmadas
// (el navegador puede no llegar a la pantalla de éxito, o tener un bloqueador).
// El navegador NO manda purchase (ver src/comprar.js): esta es la única fuente.
//
// Para que la venta quede atribuida a la campaña de la visita, el front manda
// el client_id y el session_id de gtag al crear la venta (ventas.ga_client_id
// / ga_session_id). Si no los hay (GA bloqueado), se manda igual con un
// client_id propio: la venta cuenta en los totales, aunque sin campaña.
//
// Patrón "integrador opcional", igual que meta-capi.js / pap.js: sin
// GA_API_SECRET, `ga4Disponible` es false y nada pega a la red.
// Debug: GA_MP_DEBUG=1 usa el endpoint de validación (no registra nada).

const MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || '';
const API_SECRET = process.env.GA_API_SECRET || '';
const DEBUG = process.env.GA_MP_DEBUG === '1';

export const ga4Disponible = Boolean(MEASUREMENT_ID && API_SECRET);

// client_id de gtag: "1234567890.1700000000". session_id: timestamp en segundos.
export const esGaClientId = (v) => typeof v === 'string' && /^\d{1,20}\.\d{1,20}$/.test(v);
export const esGaSessionId = (v) => typeof v === 'string' && /^\d{1,20}$/.test(v);

/**
 * Arma el body del Measurement Protocol para un purchase. Separado del envío
 * para poder testearlo sin red.
 * @param {{
 *   transactionId: string|number, value: number, currency?: string,
 *   shipping?: number, items: Array<{ modelo: string, destinoTipo: string, precio: number }>,
 *   clientId?: string|null, sessionId?: string|null,
 * }} datos
 */
export function armarPurchase({ transactionId, value, currency = 'ARS', shipping = 0, items, clientId, sessionId }) {
  // Agrupa unidades iguales (modelo + función) en un ítem con quantity.
  const agrupados = [];
  for (const it of items) {
    const id = `${it.modelo}__${it.destinoTipo}`;
    const g = agrupados.find((x) => x.item_id === id && x.price === it.precio);
    if (g) g.quantity += 1;
    else
      agrupados.push({
        item_id: id,
        item_name: `${it.modelo} · ${it.destinoTipo}`,
        item_category: it.modelo,
        item_variant: it.destinoTipo,
        price: it.precio,
        quantity: 1,
      });
  }
  const params = {
    transaction_id: String(transactionId),
    value,
    currency,
    shipping,
    items: agrupados,
    // Sin esto GA no asocia el evento a una sesión "activa".
    engagement_time_msec: 1,
  };
  if (sessionId) params.session_id = sessionId;
  return {
    client_id: clientId || `nt.${transactionId}`,
    events: [{ name: 'purchase', params }],
  };
}

/** Best-effort: quien la llama la envuelve en try/catch. */
export async function enviarGaPurchase(datos) {
  if (!ga4Disponible) return;
  const base = DEBUG ? 'https://www.google-analytics.com/debug/mp/collect' : 'https://www.google-analytics.com/mp/collect';
  const url = `${base}?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(API_SECRET)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(armarPurchase(datos)),
  });
  // /mp/collect responde 2xx aunque el payload sea inválido; para validar,
  // GA_MP_DEBUG=1 y mirar validationMessages.
  if (!res.ok) throw new Error(`GA4 respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (DEBUG) console.log('[GA4 debug]', await res.text());
}
