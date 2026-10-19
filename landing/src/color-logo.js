// Color de fondo de la pantalla del tap de una organización: el color
// mayoritario de su logo. Funciones puras (sin DOM) — las usan el editor de
// Mi panel (src/org-panel.js), la página de prueba y el server
// (server/index.js → orgBloque, para elegir texto claro u oscuro).

export const FONDO_MARCA = '#14171A'; // el negro de NextTap, si no hay color

const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');
const aHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

// Color mayoritario de una imagen, a partir de sus píxeles RGBA (el `data` de
// un getImageData; conviene achicarla antes a ~128×128). Agrupa colores
// parecidos (16 niveles por canal) y devuelve el promedio del grupo que más
// pesa. Cada píxel pesa según cuánto se aleja del blanco: casi todos los
// logos vienen sobre blanco, y ni ese blanco, ni los tintes pálidos de
// relleno, ni los bordes grises suavizados de las líneas son "el color del
// logo". Lo transparente y lo casi blanco no cuentan. null si no queda nada
// (logo todo blanco) → se usa FONDO_MARCA.
const DIST_MAX = Math.sqrt(3) * 255;
export function colorMayoritario(data) {
  const grupos = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    if (r > 235 && g > 235 && b > 235) continue;
    const peso = Math.hypot(255 - r, 255 - g, 255 - b) / DIST_MAX;
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const grupo = grupos.get(k) || { peso: 0, r: 0, g: 0, b: 0 };
    grupo.peso += peso;
    grupo.r += r * peso;
    grupo.g += g * peso;
    grupo.b += b * peso;
    grupos.set(k, grupo);
  }
  let mejor = null;
  for (const grupo of grupos.values()) if (!mejor || grupo.peso > mejor.peso) mejor = grupo;
  return mejor ? aHex(mejor.r / mejor.peso, mejor.g / mejor.peso, mejor.b / mejor.peso) : null;
}

// Luminancia relativa (WCAG) de '#rrggbb', 0 = negro, 1 = blanco.
export function luminancia(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// Colores de la pantalla para un fondo dado: texto oscuro sobre fondos claros,
// claro sobre oscuros (gana el de más contraste).
export function paletaPantalla(fondo) {
  const f = /^#[0-9a-f]{6}$/i.test(String(fondo)) ? String(fondo).toLowerCase() : FONDO_MARCA;
  const L = luminancia(f);
  const contrasteConOscuro = (L + 0.05) / (luminancia('#14171A') + 0.05);
  const contrasteConClaro = (luminancia('#EDEFE9') + 0.05) / (L + 0.05);
  const base =
    contrasteConOscuro > contrasteConClaro
      ? { fondo: f, texto: '#14171A', texto2: 'rgba(20,23,26,.72)', pista: 'rgba(20,23,26,.16)' }
      : { fondo: f, texto: '#EDEFE9', texto2: 'rgba(237,239,233,.72)', pista: 'rgba(237,239,233,.18)' };
  // El "Tap" violeta de la marca: si el fondo ya es parecido al violeta, se
  // perdería — ahí el recuadro pasa a ser del color del texto.
  const n = parseInt(f.slice(1), 16);
  const dist = Math.hypot(((n >> 16) & 255) - 0x7b, ((n >> 8) & 255) - 0x5c, (n & 255) - 0xff);
  return dist < 110
    ? { ...base, acento: base.texto, acentoTexto: f }
    : { ...base, acento: '#7B5CFF', acentoTexto: '#14171A' };
}
