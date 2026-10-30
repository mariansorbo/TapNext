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

  mundo: `<circle cx="32" cy="32" r="24" stroke="#74ACDF" stroke-width="3.5" fill="none"/>
<ellipse cx="32" cy="32" rx="10" ry="24" stroke="#74ACDF" stroke-width="3" fill="none"/>
<path d="M8 32H56M12 20H52M12 44H52" stroke="#74ACDF" stroke-width="3"/>`,
};

export function svgIlus(nombre) {
  const cuerpo = ILUS[nombre];
  return cuerpo ? `<svg viewBox="0 0 64 64" aria-hidden="true">${cuerpo}</svg>` : '';
}
