// Alertas por mail al ADMIN (el dueño), pensadas para la etapa de lanzamiento:
// seguir de cerca cada compra — cuando alguien va a pagar, cuando el checkout
// falla, cuando el pago no llega, cuando se rechaza, y cuando se confirma (con
// el resultado de cada paso posterior: mails, Enviopack, Meta CAPI).
//
// Destino: ADMIN_EMAIL_AVISOS (uno o varios mails separados por coma). Sale por
// Resend con las mismas credenciales que correo.js. Sin ADMIN_EMAIL_AVISOS no
// se manda nada (solo se loguea) — mismo patrón "integrador opcional".
//
// Best-effort: nunca lanza. Una alerta que falla jamás puede frenar una venta.

import { enviarCorreo } from './correo.js';

const DESTINATARIOS = String(process.env.ADMIN_EMAIL_AVISOS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const alertasAdminDisponibles = DESTINATARIOS.length > 0;

// Minutos que esperamos desde que el comprador apretó "Pagar" hasta avisar que
// el pago nunca llegó (ni aprobado ni rechazado).
export const MIN_AVISO_SIN_PAGO = Number(process.env.ADMIN_AVISO_SIN_PAGO_MIN) || 30;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const pesos = (n) => `$${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

/**
 * Manda una alerta al admin.
 * @param {{ asunto: string, lineas: Array<string|null|undefined|false> }} alerta
 *   `lineas` admite vacíos (se descartan) para armar el cuerpo con condicionales.
 */
export async function avisarAdmin({ asunto, lineas }) {
  try {
    const cuerpo = lineas.filter((l) => l !== null && l !== undefined && l !== false);
    const subject = `[AlToque Tap] ${asunto}`;
    const text = cuerpo.join('\n');
    if (!alertasAdminDisponibles) {
      console.log(`[alerta admin — sin ADMIN_EMAIL_AVISOS] ${subject}\n${text}`);
      return;
    }
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${cuerpo
      .map((l) => (l === '' ? '<br>' : `<div>${esc(l)}</div>`))
      .join('')}</div>`;
    for (const to of DESTINATARIOS) await enviarCorreo({ to, subject, text, html });
  } catch (err) {
    console.error('[alerta admin] no se pudo mandar:', err.message);
  }
}
