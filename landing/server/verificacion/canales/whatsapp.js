// Canal de verificación por WhatsApp — WhatsApp Business Platform (Cloud API de Meta).
//
// Sin WHATSAPP_BUSINESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TEMPLATE_NAME
// el canal queda `disponible: false` y el endpoint cae a modo demo (mismo patrón
// que Google Sign-In / Mercado Pago en index.js). Nada se rompe si no están.

const WHATSAPP_BUSINESS_TOKEN = process.env.WHATSAPP_BUSINESS_TOKEN || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || '';
const WHATSAPP_TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'es';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

// La Cloud API requiere el número en formato E.164 sin el "+" (ej. 5491122334455).
function soloDigitos(numero) {
  return numero.replace(/[^\d]/g, '');
}

async function enviarPorApi(destino, codigo) {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: soloDigitos(destino),
    type: 'template',
    template: {
      name: WHATSAPP_TEMPLATE_NAME,
      language: { code: WHATSAPP_TEMPLATE_LANG },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: codigo }] },
        // Botón de "copiar código" estándar de los templates de autenticación de Meta.
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: codigo }] },
      ],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_BUSINESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detalle = await res.text();
    throw new Error(`WhatsApp API respondió ${res.status}: ${detalle}`);
  }
}

/** @type {import('../index.js').CanalVerificacion} */
export const canalWhatsapp = {
  id: 'whatsapp',
  nombre: 'WhatsApp',
  campoComprador: 'whatsapp',
  tipoInput: 'tel',
  placeholder: '+54 9 11 1234 5678',
  disponible: Boolean(
    WHATSAPP_BUSINESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_TEMPLATE_NAME
  ),
  // No reformateamos: guardamos lo que tipeó (así no se duplican compradores por
  // cambio de formato). El pasaje a E.164 se hace recién al mandar.
  normalizarDestino(raw) {
    const t = String(raw || '').trim();
    return soloDigitos(t).length >= 8 ? t : null;
  },
  enviarCodigo: enviarPorApi,
};
