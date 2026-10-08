// Sorteo vigente. Lo usan el front (src/sorteo.js, sorteo.html) y el server
// (server/sorteo.js), así las fechas y el premio están en un solo lugar.
// Para un sorteo nuevo: cambiar slug + fechas + premio. Las participaciones
// viejas quedan en la tabla bajo su slug.

export const SORTEO = {
  slug: 'disfraz-2026-10',
  instagram: 'nexttap.tech',
  premio: '2 llaveros NextTap personalizados: uno que abre su Instagram y otro que abre su WhatsApp',
  premioCorto: '2 llaveros NextTap para cada uno de los 2 ganadores (uno de Instagram y uno de WhatsApp)',
  ganadores: 2,
  // Domingo 11/10 23:59:59 hora argentina (UTC-3).
  cierre: '2026-10-12T02:59:59Z',
  cierreTexto: 'domingo 11 de octubre de 2026 a las 23:59 (hora argentina)',
  fechaSorteoTexto: 'lunes 12 de octubre de 2026',
  // Visitas con este utm_source abren el modal del sorteo solas.
  utmSource: 'disfraz',
};

export const sorteoAbierto = (ahora = Date.now()) => ahora <= Date.parse(SORTEO.cierre);
