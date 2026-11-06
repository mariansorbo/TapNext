// Entrega propia: envío GRATIS en el que el dueño lleva el llavero en mano, para
// los códigos postales de las zonas de la tabla `envio_zonas_gratis` (CABA,
// Lanús, Avellaneda y Lomas de Zamora para empezar).
//
// Reglas del negocio (acordadas con el dueño):
//   - Plazo: hasta 7 días hábiles desde que se acredita el pago.
//   - UN SOLO intento de entrega. Si no hay nadie, el llavero queda 30 días en
//     depósito y el comprador lo recibe por Correo Argentino pagando el envío.
//   - El comprador lo acepta, con una casilla obligatoria, ANTES de pagar. La
//     aceptación queda en venta_envios.acepta_reenvio_* (fecha + versión del texto).
//
// Este módulo sólo tiene la parte de checkout/venta: detectar la zona y calcular
// la fecha límite. La coordinación, el "no estaba" y el reenvío vienen después.

import { db } from './db.js';

export const PLAZO_DIAS_HABILES = 7;
export const DIAS_DEPOSITO = 30;

// Subir cuando cambie el texto de la casilla / la cláusula de los TyC.
export const REENVIO_TEXTO_VERSION = '1 (2026-11-06)';

/**
 * ¿Ese (provincia, CP) cae en una zona de envío gratis? Devuelve el nombre de
 * la zona, o null. El CP son los 4 dígitos; la provincia, el id de Enviopack.
 */
export async function zonaGratisDe(provincia, cp) {
  const n = Number(String(cp || '').trim());
  if (!/^\d{4}$/.test(String(cp || '').trim()) || !Number.isFinite(n)) return null;
  const { rows } = await db.execute({
    sql: `SELECT zona FROM envio_zonas_gratis
           WHERE activo AND provincia = ? AND ? BETWEEN cp_desde AND cp_hasta
           LIMIT 1`,
    args: [String(provincia || ''), n],
  });
  return rows[0]?.zona || null;
}

/**
 * Nombres de las zonas con envío gratis activas, sin repetir y en el orden en
 * que se cargaron (para el cartel del wizard: "CABA, Lanús, ...").
 */
export async function zonasGratisActivas() {
  const { rows } = await db.execute(
    `SELECT zona FROM envio_zonas_gratis WHERE activo GROUP BY zona ORDER BY MIN(id)`
  );
  return rows.map((r) => r.zona);
}

// --- Fechas (todas como 'YYYY-MM-DD', en hora de Argentina) ---
// El servidor corre en UTC; trabajar con Date locales corre el día después de
// las 21 hs. Por eso todo el cálculo es sobre strings ISO y getUTC*.

/** Hoy en Argentina, 'YYYY-MM-DD'. */
export function hoyAR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

function sumarDias(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const esHabil = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow !== 0 && dow !== 6;
};

/**
 * Fecha límite: `dias` días hábiles después de `desde` (default: hoy).
 * Sólo salta sábados y domingos; los feriados no se descuentan todavía (el
 * plazo real nunca queda más corto de lo prometido).
 */
export function sumarDiasHabiles(desde = hoyAR(), dias = PLAZO_DIAS_HABILES) {
  let actual = desde;
  let restantes = dias;
  while (restantes > 0) {
    actual = sumarDias(actual, 1);
    if (esHabil(actual)) restantes -= 1;
  }
  return actual;
}

/** Franjas horarias que el comprador puede elegir para la visita. */
export const FRANJAS = [
  { id: 'manana', label: 'Mañana (9 a 13 hs)' },
  { id: 'tarde', label: 'Tarde (13 a 18 hs)' },
  { id: 'noche', label: 'Noche (18 a 21 hs)' },
];
export const esFranjaValida = (id) => FRANJAS.some((f) => f.id === id);

/**
 * Días en que se puede coordinar la entrega: hábiles, desde mañana hasta la
 * fecha límite inclusive. Devuelve strings 'YYYY-MM-DD'.
 */
export function diasDisponibles(fechaLimite, desde = hoyAR()) {
  const dias = [];
  if (!fechaLimite) return dias;
  for (let d = sumarDias(desde, 1); d <= fechaLimite; d = sumarDias(d, 1)) {
    if (esHabil(d)) dias.push(d);
  }
  return dias;
}
