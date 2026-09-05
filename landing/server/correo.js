// Correo transaccional (avisos post-venta, no verificación) — envío vía Resend,
// misma API REST y mismas credenciales que el canal de verificación por email
// (RESEND_API_KEY + EMAIL_FROM). Se mantiene aparte de verificacion/canales/email.js
// porque ese módulo está acoplado al texto del OTP; acá el asunto y el cuerpo
// los arma quien llama.
//
// Sin RESEND_API_KEY + EMAIL_FROM, `correoDisponible` es false y `enviarCorreo`
// no hace nada (devuelve false) — mismo patrón que el resto de integradores
// opcionales: en local/demo no rompe nada, solo no manda el mail.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';

export const correoDisponible = Boolean(RESEND_API_KEY && EMAIL_FROM);

/**
 * Manda un mail. Best-effort: nunca lanza — devuelve true si Resend lo aceptó,
 * false si no está configurado o si falló (y en ese caso deja el error en consola).
 * @param {{ to: string, subject: string, text: string, html?: string }} msg
 * @returns {Promise<boolean>}
 */
export async function enviarCorreo({ to, subject, text, html }) {
  if (!correoDisponible) {
    console.log(`[correo demo] Para ${to} — "${subject}"\n${text}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        text,
        ...(html ? { html } : {}),
      }),
    });
    if (!res.ok) {
      const detalle = await res.text();
      throw new Error(`Resend respondió ${res.status}: ${detalle}`);
    }
    return true;
  } catch (err) {
    console.error(`[correo] Falló el envío a ${to} ("${subject}"):`, err.message);
    return false;
  }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Nombre legible del modelo para los textos del mail.
function nombreModelo(modelo) {
  if (!modelo || modelo === 'suelto') return 'Sticker NFC (suelto)';
  return modelo.charAt(0).toUpperCase() + modelo.slice(1);
}

/**
 * Arma el mail para el COMPRADOR: qué ID(s) de producto va a recibir.
 * @param {{ items: Array<{ codigoPublico: string, modelo: string|null }>, panelUrl: string }} data
 */
export function mailCompraComprador({ items, panelUrl }) {
  const lineasText = items.map((it) => `  • ${nombreModelo(it.modelo)} — ID: ${it.codigoPublico}`).join('\n');
  const lineasHtml = items
    .map(
      (it) =>
        `<li><strong>${esc(nombreModelo(it.modelo))}</strong> — ID: <code style="font-size:16px;font-weight:700;letter-spacing:1px">${esc(it.codigoPublico)}</code></li>`
    )
    .join('');
  const plural = items.length > 1;
  const subject = plural
    ? `Tu compra en NextTap — IDs ${items.map((i) => i.codigoPublico).join(', ')}`
    : `Tu compra en NextTap — ID ${items[0].codigoPublico}`;
  const text = `¡Gracias por tu compra en NextTap!

Tu pago fue confirmado. ${plural ? 'Los productos que vas a recibir son' : 'El producto que vas a recibir es'}:

${lineasText}

Ese ${plural ? 'es el ID que va impreso en cada' : 'es el ID que va impreso en tu'} producto — verificá que coincida con el que te entrega quien te lo vende.

Podés configurar a dónde apunta ${plural ? 'cada uno' : 'tu NextTap'} desde tu panel:
${panelUrl}`;
  const html = `<p>¡Gracias por tu compra en <strong>NextTap</strong>!</p>
<p>Tu pago fue confirmado. ${plural ? 'Los productos que vas a recibir son' : 'El producto que vas a recibir es'}:</p>
<ul>${lineasHtml}</ul>
<p>Ese ${plural ? 'es el ID que va impreso en cada' : 'es el ID que va impreso en tu'} producto — verificá que coincida con el que te entrega quien te lo vende.</p>
<p>Podés configurar a dónde apunta ${plural ? 'cada uno' : 'tu NextTap'} desde <a href="${esc(panelUrl)}">tu panel</a>.</p>`;
  return { subject, text, html };
}

/**
 * Arma el mail para el VENDEDOR: qué unidad(es) física(s) tiene que entregar.
 * @param {{ items: Array<{ codigoPublico: string, modelo: string|null }>, comprador: { nombre?: string|null, whatsapp?: string|null, email?: string|null }|null, monto: number, panelUrl: string }} data
 */
export function mailVentaVendedor({ items, comprador, monto, panelUrl }) {
  const lineasText = items.map((it) => `  • ${nombreModelo(it.modelo)} — ID: ${it.codigoPublico}`).join('\n');
  const lineasHtml = items
    .map(
      (it) =>
        `<li><strong>${esc(nombreModelo(it.modelo))}</strong> — ID: <code style="font-size:16px;font-weight:700;letter-spacing:1px">${esc(it.codigoPublico)}</code></li>`
    )
    .join('');
  const contacto =
    comprador && (comprador.nombre || comprador.whatsapp || comprador.email)
      ? [comprador.nombre, comprador.whatsapp, comprador.email].filter(Boolean).join(' · ')
      : 'sin datos de contacto cargados';
  const plural = items.length > 1;
  const subject = plural
    ? `Vendiste ${items.length} NextTap — entregá los IDs ${items.map((i) => i.codigoPublico).join(', ')}`
    : `Vendiste un NextTap — entregá el ID ${items[0].codigoPublico}`;
  const text = `Se confirmó un pago de una venta tuya.

${plural ? 'Entregá al comprador las unidades con estos IDs' : 'Entregá al comprador la unidad con este ID'}:

${lineasText}

Comprador: ${contacto}
Monto: $${monto}

El ID impreso en ${plural ? 'cada unidad que entregues' : 'la unidad que entregues'} tiene que coincidir exactamente con el de arriba.

Ver tus ventas: ${panelUrl}`;
  const html = `<p>Se confirmó un pago de una venta tuya.</p>
<p>${plural ? 'Entregá al comprador las unidades con estos IDs' : 'Entregá al comprador la unidad con este ID'}:</p>
<ul>${lineasHtml}</ul>
<p><strong>Comprador:</strong> ${esc(contacto)}<br><strong>Monto:</strong> $${esc(monto)}</p>
<p>El ID impreso en ${plural ? 'cada unidad que entregues' : 'la unidad que entregues'} tiene que coincidir exactamente con el de arriba.</p>
<p><a href="${esc(panelUrl)}">Ver tus ventas</a></p>`;
  return { subject, text, html };
}

/**
 * Arma el mail para el COMPRADOR de una ACTIVACIÓN GRATIS (no pagó nada).
 * `cuentaNueva`: true si la cuenta se creó con este mail recién; false si ya existía.
 * @param {{ items: Array<{ codigoPublico: string, modelo: string|null }>, panelUrl: string, cuentaNueva: boolean }} data
 */
export function mailActivacionGratis({ items, panelUrl, cuentaNueva }) {
  const lineasText = items.map((it) => `  • ${nombreModelo(it.modelo)} — ID: ${it.codigoPublico}`).join('\n');
  const lineasHtml = items
    .map(
      (it) =>
        `<li><strong>${esc(nombreModelo(it.modelo))}</strong> — ID: <code style="font-size:16px;font-weight:700;letter-spacing:1px">${esc(it.codigoPublico)}</code></li>`
    )
    .join('');
  const plural = items.length > 1;
  const subject = plural
    ? `Tus NextTap ya están activos — IDs ${items.map((i) => i.codigoPublico).join(', ')}`
    : `Tu NextTap ya está activo — ID ${items[0].codigoPublico}`;

  const cuentaText = cuentaNueva
    ? 'Te creamos una cuenta con este mail. La primera vez que entres a tu panel te pedimos un código de verificación que te llega por mail.'
    : `Ya tenías una cuenta con este mail: sumamos ${plural ? 'estos NextTap' : 'este NextTap'} ahí. Entrá con el mismo mail de siempre.`;
  const cuentaHtml = cuentaNueva
    ? `Te creamos una cuenta con este mail. La primera vez que entres a <a href="${esc(panelUrl)}">tu panel</a> te pedimos un código de verificación que te llega por mail.`
    : `Ya tenías una cuenta con este mail: sumamos ${plural ? 'estos NextTap' : 'este NextTap'} ahí. Entrá a <a href="${esc(panelUrl)}">tu panel</a> con el mismo mail de siempre.`;
  const ojoText = cuentaNueva
    ? 'Si no activaste ningún NextTap, ignorá este mensaje.'
    : 'Si no fuiste vos, entrá a tu panel a revisar — alguien activó un NextTap con tu mail.';

  const text = `${plural ? 'Tus NextTap ya están activos' : 'Tu NextTap ya está activo'} — sin costo, ${plural ? 'son tuyos' : 'es tuyo'}.

${plural ? 'Tus productos' : 'Tu producto'}:

${lineasText}

Ese ${plural ? 'es el ID que va impreso en cada' : 'es el ID impreso en tu'} producto.

Para elegir a dónde lleva cuando alguien lo apoya en el teléfono, entrá a tu panel:
${panelUrl}

${cuentaText}

${ojoText}`;

  const html = `<p>${plural ? 'Tus NextTap ya están activos' : 'Tu NextTap ya está activo'} — sin costo, ${plural ? 'son tuyos' : 'es tuyo'}.</p>
<p>${plural ? 'Tus productos' : 'Tu producto'}:</p>
<ul>${lineasHtml}</ul>
<p>Ese ${plural ? 'es el ID que va impreso en cada' : 'es el ID impreso en tu'} producto.</p>
<p>Para elegir a dónde lleva, entrá a <a href="${esc(panelUrl)}">tu panel</a>.</p>
<p>${cuentaHtml}</p>
<p style="color:#666;font-size:13px">${ojoText}</p>`;
  return { subject, text, html };
}
