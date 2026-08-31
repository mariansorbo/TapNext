// Canal de verificación por email — envío vía Resend (API REST, una sola llamada
// fetch, sin dependencias nuevas).
//
// Sin RESEND_API_KEY + EMAIL_FROM el canal queda `disponible: false` y el
// endpoint cae a modo demo (mismo patrón que los demás integradores opcionales).

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const EMAIL_ASUNTO = process.env.EMAIL_OTP_ASUNTO || 'Tu código de verificación';

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function enviarPorResend(destino, codigo) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [destino],
      subject: EMAIL_ASUNTO,
      text: `Tu código de verificación es ${codigo}. Vence en unos minutos. Si no lo pediste, ignorá este mensaje.`,
      html: `<p>Tu código de verificación es:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:8px 0">${codigo}</p>
<p>Vence en unos minutos. Si no lo pediste, ignorá este mensaje.</p>`,
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    throw new Error(`Resend respondió ${res.status}: ${detalle}`);
  }
}

/** @type {import('../index.js').CanalVerificacion} */
export const canalEmail = {
  id: 'email',
  nombre: 'email',
  campoComprador: 'email',
  tipoInput: 'email',
  placeholder: 'vos@ejemplo.com',
  disponible: Boolean(RESEND_API_KEY && EMAIL_FROM),
  normalizarDestino(raw) {
    const t = String(raw || '').trim().toLowerCase();
    return RE_EMAIL.test(t) ? t : null;
  },
  enviarCodigo: enviarPorResend,
};
