// Meta Conversions API — manda server-side el mismo Purchase que ya dispara
// el pixel del navegador (ver src/pixel.js), con el mismo event_id
// (`purchase_<ventaId>`) para que Meta lo fusione en uno solo en vez de
// contarlo dos veces (dedup por event_id — doc: developers.facebook.com/docs/
// marketing-api/conversions-api/deduplicate-pixel-and-capi-events).
//
// Patrón "integrador opcional", igual que enviopack.js / correo.js: sin
// META_CAPI_ACCESS_TOKEN, `metaCapiDisponible` es false y nada pega a la red —
// el webhook de Mercado Pago sigue confirmando la venta igual.

import { createHash } from 'node:crypto';

const PIXEL_ID = process.env.META_PIXEL_ID || '2192903191273005'; // mismo ID que src/pixel.js
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || '';
const API_VERSION = process.env.META_CAPI_API_VERSION || 'v21.0';

export const metaCapiDisponible = Boolean(ACCESS_TOKEN);

function sha256(valor) {
  return createHash('sha256').update(String(valor).trim().toLowerCase()).digest('hex');
}

// Meta pide el teléfono en E.164 sin "+", hasheado igual que el resto de los
// campos de user_data (mismo criterio que el canal de verificación por
// WhatsApp — ver server/verificacion/canales/whatsapp.js).
function soloDigitos(numero) {
  return String(numero).replace(/[^\d]/g, '');
}

/**
 * Manda un evento Purchase a la Conversions API. Best-effort: quien la llama
 * decide qué hacer si tira (el webhook la envuelve en try/catch y solo loguea
 * — un fallo acá nunca puede frenar la confirmación de una venta ya pagada).
 * @param {{
 *   eventId: string, value: number, currency?: string,
 *   email?: string|null, telefono?: string|null,
 *   ip?: string|null, userAgent?: string|null,
 *   fbp?: string|null, fbc?: string|null,
 *   eventSourceUrl?: string,
 * }} datos
 */
export async function enviarCapiPurchase({
  eventId,
  value,
  currency = 'ARS',
  email,
  telefono,
  ip,
  userAgent,
  fbp,
  fbc,
  eventSourceUrl,
}) {
  if (!metaCapiDisponible) return;

  const userData = {};
  if (email) userData.em = [sha256(email)];
  if (telefono) userData.ph = [sha256(soloDigitos(telefono))];
  if (ip) userData.client_ip_address = ip;
  if (userAgent) userData.client_user_agent = userAgent;
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: eventSourceUrl || undefined,
        user_data: userData,
        custom_data: { value, currency },
      },
    ],
  };

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Meta CAPI respondió ${res.status}: ${await res.text()}`);
  }
}
