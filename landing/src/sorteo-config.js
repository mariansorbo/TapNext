// Sorteo vigente. Lo usan el front (src/sorteo.js, sorteo.html) y el server
// (server/sorteo.js), así las fechas y el premio están en un solo lugar.
// Para un sorteo nuevo: cambiar slug + fechas + premio. Las participaciones
// viejas quedan en la tabla bajo su slug.

export const SORTEO = {
  slug: 'disfraz-2026-10',
  instagram: 'nexttap.tech',
  premio: 'un combo de 2 llaveros AlToque Tap personalizados: uno que abre su Instagram y otro que abre su WhatsApp',
  premioCorto: '2 combos de llaveros AlToque Tap Instagram + WhatsApp',
  ganadores: 2,
  // Se puede participar hasta el momento del sorteo: lunes 12/10 18:00 hora argentina (UTC-3).
  cierre: '2026-10-12T21:00:00Z',
  cierreTexto: 'lunes 12 de octubre de 2026 a las 18:00 (hora argentina)',
  fechaSorteoTexto: 'lunes 12 de octubre de 2026 a las 18:00 (hora argentina)',
  fechaCorta: 'lunes 12/10 a las 18 hs',
  // Visitas con este utm_source abren el modal del sorteo solas.
  utmSource: 'disfraz',
};

export const sorteoAbierto = (ahora = Date.now()) => ahora <= Date.parse(SORTEO.cierre);
