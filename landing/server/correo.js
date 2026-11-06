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
 * @param {{ to: string, subject: string, text: string, html?: string, replyTo?: string }} msg
 * @returns {Promise<boolean>}
 */
export async function enviarCorreo({ to, subject, text, html, replyTo }) {
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
        ...(replyTo ? { reply_to: replyTo } : {}),
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
  if (!modelo || modelo === 'suelto') return 'Producto NFC';
  return modelo.charAt(0).toUpperCase() + modelo.slice(1);
}

// Bloque "Activar mi cuenta" del primer mail: el link entra directo a Mi panel
// (un solo uso, vence) y ahí se ofrece crear una contraseña. Sin accesoUrl
// (cuenta que ya existía o ya tiene contraseña) no se agrega nada.
function bloqueAcceso(accesoUrl) {
  if (!accesoUrl) return { text: '', html: '' };
  return {
    text: `\n\nActivá tu cuenta y entrá directo a tu panel, sin código — ahí también podés crear una contraseña si querés (el link sirve una sola vez y vence en 7 días):\n${accesoUrl}`,
    html: `<p style="margin:24px 0"><a href="${esc(accesoUrl)}" style="background:#7B5CFF;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px;display:inline-block">Activar mi cuenta</a></p>
<p style="color:#666;font-size:13px">Entrás directo a tu panel, sin código, y ahí podés crear una contraseña si querés. El link sirve una sola vez y vence en 7 días.</p>`,
  };
}

/**
 * Arma el mail para el COMPRADOR: qué ID(s) de producto va a recibir.
 * @param {{ items: Array<{ codigoPublico: string, modelo: string|null }>, panelUrl: string, accesoUrl?: string|null }} data
 */
export function mailCompraComprador({ items, panelUrl, accesoUrl = null }) {
  const acceso = bloqueAcceso(accesoUrl);
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
${panelUrl}${acceso.text}`;
  const html = `<p>¡Gracias por tu compra en <strong>NextTap</strong>!</p>
<p>Tu pago fue confirmado. ${plural ? 'Los productos que vas a recibir son' : 'El producto que vas a recibir es'}:</p>
<ul>${lineasHtml}</ul>
<p>Ese ${plural ? 'es el ID que va impreso en cada' : 'es el ID que va impreso en tu'} producto — verificá que coincida con el que te entrega quien te lo vende.</p>
<p>Podés configurar a dónde apunta ${plural ? 'cada uno' : 'tu NextTap'} desde <a href="${esc(panelUrl)}">tu panel</a>.</p>${acceso.html}`;
  return { subject, text, html };
}

// 'YYYY-MM-DD' -> "martes 17 de noviembre" (sin pasar por la zona horaria del server).
export function fechaLarga(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * Mail al COMPRADOR de una compra con envío gratis por entrega propia: cuándo
 * lo recibe y el link para coordinar día y horario (o pedir Correo).
 * @param {{ nombre?: string, entregaUrl: string, fechaLimite: string, diasDeposito: number }} data
 */
export function mailEntregaCoordinar({ nombre, entregaUrl, fechaLimite, diasDeposito }) {
  const hola = nombre ? `Hola ${String(nombre).trim().split(/\s+/)[0]}` : 'Hola';
  const limite = fechaLarga(fechaLimite);
  const subject = 'Coordinemos la entrega de tu NextTap';
  const text = `${hola}, ¡gracias por tu compra!

Tu envío es gratis y te lo llevamos nosotros en mano, a más tardar el ${limite}.

Elegí el día y el horario que mejor te quede desde este link:
${entregaUrl}

Importante: hacemos un solo intento de entrega. Si ese día no hay nadie para recibirlo, tu llavero queda ${diasDeposito} días en nuestro depósito y lo podés recibir por Correo Argentino, abonando el costo de ese envío. Si preferís el Correo desde el principio, también lo podés pedir en el mismo link.`;
  const html = `<p>${esc(hola)}, ¡gracias por tu compra!</p>
<p>Tu envío es <strong>gratis</strong> y te lo llevamos nosotros en mano, a más tardar el <strong>${esc(limite)}</strong>.</p>
<p style="margin:24px 0"><a href="${esc(entregaUrl)}" style="background:#7B5CFF;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px;display:inline-block">Elegir día y horario</a></p>
<p style="color:#444;font-size:14px"><strong>Importante:</strong> hacemos un solo intento de entrega. Si ese día no hay nadie para recibirlo, tu llavero queda ${esc(diasDeposito)} días en nuestro depósito y lo podés recibir por Correo Argentino, abonando el costo de ese envío. Si preferís el Correo desde el principio, también lo podés pedir en el mismo link.</p>`;
  return { subject, text, html };
}

const FRANJA_TEXTO = { manana: 'entre las 9 y las 13 hs', tarde: 'entre las 13 y las 18 hs', noche: 'entre las 18 y las 21 hs' };

/**
 * Mail al COMPRADOR el día de la entrega: "hoy pasamos". Repite la regla del
 * único intento y le da el link para pedir el envío por correo si no va a estar.
 * @param {{ nombre?: string, entregaUrl: string, franja?: string|null, diasDeposito: number }} data
 */
export function mailEntregaSalida({ nombre, entregaUrl, franja, diasDeposito }) {
  const hola = nombre ? `Hola ${String(nombre).trim().split(/\s+/)[0]}` : 'Hola';
  const cuando = FRANJA_TEXTO[franja] ? ` ${FRANJA_TEXTO[franja]}` : '';
  const subject = 'Hoy te llevamos tu NextTap';
  const text = `${hola}, hoy pasamos por tu domicilio${cuando} para entregarte tu NextTap.

Es un único intento de entrega: si no hay nadie para recibirlo, tu llavero queda ${diasDeposito} días en nuestro depósito y lo podés recibir por Correo Argentino abonando ese envío.

¿No vas a estar? Podés pedir el envío por correo desde acá:
${entregaUrl}`;
  const html = `<p>${esc(hola)}, <strong>hoy pasamos por tu domicilio${esc(cuando)}</strong> para entregarte tu NextTap.</p>
<p style="color:#444;font-size:14px">Es un único intento de entrega: si no hay nadie para recibirlo, tu llavero queda ${esc(diasDeposito)} días en nuestro depósito y lo podés recibir por Correo Argentino abonando ese envío.</p>
<p>¿No vas a estar? <a href="${esc(entregaUrl)}">Pedí el envío por correo desde acá</a>.</p>`;
  return { subject, text, html };
}

/**
 * Mail al COMPRADOR cuando se pasó y no había nadie: el llavero queda en
 * depósito y el link le permite pedir el envío por correo.
 * @param {{ nombre?: string, entregaUrl: string, diasDeposito: number }} data
 */
export function mailEntregaNoEstaba({ nombre, entregaUrl, diasDeposito }) {
  const hola = nombre ? `Hola ${String(nombre).trim().split(/\s+/)[0]}` : 'Hola';
  const subject = 'Pasamos y no te encontramos — tu NextTap te espera';
  const text = `${hola}, pasamos por tu domicilio para entregarte tu NextTap y no había nadie.

Tu llavero queda guardado ${diasDeposito} días en nuestro depósito. Para recibirlo por Correo Argentino (el costo del envío lo abonás vos), pedilo desde este link:
${entregaUrl}

Te escribimos con el costo y cómo abonarlo.`;
  const html = `<p>${esc(hola)}, pasamos por tu domicilio para entregarte tu NextTap y no había nadie.</p>
<p>Tu llavero queda guardado <strong>${esc(diasDeposito)} días</strong> en nuestro depósito. Para recibirlo por Correo Argentino (el costo del envío lo abonás vos), pedilo desde acá:</p>
<p style="margin:24px 0"><a href="${esc(entregaUrl)}" style="background:#7B5CFF;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px;display:inline-block">Pedir envío por correo</a></p>
<p style="color:#444;font-size:14px">Te escribimos con el costo y cómo abonarlo.</p>`;
  return { subject, text, html };
}

/**
 * Recordatorio al COMPRADOR cuyo llavero espera en depósito (días 7 y 20).
 * @param {{ nombre?: string, entregaUrl: string, diasRestantes: number }} data
 */
export function mailEntregaRecordatorio({ nombre, entregaUrl, diasRestantes }) {
  const hola = nombre ? `Hola ${String(nombre).trim().split(/\s+/)[0]}` : 'Hola';
  const subject = `Tu NextTap sigue esperándote (te quedan ${diasRestantes} días)`;
  const text = `${hola}, tu NextTap sigue guardado en nuestro depósito. Te quedan ${diasRestantes} días para pedir que te lo enviemos por correo (el costo del envío lo abonás vos).

Pedilo desde este link:
${entregaUrl}

Pasado el plazo no podemos seguir guardándolo.`;
  const html = `<p>${esc(hola)}, tu NextTap sigue guardado en nuestro depósito. Te quedan <strong>${esc(diasRestantes)} días</strong> para pedir que te lo enviemos por correo (el costo del envío lo abonás vos).</p>
<p style="margin:24px 0"><a href="${esc(entregaUrl)}" style="background:#7B5CFF;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px;display:inline-block">Pedir envío por correo</a></p>
<p style="color:#444;font-size:14px">Pasado el plazo no podemos seguir guardándolo.</p>`;
  return { subject, text, html };
}

/**
 * Aviso al COMPRADOR cuando se cumplieron los 30 días de depósito sin que
 * pidiera el envío: lo invita a escribir para resolverlo.
 * @param {{ nombre?: string }} data
 */
export function mailEntregaVencida({ nombre }) {
  const hola = nombre ? `Hola ${String(nombre).trim().split(/\s+/)[0]}` : 'Hola';
  const subject = 'Se cumplió el plazo de depósito de tu NextTap';
  const text = `${hola}, pasaron 30 días desde que intentamos entregarte tu NextTap y no pediste el envío por correo.

Escribinos y lo resolvemos: WhatsApp +54 9 11 7108-2780 o mariansorbo@gmail.com.`;
  const html = `<p>${esc(hola)}, pasaron 30 días desde que intentamos entregarte tu NextTap y no pediste el envío por correo.</p>
<p>Escribinos y lo resolvemos: <a href="https://wa.me/541171082780">WhatsApp +54 9 11 7108-2780</a> o <a href="mailto:mariansorbo@gmail.com">mariansorbo@gmail.com</a>.</p>`;
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
 * Venta presencial con cola de entrega (late binding): el comprador NO recibe un
 * ID de unidad para cotejar — recibe un código de retiro que le muestra al
 * vendedor. Ver "Cola de entrega y botón de despacho" en el vault.
 * @param {{ codigoRetiro: string, panelUrl: string, accesoUrl?: string|null }} data
 */
export function mailRetiroComprador({ codigoRetiro, panelUrl, accesoUrl = null }) {
  const acceso = bloqueAcceso(accesoUrl);
  const subject = `Tu compra en NextTap — código de retiro ${codigoRetiro}`;
  const text = `¡Gracias por tu compra en NextTap!

Tu pago fue confirmado. Para retirar tu llavero, mostrale este código al vendedor:

  ${codigoRetiro}

Él te va a llamar y entregar tu unidad. Después configurás a dónde apunta desde tu panel:
${panelUrl}${acceso.text}`;
  const html = `<p>¡Gracias por tu compra en <strong>NextTap</strong>!</p>
<p>Tu pago fue confirmado. Para retirar tu llavero, mostrale este código al vendedor:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${esc(codigoRetiro)}</p>
<p>Él te va a llamar y entregar tu unidad. Después configurás a dónde apunta desde <a href="${esc(panelUrl)}">tu panel</a>.</p>${acceso.html}`;
  return { subject, text, html };
}

/**
 * Venta presencial con cola: al vendedor le avisa que entró un pedido a la cola,
 * con el código de retiro que el comprador le va a mostrar.
 * @param {{ codigoRetiro: string, comprador: { nombre?: string|null, whatsapp?: string|null, email?: string|null }|null, monto: number, panelUrl: string }} data
 */
export function mailRetiroVendedor({ codigoRetiro, comprador, monto, panelUrl }) {
  const contacto =
    comprador && (comprador.nombre || comprador.whatsapp || comprador.email)
      ? [comprador.nombre, comprador.whatsapp, comprador.email].filter(Boolean).join(' · ')
      : 'sin datos de contacto cargados';
  const subject = `Nuevo pedido en la cola — código ${codigoRetiro}`;
  const text = `Se confirmó un pago de una venta tuya. El pedido entró a la cola de entrega.

Código de retiro: ${codigoRetiro}
Comprador: ${contacto}
Monto: $${monto}

Desde el panel "Entrega" tapeás cualquier llavero del combo y el sistema te dice a quién le toca. El comprador te muestra este código.

Ver tus ventas: ${panelUrl}`;
  const html = `<p>Se confirmó un pago de una venta tuya. El pedido entró a la <strong>cola de entrega</strong>.</p>
<p><strong>Código de retiro:</strong> <code style="font-size:16px;font-weight:700;letter-spacing:2px">${esc(codigoRetiro)}</code><br>
<strong>Comprador:</strong> ${esc(contacto)}<br><strong>Monto:</strong> $${esc(monto)}</p>
<p>Desde el panel "Entrega" tapeás cualquier llavero del combo y el sistema te dice a quién le toca. El comprador te muestra este código.</p>
<p><a href="${esc(panelUrl)}">Ver tus ventas</a></p>`;
  return { subject, text, html };
}

/**
 * Arma el mail para el COMPRADOR de una ACTIVACIÓN GRATIS (no pagó nada).
 * `cuentaNueva`: true si la cuenta se creó con este mail recién; false si ya existía.
 * @param {{ items: Array<{ codigoPublico: string, modelo: string|null }>, panelUrl: string, cuentaNueva: boolean, accesoUrl?: string|null }} data
 */
export function mailActivacionGratis({ items, panelUrl, cuentaNueva, accesoUrl = null }) {
  const acceso = bloqueAcceso(accesoUrl);
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
    ? accesoUrl
      ? 'Te creamos una cuenta con este mail. Para entrar la primera vez usá el link de arriba; después, si querés entrar por tu cuenta, te pedimos un código que te llega por mail.'
      : 'Te creamos una cuenta con este mail. La primera vez que entres a tu panel te pedimos un código de verificación que te llega por mail.'
    : `Ya tenías una cuenta con este mail: sumamos ${plural ? 'estos NextTap' : 'este NextTap'} ahí. Entrá con el mismo mail de siempre.`;
  const cuentaHtml = cuentaNueva
    ? accesoUrl
      ? 'Te creamos una cuenta con este mail. Para entrar la primera vez usá el botón de arriba; después, si querés entrar por tu cuenta, te pedimos un código que te llega por mail.'
      : `Te creamos una cuenta con este mail. La primera vez que entres a <a href="${esc(panelUrl)}">tu panel</a> te pedimos un código de verificación que te llega por mail.`
    : `Ya tenías una cuenta con este mail: sumamos ${plural ? 'estos NextTap' : 'este NextTap'} ahí. Entrá a <a href="${esc(panelUrl)}">tu panel</a> con el mismo mail de siempre.`;
  const ojoText = cuentaNueva
    ? 'Si no activaste ningún NextTap, ignorá este mensaje.'
    : 'Si no fuiste vos, entrá a tu panel a revisar — alguien activó un NextTap con tu mail.';

  const text = `${plural ? 'Tus NextTap ya están activos' : 'Tu NextTap ya está activo'} — sin costo, ${plural ? 'son tuyos' : 'es tuyo'}.

${plural ? 'Tus productos' : 'Tu producto'}:

${lineasText}

Ese ${plural ? 'es el ID que va impreso en cada' : 'es el ID impreso en tu'} producto.

Para elegir a dónde lleva cuando alguien lo apoya en el teléfono, entrá a tu panel:
${panelUrl}${acceso.text}

${cuentaText}

${ojoText}`;

  const html = `<p>${plural ? 'Tus NextTap ya están activos' : 'Tu NextTap ya está activo'} — sin costo, ${plural ? 'son tuyos' : 'es tuyo'}.</p>
<p>${plural ? 'Tus productos' : 'Tu producto'}:</p>
<ul>${lineasHtml}</ul>
<p>Ese ${plural ? 'es el ID que va impreso en cada' : 'es el ID impreso en tu'} producto.</p>
<p>Para elegir a dónde lleva, entrá a <a href="${esc(panelUrl)}">tu panel</a>.</p>${acceso.html}
<p>${cuentaHtml}</p>
<p style="color:#666;font-size:13px">${ojoText}</p>`;
  return { subject, text, html };
}
