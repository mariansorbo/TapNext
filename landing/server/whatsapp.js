// Envío de mensajes vía WhatsApp Business Platform (Cloud API de Meta).
// Sin WHATSAPP_BUSINESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID configuradas, queda
// inactivo (mismo patrón que Google Sign-In / Mercado Pago en index.js).

const WHATSAPP_BUSINESS_TOKEN = process.env.WHATSAPP_BUSINESS_TOKEN || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || '';
const WHATSAPP_TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'es';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

export const WHATSAPP_ENABLED = Boolean(
  WHATSAPP_BUSINESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_TEMPLATE_NAME
);

// La Cloud API requiere el número en formato E.164 sin el "+" (ej. 5491122334455).
function normalizarWhatsapp(numero) {
  return numero.replace(/[^\d]/g, '');
}

// Manda el código OTP usando un Message Template de categoría "Authentication"
// pre-aprobado por Meta (obligatorio: no se puede mandar texto libre a un
// número que no escribió antes en las últimas 24hs).
export async function enviarOtpWhatsapp(whatsapp, code) {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: normalizarWhatsapp(whatsapp),
    type: 'template',
    template: {
      name: WHATSAPP_TEMPLATE_NAME,
      language: { code: WHATSAPP_TEMPLATE_LANG },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        // Botón de "copiar código" estándar de los templates de autenticación de Meta.
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
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
