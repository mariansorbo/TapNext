// Ilustraciones de las efemérides (ver efemerides.js): SVG en línea, 64×64, sin
// pedidos extra — la pantalla del tap es un solo request de ~1 s. Se usan SVG y
// no emoji porque Windows no dibuja las banderas (muestra "AR").

const VIOLETA = '#7B5CFF';
const SOL = '#F6B40E';

// n rayos desde el centro (32,32), entre los radios r1 y r2.
function rayos(n, r1, r2, color, ancho) {
  let l = '';
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n;
    l += `<line x1="32" y1="${32 - r2}" x2="32" y2="${32 - r1}" transform="rotate(${a} 32 32)"/>`;
  }
  return `<g stroke="${color}" stroke-width="${ancho}" stroke-linecap="round">${l}</g>`;
}

// Estrella de 5 puntas centrada en (cx,cy) de radio r.
function estrella(cx, cy, r, color) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${color}"/>`;
}

const CORAZON = 'M32 56C10 40 6 28 6 20A13 13 0 0 1 32 16A13 13 0 0 1 58 20C58 28 54 40 32 56Z';

function flor(petalos, centro) {
  let p = '';
  for (let i = 0; i < 5; i++) {
    p += `<circle cx="32" cy="14" r="9" transform="rotate(${i * 72} 32 26)" fill="${petalos}"/>`;
  }
  return `<path d="M32 36V60" stroke="#4C8A3A" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="42" cy="50" rx="8" ry="4" transform="rotate(-30 42 50)" fill="#4C8A3A"/>${p}<circle cx="32" cy="26" r="6" fill="${centro}"/>`;
}

export const ILUS = {
  // Sol de Mayo: el de la bandera, con cara.
  sol: `${rayos(16, 19, 28, SOL, 3)}<circle cx="32" cy="32" r="14" fill="${SOL}"/>
<circle cx="27" cy="29" r="1.8" fill="#8A5A00"/><circle cx="37" cy="29" r="1.8" fill="#8A5A00"/>
<path d="M26 36Q32 41 38 36" stroke="#8A5A00" stroke-width="2" fill="none" stroke-linecap="round"/>`,

  corazon: `<path d="${CORAZON}" fill="${VIOLETA}"/>
<path d="M14 22Q15 16 22 16" stroke="#fff" stroke-opacity=".5" stroke-width="3" fill="none" stroke-linecap="round"/>`,

  // Símbolo de la mujer (♀) con un corazón violeta adentro.
  mujer: `<circle cx="32" cy="24" r="15" stroke="${VIOLETA}" stroke-width="5" fill="none"/>
<path d="M32 39V59M22 49H42" stroke="${VIOLETA}" stroke-width="5" stroke-linecap="round"/>
<path d="${CORAZON}" fill="${VIOLETA}" transform="translate(32 24) scale(.2) translate(-32 -34)"/>`,

  santa: `<ellipse cx="32" cy="44" rx="15" ry="14" fill="#F6C9A6"/>
<path d="M14 30Q16 6 40 8Q47 8 50 14Q51 24 50 30Z" fill="#E5484D"/>
<circle cx="50" cy="13" r="5.5" fill="#fff"/>
<rect x="10" y="26" width="44" height="10" rx="5" fill="#fff"/>
<path d="M17 44Q15 63 32 63Q49 63 47 44Q40 52 32 50Q24 52 17 44Z" fill="#fff"/>
<ellipse cx="25.5" cy="48" rx="7" ry="4" fill="#fff"/><ellipse cx="38.5" cy="48" rx="7" ry="4" fill="#fff"/>
<circle cx="32" cy="44" r="3.2" fill="#F0A58A"/>
<circle cx="25.5" cy="40" r="1.7" fill="#14171A"/><circle cx="38.5" cy="40" r="1.7" fill="#14171A"/>`,

  calabaza: `<rect x="29" y="9" width="6" height="12" rx="3" fill="#4C8A3A"/>
<ellipse cx="32" cy="38" rx="25" ry="20" fill="#FF8A1F"/>
<path d="M32 18Q22 38 32 58M32 18Q42 38 32 58" stroke="#D96A00" stroke-width="2.5" fill="none"/>
<path d="M19 36L27 36L23 28ZM37 36L45 36L41 28Z" fill="#14171A"/>
<path d="M19 44L24 48L28 44L32 48L36 44L40 48L45 44Q44 52 32 54Q20 52 19 44Z" fill="#14171A"/>`,

  fuegos: `<g transform="translate(-12 -10)">${rayos(10, 6, 16, SOL, 3)}</g>
<g transform="translate(14 -8)">${rayos(10, 5, 13, '#FF4FA3', 3)}</g>
<g transform="translate(0 16)">${rayos(8, 4, 11, '#74ACDF', 3)}</g>`,

  huevo: `<clipPath id="egg"><path d="M32 6C46 6 54 30 54 40A22 22 0 0 1 10 40C10 30 18 6 32 6Z"/></clipPath>
<path d="M32 6C46 6 54 30 54 40A22 22 0 0 1 10 40C10 30 18 6 32 6Z" fill="#FF8FB8"/>
<g clip-path="url(#egg)"><path d="M6 38L16 30L26 38L36 30L46 38L56 30" stroke="#fff" stroke-width="5" fill="none"/>
<circle cx="22" cy="50" r="3" fill="#fff"/><circle cx="40" cy="50" r="3" fill="#fff"/></g>`,

  mascara: `<path d="M6 26Q32 10 58 26Q58 46 45 48Q38 48 32 41Q26 48 19 48Q6 46 6 26Z" fill="#FF4FA3"/>
<ellipse cx="21" cy="31" rx="8" ry="4.5" fill="#14171A"/><ellipse cx="43" cy="31" rx="8" ry="4.5" fill="#14171A"/>
<circle cx="12" cy="14" r="4" fill="${SOL}"/><circle cx="32" cy="9" r="4" fill="#74ACDF"/><circle cx="52" cy="14" r="4" fill="${SOL}"/>`,

  corbata: `<path d="M26 8H38L36 17L41 46L32 58L23 46L28 17Z" fill="#74ACDF"/>
<path d="M27 8H37L36 17H28Z" fill="#4F86BD"/>
<path d="M30 30L38 24M29 38L39 32" stroke="#fff" stroke-opacity=".6" stroke-width="3"/>`,

  tulipan: flor('#FF8FB8', SOL),
  primavera: flor('#FFD84D', '#E5484D'),

  globos: `<path d="M44 46Q40 54 46 62" stroke="#EDEFE9" stroke-opacity=".6" stroke-width="1.5" fill="none"/>
<path d="M22 44Q26 54 20 62" stroke="#EDEFE9" stroke-opacity=".6" stroke-width="1.5" fill="none"/>
<ellipse cx="44" cy="28" rx="13" ry="17" fill="#74ACDF"/><path d="M44 45L41 49H47Z" fill="#74ACDF"/>
<ellipse cx="21" cy="26" rx="13" ry="17" fill="#E5484D"/><path d="M21 43L18 47H24Z" fill="#E5484D"/>
<ellipse cx="16" cy="19" rx="3" ry="5" fill="#fff" fill-opacity=".35" transform="rotate(20 16 19)"/>`,

  amigos: `<circle cx="24" cy="32" r="17" fill="${SOL}"/><circle cx="42" cy="32" r="17" fill="#74ACDF" fill-opacity=".9"/>
<circle cx="19" cy="28" r="1.8" fill="#14171A"/><circle cx="29" cy="28" r="1.8" fill="#14171A"/>
<circle cx="37" cy="28" r="1.8" fill="#14171A"/><circle cx="47" cy="28" r="1.8" fill="#14171A"/>
<path d="M18 37Q24 43 30 37M36 37Q42 43 48 37" stroke="#14171A" stroke-width="2" fill="none" stroke-linecap="round"/>`,

  engranaje: `${rayos(8, 18, 26, '#EDEFE9', 7)}<circle cx="32" cy="32" r="19" fill="#EDEFE9"/><circle cx="32" cy="32" r="8" fill="#14171A"/>`,

  manzana: `<circle cx="24" cy="38" r="17" fill="#E5484D"/><circle cx="40" cy="38" r="17" fill="#E5484D"/>
<path d="M32 22Q31 14 36 8" stroke="#6B4A2B" stroke-width="3" fill="none" stroke-linecap="round"/>
<ellipse cx="42" cy="13" rx="8" ry="4" transform="rotate(-25 42 13)" fill="#4C8A3A"/>
<ellipse cx="19" cy="32" rx="3" ry="5" fill="#fff" fill-opacity=".3" transform="rotate(25 19 32)"/>`,

  mate: `<path d="M38 22L51 6" stroke="#C9CED3" stroke-width="3" stroke-linecap="round"/><circle cx="52" cy="5" r="3" fill="#C9CED3"/>
<path d="M14 24H50Q52 52 32 59Q12 52 14 24Z" fill="#8A5A2B"/>
<ellipse cx="32" cy="24" rx="18" ry="6" fill="#4C8A3A"/>
<path d="M17 38H47" stroke="#6B4A2B" stroke-width="2" opacity=".6"/>`,

  etiqueta: `<path d="M8 10H32L58 36L36 58L8 32Z" fill="#EDEFE9"/><circle cx="19" cy="21" r="4" fill="#14171A"/>
<text x="36" y="40" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="20" fill="#14171A" transform="rotate(45 36 36)">%</text>`,

  cruz: `<rect x="27" y="6" width="10" height="52" rx="2" fill="#EDEFE9"/><rect x="12" y="20" width="40" height="10" rx="2" fill="#EDEFE9"/>`,

  estrella: `<circle cx="32" cy="32" r="28" fill="${SOL}" fill-opacity=".18"/>
<path d="M32 6L39 25H59L43 37L49 57L32 45L15 57L21 37L5 25H25Z" fill="${SOL}"/>`,

  bombero: `<rect x="29" y="6" width="6" height="10" rx="3" fill="#E5484D"/>
<path d="M10 42Q10 14 32 14Q54 14 54 42Z" fill="#E5484D"/>
<rect x="5" y="41" width="54" height="8" rx="4" fill="#B93338"/>
<path d="M25 21H39L37 33L32 37L27 33Z" fill="${SOL}"/>`,

  valija: `<path d="M24 24V17Q24 13 28 13H36Q40 13 40 17V24" stroke="#6B4A2B" stroke-width="4" fill="none" stroke-linecap="round"/>
<rect x="10" y="24" width="44" height="32" rx="6" fill="#8A5A2B"/>
<rect x="10" y="36" width="44" height="4" fill="#6B4A2B"/><rect x="28" y="33" width="8" height="10" rx="2" fill="${SOL}"/>`,

  huella: `<ellipse cx="32" cy="43" rx="14" ry="11" fill="#EDEFE9"/>
<ellipse cx="14" cy="30" rx="5" ry="7" transform="rotate(-20 14 30)" fill="#EDEFE9"/>
<ellipse cx="25" cy="18" rx="5" ry="7.5" transform="rotate(-6 25 18)" fill="#EDEFE9"/>
<ellipse cx="39" cy="18" rx="5" ry="7.5" transform="rotate(6 39 18)" fill="#EDEFE9"/>
<ellipse cx="50" cy="30" rx="5" ry="7" transform="rotate(20 50 30)" fill="#EDEFE9"/>`,

  frasco: `<rect x="14" y="14" width="36" height="10" rx="3" fill="#EDEFE9"/>
<rect x="12" y="22" width="40" height="36" rx="9" fill="#B5651D"/>
<rect x="19" y="32" width="26" height="16" rx="3" fill="#F6E3B4"/>
<path d="M24 40H40" stroke="#B5651D" stroke-width="3" stroke-linecap="round"/>
<path d="M18 28V50" stroke="#fff" stroke-opacity=".25" stroke-width="3" stroke-linecap="round"/>`,

  // Cinta verde: el símbolo de la salud mental.
  cinta: `<path d="M32 8C12 20 22 36 32 38C42 36 52 20 32 8Z" stroke="#7BD389" stroke-width="6" fill="none" stroke-linejoin="round"/>
<path d="M32 38L22 58M32 38L42 58" stroke="#7BD389" stroke-width="6" stroke-linecap="round"/>`,

  nota: `<path d="M27 46V15L53 9V40" stroke="${VIOLETA}" stroke-width="4" fill="none" stroke-linejoin="round"/>
<path d="M27 15L53 9V19L27 25Z" fill="${VIOLETA}"/>
<ellipse cx="20" cy="47" rx="9" ry="7" transform="rotate(-20 20 47)" fill="${VIOLETA}"/>
<ellipse cx="46" cy="41" rx="9" ry="7" transform="rotate(-20 46 41)" fill="${VIOLETA}"/>`,

  paloma: `<path d="M8 38Q20 26 36 30Q44 20 54 22Q50 30 52 37Q44 52 26 50Q14 48 8 38Z" fill="#EDEFE9"/>
<path d="M24 35Q28 12 46 8Q42 24 38 35Z" fill="#fff" stroke="#C9CED3" stroke-width="1.5"/>
<circle cx="47" cy="27" r="1.6" fill="#14171A"/><path d="M54 22L60 25L54 27Z" fill="${SOL}"/>
<path d="M52 36Q58 46 54 58" stroke="#4C8A3A" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<ellipse cx="55" cy="45" rx="4" ry="2" transform="rotate(-50 55 45)" fill="#4C8A3A"/>`,

  codigo: `<path d="M22 16L7 32L22 48M42 16L57 32L42 48" stroke="${VIOLETA}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M37 12L27 52" stroke="#EDEFE9" stroke-width="5" stroke-linecap="round"/>`,

  // Figura sentada en meditación, con aura.
  meditacion: `<circle cx="32" cy="34" r="28" stroke="${SOL}" stroke-opacity=".5" stroke-width="2" fill="none"/>
<circle cx="32" cy="17" r="7" fill="${VIOLETA}"/>
<path d="M20 44Q21 26 32 25Q43 26 44 44Z" fill="${VIOLETA}"/>
<ellipse cx="32" cy="46" rx="22" ry="8" fill="${VIOLETA}"/>
<ellipse cx="32" cy="46" rx="22" ry="8" fill="none" stroke="#14171A" stroke-opacity=".35" stroke-width="1.5"/>`,

  escarapela: `<path d="M24 40L16 60L26 55L30 62L34 42Z" fill="#74ACDF"/><path d="M40 40L48 60L38 55L34 62L30 42Z" fill="#fff"/>
<circle cx="32" cy="28" r="24" fill="#74ACDF"/><circle cx="32" cy="28" r="16.5" fill="#fff"/><circle cx="32" cy="28" r="8" fill="#74ACDF"/>`,

  sombrero: `<ellipse cx="32" cy="42" rx="29" ry="9" fill="#2B2F33"/>
<path d="M16 42Q14 14 32 14Q50 14 48 42Q32 48 16 42Z" fill="#3A3F44"/>
<path d="M16.5 36Q32 42 47.5 36L48 42Q32 48 16 42Z" fill="#E5484D"/>
<path d="M22 20Q32 15 42 20" stroke="#fff" stroke-opacity=".2" stroke-width="2" fill="none"/>`,

  pachamama: `<circle cx="32" cy="30" r="14" fill="${SOL}"/>${rayos(12, 19, 25, SOL, 3)}
<path d="M2 58L20 30L30 44L42 24L62 58Z" fill="#8A5A2B"/>
<path d="M42 24L48 34L44 32L40 36L36 32Z" fill="#fff"/><path d="M20 30L25 38L21 36L17 39Z" fill="#fff"/>
<path d="M2 58H62V62H2Z" fill="#4C8A3A"/>`,

  // Manto celeste y blanco con aureola, sobrio.
  virgen: `<circle cx="32" cy="22" r="13" stroke="${SOL}" stroke-width="3" fill="none"/>
${rayos(16, 16, 24, SOL, 2).replace('stroke-width="2"', 'stroke-width="2" stroke-opacity=".6"')}
<path d="M32 12C22 12 18 26 13 58H51C46 26 42 12 32 12Z" fill="#74ACDF"/>
<path d="M32 18C27 18 25 28 22 58H42C39 28 37 18 32 18Z" fill="#fff"/>
<circle cx="32" cy="24" r="5" fill="#F6C9A6"/>`,

  // Tres estrellas: la de arriba, la tercera, más grande.
  estrellas: `${estrella(32, 18, 17, SOL)}${estrella(16, 48, 12, SOL)}${estrella(48, 48, 12, SOL)}`,

  mundo: `<circle cx="32" cy="32" r="24" stroke="#74ACDF" stroke-width="3.5" fill="none"/>
<ellipse cx="32" cy="32" rx="10" ry="24" stroke="#74ACDF" stroke-width="3" fill="none"/>
<path d="M8 32H56M12 20H52M12 44H52" stroke="#74ACDF" stroke-width="3"/>`,
};

export function svgIlus(nombre) {
  const cuerpo = ILUS[nombre];
  return cuerpo ? `<svg viewBox="0 0 64 64" aria-hidden="true">${cuerpo}</svg>` : '';
}
