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

  // Pascuas: la tumba vacía con la piedra corrida y el amanecer.
  resurreccion: `${rayos(16, 22, 30, SOL, 2.5)}
<path d="M4 60Q32 46 60 60V64H4Z" fill="#4C8A3A"/>
<path d="M14 60V40Q14 24 29 24Q44 24 44 40V60Z" fill="#8A8F94"/>
<path d="M20 60V42Q20 31 29 31Q38 31 38 42V60Z" fill="#14171A"/>
<circle cx="51" cy="53" r="9" fill="#B7BCC1"/><path d="M45 50Q51 46 56 50" stroke="#fff" stroke-opacity=".4" stroke-width="2" fill="none"/>
<path d="M8 28V50M3 34H13" stroke="#EDEFE9" stroke-width="3.5" stroke-linecap="round"/>`,

  // Trabajador: una pala clavada, con un montoncito de tierra.
  pala: `<ellipse cx="44" cy="58" rx="14" ry="4.5" fill="#6B4A2B"/>
<g transform="rotate(30 32 32)"><rect x="30" y="8" width="4.5" height="32" rx="2" fill="#B5844C"/>
<path d="M24 11Q24 4 32 4Q40 4 40 11" stroke="#B5844C" stroke-width="3.5" fill="none" stroke-linecap="round"/>
<path d="M23 38H41L43 52Q32 64 21 52Z" fill="#C9CED3"/><path d="M27 40L26 52" stroke="#fff" stroke-opacity=".5" stroke-width="2"/></g>`,

  // Flor de loto sobre el agua: símbolo budista, sin figura.
  loto: `<ellipse cx="32" cy="54" rx="27" ry="5" stroke="#74ACDF" stroke-width="2" fill="none"/>
<ellipse cx="32" cy="34" rx="7" ry="19" transform="rotate(-62 32 52)" fill="#B79CFF"/>
<ellipse cx="32" cy="34" rx="7" ry="19" transform="rotate(62 32 52)" fill="#B79CFF"/>
<ellipse cx="32" cy="34" rx="7" ry="20" transform="rotate(-32 32 52)" fill="#9C7DFF"/>
<ellipse cx="32" cy="34" rx="7" ry="20" transform="rotate(32 32 52)" fill="#9C7DFF"/>
<ellipse cx="32" cy="32" rx="7.5" ry="21" fill="${VIOLETA}"/>
<circle cx="32" cy="50" r="3" fill="${SOL}"/>`,

  // Teclado de piano visto de arriba.
  piano: `<rect x="4" y="14" width="56" height="38" rx="4" fill="#2B2F33"/>
<rect x="7" y="22" width="50" height="27" rx="2" fill="#fff"/>
<path d="M17.5 22V49M28 22V49M38.5 22V49M49 22V49" stroke="#C9CED3" stroke-width="1"/>
<g fill="#14171A"><rect x="14" y="22" width="7" height="16" rx="1"/><rect x="25" y="22" width="7" height="16" rx="1"/><rect x="35" y="22" width="7" height="16" rx="1"/><rect x="45.5" y="22" width="7" height="16" rx="1"/></g>
<rect x="9" y="17" width="46" height="3" rx="1.5" fill="${VIOLETA}"/>`,

  // Dos hermanos de la mano.
  hermanos: `<circle cx="22" cy="16" r="8" fill="#F6C9A6"/><path d="M12 56V34Q12 26 22 26Q32 26 32 34V56Z" fill="#74ACDF"/>
<circle cx="44" cy="22" r="7" fill="#D9A066"/><path d="M35 56V38Q35 31 44 31Q53 31 53 38V56Z" fill="#E5484D"/>
<path d="M31 40L36 42" stroke="#F6C9A6" stroke-width="3.5" stroke-linecap="round"/>`,

  // Anteojos redondos y un corazón: los abuelos.
  abuelos: `<circle cx="19" cy="24" r="12" stroke="#EDEFE9" stroke-width="3.5" fill="none"/><circle cx="45" cy="24" r="12" stroke="#EDEFE9" stroke-width="3.5" fill="none"/>
<path d="M31 22Q32 19 33 22" stroke="#EDEFE9" stroke-width="3" fill="none"/><path d="M7 22L2 18M57 22L62 18" stroke="#EDEFE9" stroke-width="3" stroke-linecap="round"/>
<path d="${CORAZON}" fill="${VIOLETA}" transform="translate(32 49) scale(.3) translate(-32 -34)"/>`,

  gota: `<path d="M32 5C32 5 13 28 13 40A19 19 0 0 0 51 40C51 28 32 5 32 5Z" fill="#74ACDF"/>
<path d="M22 40Q22 49 29 53" stroke="#fff" stroke-opacity=".55" stroke-width="3.5" fill="none" stroke-linecap="round"/>
<ellipse cx="32" cy="60" rx="14" ry="2.5" stroke="#74ACDF" stroke-width="1.5" fill="none"/>`,

  tierra: `<circle cx="32" cy="32" r="26" fill="#3B82C4"/>
<path d="M14 22Q22 12 32 16Q34 22 28 26Q24 34 18 32Q12 30 14 22Z" fill="#5FB36A"/>
<path d="M36 30Q46 26 50 34Q48 46 40 50Q34 44 36 30Z" fill="#5FB36A"/>
<path d="M18 44Q24 42 26 48Q22 54 16 50Z" fill="#5FB36A"/>
<ellipse cx="22" cy="18" rx="6" ry="3" transform="rotate(-30 22 18)" fill="#fff" fill-opacity=".25"/>`,

  familia: `<path d="M6 32L32 8L58 32Z" fill="#E5484D"/>
<rect x="12" y="32" width="40" height="26" fill="#F6E3B4"/>
<rect x="38" y="42" width="9" height="16" rx="1" fill="#8A5A2B"/>
<path d="${CORAZON}" fill="${VIOLETA}" transform="translate(25 44) scale(.3) translate(-32 -34)"/>`,

  pizarron: `<rect x="5" y="10" width="54" height="38" rx="3" fill="#8A5A2B"/>
<rect x="9" y="14" width="46" height="30" rx="1.5" fill="#2F5D4A"/>
<text x="32" y="36" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="16" fill="#fff" fill-opacity=".9">A B C</text>
<rect x="12" y="49" width="40" height="4" rx="1" fill="#6B4A2B"/><rect x="40" y="46" width="8" height="3" rx="1.5" fill="#fff"/>`,

  espiga: `<path d="M32 62V24" stroke="#C9A227" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="25" cy="44" rx="4" ry="8" transform="rotate(-30 25 44)" fill="#F6B40E"/><ellipse cx="39" cy="44" rx="4" ry="8" transform="rotate(30 39 44)" fill="#F6B40E"/>
<ellipse cx="25" cy="32" rx="4" ry="8" transform="rotate(-30 25 32)" fill="#F6B40E"/><ellipse cx="39" cy="32" rx="4" ry="8" transform="rotate(30 39 32)" fill="#F6B40E"/>
<ellipse cx="26" cy="20" rx="3.6" ry="7" transform="rotate(-25 26 20)" fill="#F6B40E"/><ellipse cx="38" cy="20" rx="3.6" ry="7" transform="rotate(25 38 20)" fill="#F6B40E"/>
<ellipse cx="32" cy="12" rx="3.6" ry="8" fill="#F6B40E"/>`,

  // Lazo rojo: el símbolo de la lucha contra el VIH/SIDA.
  lazorojo: `<path d="M32 8C12 20 22 36 32 38C42 36 52 20 32 8Z" stroke="#E5484D" stroke-width="6" fill="none" stroke-linejoin="round"/>
<path d="M32 38L22 58M32 38L42 58" stroke="#E5484D" stroke-width="6" stroke-linecap="round"/>`,

  // Símbolo de accesibilidad (persona en silla de ruedas) en un círculo.
  accesible: `<circle cx="32" cy="32" r="28" fill="#74ACDF"/>
<circle cx="30" cy="13" r="4.5" fill="#fff"/>
<path d="M30 20V35H44L48 48M30 27H42" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M24 30A13 13 0 1 0 40 51" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>`,

  cohete: `<path d="M32 4Q44 16 44 36V46H20V36Q20 16 32 4Z" fill="#EDEFE9"/>
<path d="M32 4Q38 9 41 17H23Q26 9 32 4Z" fill="#E5484D"/>
<circle cx="32" cy="29" r="5.5" fill="#74ACDF" stroke="#C9CED3" stroke-width="2"/>
<path d="M20 36L10 50L20 46ZM44 36L54 50L44 46Z" fill="${VIOLETA}"/>
<path d="M25 46Q32 62 39 46Z" fill="#FF8A1F"/><path d="M28.5 46Q32 56 35.5 46Z" fill="${SOL}"/>`,

  // Letra psi (Ψ), el símbolo de la psicología.
  psi: `<circle cx="32" cy="32" r="28" fill="${VIOLETA}"/>
<path d="M32 12V52M17 16V28Q17 41 32 41Q47 41 47 28V16" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,

  perro: `<path d="M15 20Q7 30 11 48Q22 47 21 28Z" fill="#7A4A2B"/><path d="M49 20Q57 30 53 48Q42 47 43 28Z" fill="#7A4A2B"/>
<ellipse cx="32" cy="34" rx="17" ry="16" fill="#C98E4B"/>
<ellipse cx="32" cy="43" rx="10" ry="8" fill="#F1E2C8"/>
<ellipse cx="32" cy="38" rx="4.5" ry="3.2" fill="#14171A"/>
<circle cx="24.5" cy="29" r="2.2" fill="#14171A"/><circle cx="39.5" cy="29" r="2.2" fill="#14171A"/>
<path d="M32 41V45M27 45Q32 49 37 45" stroke="#14171A" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<path d="M29 47Q32 56 35 47Z" fill="#FF8FB8"/>`,

  gato: `<path d="M15 30L12 8L29 19Z" fill="#F4A24A"/><path d="M49 30L52 8L35 19Z" fill="#F4A24A"/>
<path d="M17 26L16 14L25 20Z" fill="#FF8FB8"/><path d="M47 26L48 14L39 20Z" fill="#FF8FB8"/>
<circle cx="32" cy="37" r="19" fill="#F4A24A"/>
<path d="M32 18V26M24 20L26 27M40 20L38 27" stroke="#D9822B" stroke-width="2.5" stroke-linecap="round"/>
<ellipse cx="24.5" cy="36" rx="3.6" ry="4.4" fill="#8BD17C"/><ellipse cx="39.5" cy="36" rx="3.6" ry="4.4" fill="#8BD17C"/>
<ellipse cx="24.5" cy="36" rx="1.2" ry="3.6" fill="#14171A"/><ellipse cx="39.5" cy="36" rx="1.2" ry="3.6" fill="#14171A"/>
<path d="M29.5 43H34.5L32 46Z" fill="#E86B8F"/><path d="M32 46Q29 50 26 48M32 46Q35 50 38 48" stroke="#14171A" stroke-width="1.5" fill="none" stroke-linecap="round"/>
<path d="M18 44L6 41M18 47L6 49M46 44L58 41M46 47L58 49" stroke="#fff" stroke-opacity=".8" stroke-width="1.3" stroke-linecap="round"/>`,

  // Guitarra eléctrica en diagonal.
  guitarra: `<path d="M31 33L55 9" stroke="#8A5A2B" stroke-width="5" stroke-linecap="round"/>
<path d="M52 12L60 4" stroke="#2B2F33" stroke-width="7" stroke-linecap="round"/>
<path d="M10 46Q8 34 20 32Q26 26 33 32Q42 34 40 46Q38 60 24 60Q12 58 10 46Z" fill="#E5484D"/>
<path d="M20 38L31 43M18 46L30 51" stroke="#2B2F33" stroke-width="3.5" stroke-linecap="round"/>
<path d="M33 31L56 9" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/>
<circle cx="19" cy="55" r="1.8" fill="#C9CED3"/>`,

  mundo: `<circle cx="32" cy="32" r="24" stroke="#74ACDF" stroke-width="3.5" fill="none"/>
<ellipse cx="32" cy="32" rx="10" ry="24" stroke="#74ACDF" stroke-width="3" fill="none"/>
<path d="M8 32H56M12 20H52M12 44H52" stroke="#74ACDF" stroke-width="3"/>`,
};

// Ilustraciones apaisadas (viewBox propio): el svg lleva class="ancha".
const PIEL = '#F6C9A6';
function persona(cx, color, ancho = 8) {
  return `<path d="M${cx - ancho} 84L${cx - ancho + 3} 50H${cx + ancho - 3}L${cx + ancho} 84Z" fill="${color}"/>`;
}
function rey(cx, manto, piel, regalo) {
  return `${persona(cx, manto)}<circle cx="${cx}" cy="44" r="5" fill="${piel}"/>
<path d="M${cx - 5} 40V33L${cx - 2.5} 37L${cx} 32L${cx + 2.5} 37L${cx + 5} 33V40Z" fill="${SOL}"/>
<path d="M${cx + 4} 57L${cx + 11} 55" stroke="${manto}" stroke-width="3.5" stroke-linecap="round"/>
<rect x="${cx + 9}" y="49" width="8" height="8" rx="1.5" fill="${regalo}" stroke="#fff" stroke-opacity=".5"/>`;
}
const SANTA_X = 92, CUNA_X = 128;

// Figuras del nacimiento (coordenadas propias, suelo en y=84): se las baja y
// corre dentro de la escena con un translate.
const FIGURAS = `<circle cx="${CUNA_X}" cy="68" r="26" fill="url(#pnLuz)"/>
<circle cx="${SANTA_X - 13}" cy="68" r="9" fill="#8A5A2B"/><path d="M${SANTA_X - 17} 61L${SANTA_X - 13} 58L${SANTA_X - 9} 61Z" fill="#6B4A2B"/>
${rey(18, '#7B5CFF', PIEL, '#F6B40E')}${rey(40, '#2F9E7B', '#D9A066', '#E5B80B')}${rey(62, '#E5484D', '#7A4B2A', '#B5651D')}
${persona(SANTA_X, '#E5484D', 11)}
<rect x="${SANTA_X - 10}" y="66" width="20" height="4" fill="#14171A"/><rect x="${SANTA_X - 2}" y="65.5" width="4" height="5" fill="${SOL}"/>
<rect x="${SANTA_X - 11}" y="80" width="22" height="4" fill="#fff"/>
<rect x="${SANTA_X - 8}" y="83" width="6" height="3" rx="1" fill="#14171A"/><rect x="${SANTA_X + 2}" y="83" width="6" height="3" rx="1" fill="#14171A"/>
<path d="M${SANTA_X + 8} 56L${SANTA_X + 21} 63" stroke="#E5484D" stroke-width="4.5" stroke-linecap="round"/>
<circle cx="${SANTA_X + 22}" cy="64" r="2.8" fill="${PIEL}"/>
<circle cx="${SANTA_X}" cy="43" r="6.5" fill="${PIEL}"/>
<path d="M${SANTA_X - 6.5} 43Q${SANTA_X - 7} 57 ${SANTA_X} 57Q${SANTA_X + 7} 57 ${SANTA_X + 6.5} 43Q${SANTA_X} 49 ${SANTA_X - 6.5} 43Z" fill="#fff"/>
<path d="M${SANTA_X - 6.5} 40Q${SANTA_X - 6} 27 ${SANTA_X + 9} 31L${SANTA_X + 6.5} 40Z" fill="#E5484D"/>
<rect x="${SANTA_X - 7.5}" y="38" width="15" height="4" rx="2" fill="#fff"/><circle cx="${SANTA_X + 10}" cy="31" r="2.8" fill="#fff"/>
<circle cx="${SANTA_X + 2}" cy="43" r="0.9" fill="#14171A"/><circle cx="${SANTA_X - 2.5}" cy="43" r="0.9" fill="#14171A"/>
<path d="M${CUNA_X - 15} 71H${CUNA_X + 15}L${CUNA_X + 11} 84H${CUNA_X - 11}Z" fill="#8A5A2B"/>
<path d="M${CUNA_X - 13} 76H${CUNA_X + 13}" stroke="#6B4A2B" stroke-width="1.2"/>
<ellipse cx="${CUNA_X}" cy="71" rx="15" ry="3.2" fill="${SOL}"/>
<ellipse cx="${CUNA_X + 2}" cy="68" rx="9" ry="4" fill="#fff"/>
<circle cx="${CUNA_X - 6}" cy="66.5" r="3.6" fill="${PIEL}"/>
<circle cx="${CUNA_X - 6}" cy="66.5" r="6.2" stroke="${SOL}" stroke-width="1.2" fill="none"/>
${persona(155, '#4F86BD', 9)}<circle cx="155" cy="47" r="5" fill="${PIEL}"/>
<path d="M148 49Q148 39 155 39Q162 39 162 49Q158.5 45 155 45Q151.5 45 148 49Z" fill="#fff"/>
<circle cx="155" cy="47" r="8" stroke="${SOL}" stroke-width="1.2" fill="none"/>
<circle cx="146" cy="68" r="2.4" fill="${PIEL}"/>
${persona(180, '#8A5A2B', 8)}<circle cx="180" cy="46" r="5" fill="${PIEL}"/>
<path d="M175.5 47Q175.5 55 180 55Q184.5 55 184.5 47Q180 50 175.5 47Z" fill="#6B4A2B"/>
<circle cx="180" cy="46" r="8" stroke="${SOL}" stroke-width="1.2" fill="none"/>
<path d="M190 50V84" stroke="#6B4A2B" stroke-width="2.5" stroke-linecap="round"/>`;

function oveja(x, y) {
  return `<ellipse cx="${x}" cy="${y}" rx="7" ry="5" fill="#fff"/><circle cx="${x - 4}" cy="${y - 3}" r="3.5" fill="#fff"/><circle cx="${x + 3}" cy="${y - 3.5}" r="3.5" fill="#fff"/>
<ellipse cx="${x + 8}" cy="${y - 1}" rx="3" ry="2.6" fill="#2B2F33"/><path d="M${x - 3} ${y + 4}v4M${x + 3} ${y + 4}v4" stroke="#2B2F33" stroke-width="1.6" stroke-linecap="round"/>`;
}

function casa(x, w, h) {
  return `<rect x="${x}" y="${90 - h}" width="${w}" height="${h}" fill="#1B1740"/>
<path d="M${x - 2} ${90 - h}L${x + w / 2} ${90 - h - 6}L${x + w + 2} ${90 - h}Z" fill="#120F30"/>
<rect x="${x + w / 2 - 1.5}" y="${90 - h + 3}" width="3" height="3.5" fill="#FFD76A"/>`;
}

// Flecos de paja colgando del alero del techo.
let paja = '';
for (let i = 0; i <= 12; i++) {
  const x = 120 + i * 11.5;
  const y = x <= 189 ? 71 - (x - 120) * (27 / 69) : 71 - (258 - x) * (27 / 69);
  paja += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l-1.5 5"/>`;
}

const ESTRELLAS_FONDO = [[12, 10], [40, 8], [60, 22], [86, 12], [104, 26], [118, 8], [196, 16], [214, 8], [236, 22], [254, 12], [26, 34], [72, 40], [226, 40], [246, 46], [186, 26]]
  .map(([x, y], i) => `<circle class="tw" style="animation-delay:${(i * 0.23).toFixed(2)}s" cx="${x}" cy="${y}" r="${i % 3 ? 1 : 1.6}" fill="#fff"/>`).join('');

const PESEBRE = `<defs>
<linearGradient id="pnCielo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A1633"/><stop offset=".6" stop-color="#2D2A6E"/><stop offset="1" stop-color="#7A4F8F"/></linearGradient>
<radialGradient id="pnLuz"><stop offset="0" stop-color="#FFE9A0" stop-opacity=".95"/><stop offset="1" stop-color="#FFE9A0" stop-opacity="0"/></radialGradient>
<clipPath id="pnMarco"><rect width="270" height="130" rx="12"/></clipPath>
<style>.tw{animation:pnTw 1.6s ease-in-out infinite alternate}@keyframes pnTw{from{opacity:.3}to{opacity:1}}</style>
</defs>
<g clip-path="url(#pnMarco)">
<rect width="270" height="130" fill="url(#pnCielo)"/>
${ESTRELLAS_FONDO}
<path d="M32 12A10 10 0 1 0 32 34A8 8 0 1 1 32 12Z" fill="#FFF3C4"/>
<path d="M0 94Q45 72 90 90T180 84T270 90V130H0Z" fill="#2A2352"/>
${casa(14, 14, 10)}${casa(33, 12, 8)}${casa(50, 15, 12)}${casa(92, 13, 9)}
<path d="M144 34L126 106H162Z" fill="#FFE9A0" fill-opacity=".14"/>
<circle cx="144" cy="22" r="22" fill="url(#pnLuz)"/>
<path d="M144 8V36M130 22H158M134 12L154 32M154 12L134 32" stroke="#FFE9A0" stroke-width="1.2" stroke-linecap="round" stroke-opacity=".8"/>
<g class="tw">${estrella(144, 22, 10, '#FFF3C4')}</g>
<g fill="#3B2A22" stroke="#3B2A22" stroke-linecap="round">
<ellipse cx="32" cy="88" rx="15" ry="7" stroke="none"/><circle cx="27" cy="80" r="5" stroke="none"/>
<path d="M44 84Q52 76 53 68" fill="none" stroke-width="5"/><ellipse cx="57" cy="67" rx="5.5" ry="3" transform="rotate(-18 57 67)" stroke="none"/>
<path d="M22 92V108M28 93V108M38 93V108M43 92V108M17 88Q13 92 14 98" fill="none" stroke-width="2.4"/></g>
<path d="M0 110Q60 103 120 109T270 107V130H0Z" fill="#1E3326"/>
<path d="M124 66L189 40L254 66V112H124Z" fill="#2B1D16"/>
<ellipse cx="189" cy="111" rx="62" ry="4" fill="#B8892B" fill-opacity=".85"/>
<g>
<ellipse cx="236" cy="101" rx="14" ry="9" fill="#7A4A2B"/><ellipse cx="222" cy="93" rx="7" ry="6" fill="#7A4A2B"/>
<path d="M216 88Q211 82 214 80M228 88Q233 82 230 80" stroke="#F1EBDD" stroke-width="2" fill="none" stroke-linecap="round"/>
<ellipse cx="218" cy="96" rx="3" ry="2.2" fill="#E8A9A0"/><circle cx="221" cy="91" r="1" fill="#14171A"/>
<ellipse cx="250" cy="102" rx="9" ry="8" fill="#8E8F94"/><ellipse cx="243" cy="94" rx="5" ry="5.5" fill="#8E8F94"/>
<path d="M241 90L238 80L244 88M246 89L249 80L248 90" fill="#8E8F94"/><ellipse cx="240" cy="97" rx="2.6" ry="2" fill="#C9CED3"/><circle cx="243" cy="93" r="0.9" fill="#14171A"/>
</g>
<g transform="translate(16 28)">${FIGURAS}</g>
<rect x="122" y="64" width="5" height="48" fill="#6B4A2B"/><rect x="251" y="64" width="5" height="48" fill="#6B4A2B"/>
<path d="M114 66L189 36L264 66L258 71L189 44L120 71Z" fill="#8A5A2B"/>
<g stroke="#6B4A2B" stroke-width="1.6" stroke-linecap="round">${paja}</g>
<path d="M120 71L189 44L258 71" stroke="#6B4A2B" stroke-width="1.5" fill="none"/>
<path d="M160 55V60" stroke="#14171A" stroke-width="1"/><circle cx="160" cy="65" r="11" fill="url(#pnLuz)"/><rect x="156.5" y="60" width="7" height="9" rx="2" fill="#FFD76A"/>
${oveja(14, 112)}${oveja(30, 118)}
</g>`;

// Islas Malvinas (aproximadas): Gran Malvina al oeste, Soledad al este, algunas
// islas chicas, con la bandera argentina plantada. Mar celeste.
const MALVINAS = `<defs><linearGradient id="mvMar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5E9BD6"/><stop offset="1" stop-color="#2E6FB0"/></linearGradient>
<clipPath id="mvMarco"><rect width="120" height="80" rx="12"/></clipPath></defs>
<g clip-path="url(#mvMarco)"><rect width="120" height="80" fill="url(#mvMar)"/>
<g stroke="#fff" stroke-opacity=".28" stroke-width="1.3" fill="none" stroke-linecap="round">
<path d="M6 74q5-3 10 0t10 0M94 74q5-3 10 0t10 0M8 10q5-3 10 0M98 8q5-3 10 0"/></g>
<path d="M54.8 64.3L55.4 64.7L55.3 65.4L52.9 67.6L52.5 66.3L53.1 65.3L53.2 63.6L51.9 62.3L51.8 60.5L52.6 62.2L54.8 62.2L55.3 62.9L54.8 64.3ZM8.8 44.9L7.6 45.7L7.8 46.1L8.8 46.0L8.1 47.2L7.0 47.2L5.0 45.3L5.6 44.9L7.1 45.8L7.9 43.9L8.8 44.9ZM16.4 51.4L14.9 51.7L13.4 51.1L13.6 50.4L13.2 50.4L12.8 49.4L11.1 48.7L11.1 46.9L10.1 46.3L11.0 45.4L12.9 45.3L13.9 43.5L15.2 42.9L16.6 44.3L16.5 44.8L14.4 46.2L13.8 47.4L16.1 46.8L18.2 45.1L18.5 43.9L17.9 43.2L19.0 42.2L19.2 43.5L17.6 49.0L18.9 49.0L18.2 50.8L16.4 51.4ZM6.5 38.2L8.8 38.8L6.6 39.4L6.3 41.9L5.5 41.5L5.0 40.5L5.4 38.9L6.5 38.2ZM56.7 41.2L53.9 44.1L48.9 51.9L47.6 52.3L45.6 53.7L45.3 52.1L44.1 51.8L43.5 51.1L42.9 52.1L43.2 53.6L42.6 53.9L39.9 53.7L38.8 54.2L38.8 53.4L39.5 52.4L37.0 53.7L36.7 54.6L37.2 58.1L34.0 61.9L31.7 61.2L31.6 62.2L29.9 60.2L28.6 59.5L28.4 60.4L29.7 61.5L30.2 63.3L29.0 64.8L27.3 65.7L25.6 65.6L24.5 63.6L25.8 63.6L23.5 60.6L24.3 59.4L20.4 59.2L20.1 59.5L21.7 60.2L23.3 62.6L21.0 62.5L18.8 59.7L17.6 59.5L16.1 57.6L13.6 56.3L14.2 54.6L17.9 55.6L18.5 57.2L19.1 57.2L18.7 55.5L22.7 54.4L21.7 53.6L20.2 53.0L19.5 51.8L23.6 52.1L24.1 53.1L25.0 52.1L25.4 53.2L26.4 52.6L27.5 52.9L29.1 54.0L29.4 53.4L29.0 52.8L30.6 52.6L32.1 51.8L33.2 49.9L33.0 49.5L32.7 49.3L31.1 50.6L29.7 51.1L28.1 51.1L26.9 50.4L29.3 50.6L30.7 49.8L31.7 48.0L31.5 44.1L31.8 43.3L32.6 42.6L34.0 42.6L33.0 43.9L34.3 43.7L33.8 46.0L35.1 47.0L35.4 45.6L36.3 45.3L35.9 44.0L36.3 41.6L37.0 41.6L37.6 42.9L38.3 42.6L38.6 43.2L39.8 42.2L39.9 39.5L39.1 39.2L36.9 39.9L35.1 39.6L34.3 39.9L34.2 41.5L33.4 41.2L31.6 42.2L30.2 42.2L29.2 43.6L28.6 43.6L28.0 42.0L26.2 40.5L25.8 38.5L26.3 37.6L31.3 39.2L34.1 37.5L36.6 37.8L38.7 36.9L41.4 38.6L43.1 38.8L41.9 37.4L39.6 36.8L37.8 34.8L36.5 34.1L35.7 32.7L30.4 30.6L29.6 28.6L31.7 28.3L33.2 28.7L33.5 28.5L33.1 27.5L31.6 26.3L28.4 25.9L26.7 25.2L26.1 24.5L26.2 23.6L25.6 21.9L26.9 21.5L32.4 24.2L35.5 26.9L38.0 28.2L40.8 28.6L45.8 27.6L45.1 26.8L42.9 26.6L43.2 25.4L44.9 23.1L45.6 25.0L47.5 23.4L48.5 22.9L49.4 23.2L49.0 24.3L52.8 25.3L50.7 25.6L51.5 26.6L53.2 26.6L59.0 25.3L61.2 23.9L58.2 26.3L59.6 27.1L61.1 27.1L64.1 25.9L62.5 24.3L62.4 22.2L63.5 22.2L63.3 21.2L64.3 21.3L65.2 22.4L68.3 23.7L69.6 25.0L67.7 25.1L67.6 26.7L68.9 26.6L66.0 29.3L65.5 28.6L64.7 29.0L64.5 30.7L65.4 30.4L65.4 30.7L64.4 32.1L64.2 33.8L62.4 35.4L61.9 34.8L62.0 33.8L60.5 35.3L60.1 35.1L58.4 36.8L59.3 36.7L56.7 41.2ZM48.6 19.5L47.9 19.8L48.3 20.8L48.0 21.3L46.6 21.5L45.5 20.6L44.8 19.2L46.7 18.7L48.6 19.5ZM40.2 23.9L38.1 24.4L36.6 23.6L36.9 22.2L37.7 21.8L39.2 21.5L40.5 22.9L42.0 22.2L37.2 19.3L36.3 18.1L36.5 17.5L37.1 17.4L37.7 18.7L39.1 19.5L43.2 19.3L44.0 21.6L42.4 23.2L41.8 24.6L40.2 23.9ZM112.5 38.8L115.0 38.5L115.0 38.8L111.0 40.5L107.9 40.8L107.1 41.7L102.4 42.2L98.8 41.9L100.3 42.9L102.4 43.3L102.4 43.6L98.8 43.9L96.7 45.3L95.9 45.3L97.2 45.6L99.1 44.7L101.1 44.6L99.9 45.7L94.0 48.7L91.2 48.2L88.5 48.7L83.6 48.6L79.0 45.8L78.0 43.9L77.0 45.7L77.1 46.8L78.0 47.8L81.8 49.8L82.4 50.8L82.0 51.6L82.8 51.9L85.4 51.5L87.4 52.4L87.5 53.4L88.3 54.1L86.2 55.8L86.8 56.6L87.2 59.3L86.1 59.3L84.5 56.5L82.6 55.5L81.9 56.1L80.5 56.0L80.7 57.2L78.4 59.0L77.8 56.8L77.1 57.5L76.3 55.5L74.4 55.3L74.2 54.4L73.2 54.6L71.9 53.2L70.0 54.4L67.9 53.5L66.8 54.4L67.0 55.0L67.5 55.3L68.4 54.7L70.0 55.1L70.4 55.4L70.7 57.2L72.2 56.8L72.7 57.2L71.7 58.5L73.8 58.9L71.7 60.2L71.4 61.1L72.6 61.4L75.0 60.7L74.7 61.7L73.1 62.6L74.6 64.5L74.2 65.3L73.6 65.5L71.5 64.3L69.3 64.3L68.1 61.9L66.7 60.9L66.1 61.1L64.9 59.7L64.3 59.5L63.7 61.7L62.8 60.6L62.2 61.0L63.5 63.3L62.9 64.0L63.0 64.8L64.1 65.0L65.3 66.0L65.4 67.7L64.7 68.8L66.0 70.1L65.7 70.9L64.1 69.4L61.2 68.1L60.9 66.5L58.3 65.4L58.3 64.8L59.1 63.9L57.1 63.8L57.0 62.6L54.0 59.3L54.1 58.8L54.5 58.7L55.9 59.9L56.5 59.8L56.9 58.9L56.5 58.2L57.8 57.9L58.6 56.8L57.0 55.5L56.8 54.3L59.1 54.8L58.0 53.1L60.1 52.4L60.1 52.1L57.6 51.1L57.6 50.1L58.3 49.6L61.2 50.8L61.8 50.2L60.1 48.3L60.3 47.8L61.6 47.7L61.8 46.8L61.2 46.3L64.0 45.1L64.6 45.7L65.4 42.9L66.4 43.5L67.5 43.3L66.8 41.6L69.8 39.5L70.3 40.2L71.6 38.8L74.4 38.5L75.2 41.7L74.8 44.9L76.5 44.3L76.7 43.6L75.9 41.1L76.0 39.8L75.3 38.8L75.5 37.8L76.4 37.4L76.4 36.5L73.1 35.3L71.0 32.9L72.4 31.0L72.7 29.3L75.3 33.4L75.9 32.1L74.9 29.8L75.4 29.2L76.5 29.7L75.7 28.8L72.3 27.1L73.1 24.9L73.6 24.6L75.0 25.3L76.0 25.0L76.6 23.6L79.4 23.3L80.3 22.2L78.9 19.4L77.9 18.3L77.6 16.8L79.7 18.5L81.8 19.2L84.3 20.7L86.6 20.9L87.6 21.5L88.1 21.5L88.0 20.6L89.1 19.7L92.1 19.4L94.4 20.5L96.3 22.7L96.6 25.7L95.3 26.5L93.7 26.8L93.1 26.6L92.3 24.4L91.9 23.9L91.4 24.1L90.0 25.9L91.0 25.9L90.8 28.8L91.2 29.2L93.2 28.1L93.9 28.1L93.9 31.7L94.9 31.1L95.8 32.5L96.9 31.7L97.5 32.1L98.4 34.9L99.8 36.8L100.3 36.5L99.2 34.4L99.6 33.8L101.5 34.8L101.3 33.6L99.4 32.2L100.3 31.2L100.2 30.5L98.4 30.7L97.4 28.3L96.9 29.5L95.8 29.5L97.9 25.4L99.9 23.9L106.3 23.4L108.0 22.9L109.7 23.1L112.4 28.1L114.0 29.0L112.9 30.4L113.7 30.4L113.7 31.4L112.9 31.7L109.1 31.2L105.9 29.5L105.6 29.9L106.0 31.1L104.3 30.4L102.4 31.4L102.9 32.3L105.1 33.5L106.0 33.8L107.7 33.3L108.6 33.9L112.6 34.5L113.6 35.2L114.0 36.3L113.4 36.9L110.0 37.8L110.0 38.2L112.5 38.8ZM53.2 18.5L51.6 18.0L51.5 16.9L52.6 16.4L55.0 17.5L58.1 17.1L58.7 18.5L59.4 18.8L59.9 17.9L60.7 17.5L62.0 18.4L62.4 20.5L59.2 21.2L56.6 18.8L53.2 18.5ZM52.6 70.2L53.1 69.3L54.9 69.0L55.0 69.6L54.3 69.8L54.3 70.5L53.4 71.7L54.0 72.2L56.1 71.6L56.4 72.2L54.8 74.1L52.8 72.8L52.0 72.9L51.0 71.8L52.7 70.8L52.6 70.2ZM94.1 53.7L94.5 54.1L94.2 55.0L93.0 54.8L93.2 55.5L92.7 55.8L93.7 55.6L93.7 59.0L92.8 58.6L93.1 58.0L92.6 58.1L90.9 57.2L90.1 55.3L92.2 54.0L92.1 53.6L93.4 54.3L94.1 53.7ZM55.3 52.3L55.3 53.4L54.1 52.8L54.7 51.0L55.3 52.3ZM53.3 20.8L55.0 22.3L55.0 21.3L55.7 21.4L55.9 22.2L57.7 22.8L57.8 23.3L54.0 24.8L53.1 24.2L53.8 22.9L51.9 22.9L50.7 21.8L52.4 21.6L52.7 20.7L53.3 20.8ZM29.1 18.5L29.6 19.6L29.3 20.2L29.1 19.4L27.5 18.6L27.1 17.5L27.6 17.1L29.1 18.5ZM13.1 8.0L13.0 8.5L10.9 7.7L11.3 7.0L11.1 5.9L13.1 8.0Z" fill="#F1EBDD" stroke="#CFC6A4" stroke-width=".8" stroke-linejoin="round"/>
<path d="M111.4 39.2V29.7" stroke="#2B2F33" stroke-width="1.2" stroke-linecap="round"/>
<rect x="101.4" y="29.7" width="10" height="2.4" fill="#74ACDF"/><rect x="101.4" y="32.1" width="10" height="2.4" fill="#fff"/><rect x="101.4" y="34.5" width="10" height="2.4" fill="#74ACDF"/>
<circle cx="106.4" cy="33.3" r=".8" fill="${SOL}"/></g>`;

const ANCHAS = {
  pesebre: { vb: '0 0 270 130', cuerpo: PESEBRE, clase: 'ancha' },
  malvinas: { vb: '0 0 120 80', cuerpo: MALVINAS, clase: 'media' },
};

export function svgIlus(nombre) {
  const ancha = ANCHAS[nombre];
  if (ancha) return `<svg class="${ancha.clase}" viewBox="${ancha.vb}" aria-hidden="true">${ancha.cuerpo}</svg>`;
  const cuerpo = ILUS[nombre];
  return cuerpo ? `<svg viewBox="0 0 64 64" aria-hidden="true">${cuerpo}</svg>` : '';
}
