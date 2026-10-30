// Efemérides para la pantalla de marca del tap (pantallaRedireccion / pantallaApp
// en index.js): el espacio de NextTap cambia el día de una fecha patria o
// festiva, como el logo de Google. `efemerideDe(fecha)` devuelve
// { texto, ilus, capsula? } o null (día común → pantalla de siempre).
//
// El logo no se recolorea salvo que el color sea lo que representa la fecha:
// `capsula` pinta solo el bloque "Tap" — 'bandera' (celeste y blanco) o
// { bg, fg }. `ilus` es una clave de efemerides-ilus.js.
//
// Para agregar o cambiar una fecha: FIJAS (mes-día) o `moviles` (se calculan por año).

import { svgIlus } from './efemerides-ilus.js';

const BANDERA = 'bandera';

// 'MM-DD' → efeméride. Textos cortos: es una línea chica debajo de la ilustración.
const FIJAS = {
  '01-01': { texto: 'Feliz año nuevo', ilus: 'fuegos' },
  '02-14': { texto: 'Día de los Enamorados', ilus: 'corazon' },
  '03-08': { texto: 'Día Internacional de la Mujer', ilus: 'mujer' },
  '03-24': { texto: 'Día de la Memoria, por la Verdad y la Justicia' },
  '04-02': { texto: 'Día del Veterano y de los Caídos en Malvinas', ilus: 'sol', capsula: BANDERA },
  '05-01': { texto: 'Día del Trabajador', ilus: 'engranaje' },
  '05-25': { texto: '25 de Mayo · Revolución de Mayo', ilus: 'sol', capsula: BANDERA },
  '06-20': { texto: 'Día de la Bandera', ilus: 'sol', capsula: BANDERA },
  '07-09': { texto: '9 de Julio · Día de la Independencia', ilus: 'sol', capsula: BANDERA },
  '07-20': { texto: 'Día del Amigo', ilus: 'amigos' },
  '08-17': { texto: 'Paso a la Inmortalidad del General San Martín', ilus: 'sol', capsula: BANDERA },
  '09-11': { texto: 'Día del Maestro', ilus: 'manzana' },
  '09-21': { texto: 'Feliz Día de la Primavera', ilus: 'primavera' },
  '10-12': { texto: 'Día del Respeto a la Diversidad Cultural', ilus: 'mundo' },
  '10-31': { texto: 'Feliz Halloween', ilus: 'calabaza', capsula: { bg: '#FF8A1F', fg: '#14171A' } },
  '11-10': { texto: 'Día de la Tradición', ilus: 'mate' },
  '11-20': { texto: 'Día de la Soberanía Nacional', ilus: 'sol', capsula: BANDERA },
  '12-08': { texto: 'Día de la Inmaculada Concepción', ilus: 'estrella' },
  '12-24': { texto: 'Feliz Nochebuena', ilus: 'santa', capsula: { bg: '#E5484D', fg: '#fff' } },
  '12-25': { texto: 'Feliz Navidad', ilus: 'santa', capsula: { bg: '#E5484D', fg: '#fff' } },
  '12-31': { texto: 'Feliz año nuevo', ilus: 'fuegos' },
};

// Domingo de Pascua (algoritmo anónimo gregoriano) → { m, d } (m 1-12).
function pascua(anio) {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: mes, d: dia };
}

// n-ésimo día de semana (0=dom) de un mes (1-12) → número de día.
function enesimoDia(anio, mes, diaSemana, n) {
  const primero = new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay();
  return 1 + ((diaSemana - primero + 7) % 7) + (n - 1) * 7;
}

// Fecha (mes-día) a partir de un desplazamiento en días respecto de Pascua.
function desdePascua(anio, offset) {
  const p = pascua(anio);
  const f = new Date(Date.UTC(anio, p.m - 1, p.d + offset));
  return { m: f.getUTCMonth() + 1, d: f.getUTCDate() };
}

// Las que cambian de día cada año: devuelven la efeméride si `m`/`d` coinciden.
const moviles = [
  (y, m, d) => {
    const c1 = desdePascua(y, -48), c2 = desdePascua(y, -47);
    return [c1, c2].some((c) => c.m === m && c.d === d)
      ? { texto: 'Felices Carnavales', ilus: 'mascara' } : null;
  },
  (y, m, d) => {
    const v = desdePascua(y, -2);
    return v.m === m && v.d === d ? { texto: 'Viernes Santo', ilus: 'cruz' } : null;
  },
  (y, m, d) => {
    const p = desdePascua(y, 0);
    return p.m === m && p.d === d ? { texto: 'Felices Pascuas', ilus: 'huevo' } : null;
  },
  (y, m, d) => (m === 6 && d === enesimoDia(y, 6, 0, 3)
    ? { texto: 'Feliz Día del Padre', ilus: 'corbata' } : null),
  (y, m, d) => (m === 8 && d === enesimoDia(y, 8, 0, 3)
    ? { texto: 'Feliz Día de las Infancias', ilus: 'globos' } : null),
  (y, m, d) => (m === 10 && d === enesimoDia(y, 10, 0, 3)
    ? { texto: 'Feliz Día de la Madre', ilus: 'tulipan' } : null),
  (y, m, d) => (m === 11 && d === enesimoDia(y, 11, 5, 4)
    ? { texto: 'Black Friday', ilus: 'etiqueta' } : null),
];

// Fecha civil en Argentina (el servidor corre en UTC): las 21:00 del 24 no
// pueden mostrar ya el 25.
function fechaArgentina(ahora) {
  const [anio, mes, dia] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora).split('-').map(Number);
  return { anio, mes, dia };
}

export function efemerideDe(ahora = new Date()) {
  const { anio, mes, dia } = fechaArgentina(ahora);
  const clave = `${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  if (FIJAS[clave]) return FIJAS[clave];
  for (const f of moviles) {
    const e = f(anio, mes, dia);
    if (e) return e;
  }
  return null;
}

const esc = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Piezas para la pantalla de marca: `html` va arriba de "NextTap" (ilustración +
// línea de texto) y `css` se intercala al final del <style>. Con organización la
// pantalla es de su marca y no se toca; sin efeméride, todo vacío.
export function efemerideBloque(org, ahora = new Date()) {
  const e = org ? null : efemerideDe(ahora);
  if (!e) return { css: '', html: '' };
  let capsula = '';
  if (e.capsula === BANDERA) {
    // Celeste–blanco–celeste, como la bandera; el "Tap" queda en tinta oscura.
    capsula = `.mark .tap{background:linear-gradient(#74ACDF 0 32%,#fff 32% 68%,#74ACDF 68%);color:#14171A}`;
  } else if (e.capsula) {
    capsula = `.mark .tap{background:${e.capsula.bg};color:${e.capsula.fg}}`;
  }
  const svg = svgIlus(e.ilus);
  return {
    css: `
  ${capsula}
  .efe{display:flex;flex-direction:column;align-items:center;gap:10px;max-width:min(88vw,420px);text-align:center}
  .efe svg{width:min(26vw,104px,13svh);height:auto;overflow:visible;opacity:0;transform:scale(.6) rotate(-8deg);
    animation:pop .45s .05s cubic-bezier(.2,1.4,.4,1) forwards}
  .efe p{font-size:clamp(.82rem,3.6vw,1rem);font-weight:500;letter-spacing:.01em;opacity:0;animation:show .25s .15s forwards}
  @keyframes pop{to{opacity:1;transform:none}}`,
    html: `<div class="efe">${svg}<p>${esc(e.texto)}</p></div>`,
  };
}
