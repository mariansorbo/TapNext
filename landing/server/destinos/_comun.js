// Piezas compartidas entre los plugins de destino. Cada función (whatsapp,
// instagram, web...) vive en su propio archivo y solo tiene que cumplir el
// contrato que documenta `index.js`. Acá están los ladrillos que casi todas
// reusan: limpiar lo que tipeó la persona, normalizar un link a URL absoluta,
// sacar el "usuario" de un handle, y dos fábricas para los dos patrones más
// comunes (un link / un @usuario).
//
// Filosofía (la bajó Mariano): en el alta, ante la duda que la venta pase —
// "mejor un destino raro que ninguno". Por eso `limpiar` es agresivo y los
// parsers intentan rescatar el valor antes de devolver error.

// --- Limpieza universal -----------------------------------------------------

// Caracteres invisibles que se cuelan al copiar de WhatsApp / Word / PDF y
// hacen que una validación falle sin que se vea por qué: zero-width space/
// joiner, word joiner, BOM, soft hyphen, Mongolian vowel separator.
const INVISIBLES = /[​-‍⁠﻿­᠎]/g;
const COMILLAS_SIMPLES = /[‘’‚‛′´`]/g;
const COMILLAS_DOBLES = /[“”„‟″«»]/g;
// Pares que envuelven el valor al copiarlo de un texto: ("x"), [x], <x>, "x".
// Se sacan solo de a pares (apertura al inicio + cierre al final) para no
// romper una URL que legítimamente termina en `)` (ej. Wikipedia).
const PARES = [
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['<', '>'],
  ['"', '"'],
  ["'", "'"],
  ['«', '»'],
];
// Puntuación de oración pegada a las puntas ("mirá esto: tunegocio.com.").
const PUNTUACION_PUNTA = /^[\s.,;:!?¿¡]+|[\s.,;!?]+$/g;

// Deja el texto tal como lo diría una persona, sin la basura del portapapeles:
// normaliza ancho completo (＠１２ -> @12), saca invisibles, unifica
// comillas, convierte el espacio duro y saca la envoltura. NO baja a minúsculas
// ni saca espacios internos: eso lo decide cada parser.
export function limpiar(s) {
  let t = String(s ?? '');
  try {
    t = t.normalize('NFKC');
  } catch {
    // entradas con surrogates sueltos: seguimos sin normalizar
  }
  t = t
    .replace(INVISIBLES, '')
    .replace(/ /g, ' ')
    .replace(COMILLAS_SIMPLES, "'")
    .replace(COMILLAS_DOBLES, '"')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();

  // Saca de a pares la envoltura ("x"), (x), <x>… y después la puntuación de
  // oración de las puntas. Se repite mientras algo cambie.
  let antes;
  do {
    antes = t;
    for (const [a, b] of PARES) {
      if (t.length > 1 && t[0] === a && t[t.length - 1] === b) t = t.slice(1, -1).trim();
    }
    t = t.replace(PUNTUACION_PUNTA, '').trim();
  } while (t !== antes);

  return t;
}

// --- Links ----------------------------------------------------------------

// Convierte cualquier cosa que parezca un link en una URL http(s) absoluta.
// `tunegocio.com/x` -> `https://tunegocio.com/x`. Devuelve null si no llega a
// ser una URL válida con dominio. Tolera los typos de esquema más comunes
// (`https:/x`, `https//x`, `htp://x`) y la coma por punto (`tunegocio,com`).
export function aUrlAbsoluta(crudo) {
  let s = limpiar(crudo);
  if (!s) return null;
  if (/^(mailto:|tel:)/i.test(s)) return s.replace(/\s+/g, '');

  // Una URL real no lleva espacios sin escapar.
  s = s.replace(/\s+/g, '');
  // Coma por punto cuando claramente reemplaza al punto del dominio.
  if (!s.includes('.') && s.includes(',')) s = s.replace(/,/g, '.');

  // Typos de esquema: "https:/x", "https//x", "https:x", "htp://x", "ttps://x".
  // Se exige el `:` o el `//` para no morder un dominio que arranque con "htp".
  const mEsq = s.match(/^h?t{1,2}p(s?)(?:\s*:\s*\/{0,2}|\s*\/\/)(?=[^/])/i);
  if (mEsq) {
    s = (mEsq[1] ? 'https://' : 'http://') + s.slice(mEsq[0].length);
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = 'https://' + s.replace(/^[/:]+/, '');
  }
  s = s.replace(/^(https?:\/\/)\/+/i, '$1');

  try {
    const u = new URL(s);
    if (!/^https?:$/i.test(u.protocol)) return null;
    // hostname con un TLD alfabético de 2+ letras (descarta "no-es-un-dominio").
    if (!/\.[a-z]{2,}$/i.test(u.hostname.replace(/\.$/, ''))) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// --- Handles (@usuario de una plataforma) --------------------------------

// `algo.algo(.algo)…` con TLD alfabético: parece un dominio y no un usuario.
const PARECE_DOMINIO = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

// Saca el "usuario" de un @handle, un handle pelado o una URL de perfil.
// `instagram.com/tunegocio` -> `tunegocio`, `@tunegocio` -> `tunegocio`.
//
// Reglas:
//  - Un token suelto (sin `/` ni esquema) se toma ENTERO como usuario, aunque
//    tenga puntos (`juan.perez`, `_.juan` son usuarios válidos). Nunca se lo
//    confunde con un dominio.
//  - Si vino una URL, el primer tramo es el dominio y se saca. Si ese dominio
//    pelado es lo único que hay (`instagram.com`), queda vacío -> error.
//  - `dominios`: hostnames de la plataforma (`instagram.com`, `instagr.am`).
//  - `saltarTramo`: tramos de ruta donde el usuario está en el SIGUIENTE tramo
//    (`instagram.com/_u/<user>`). `cortarTramo`: tramos que son contenido sin
//    usuario recuperable (`instagram.com/p/<id>`).
export function handleDe(crudo, { dominios = [], saltarTramo = [], cortarTramo = [] } = {}) {
  const doms = dominios.map((d) => d.toLowerCase());
  const salto = new Set(saltarTramo);
  const corte = new Set(cortarTramo);

  let s = limpiar(crudo)
    // Etiqueta al principio ("mi ig:", "instagram es", "usuario:").
    .replace(
      /^(?:mi\s+|nuestro\s+)?(?:usuario|user|perfil|instagram|insta|ig|linktree)\s*(?:de\s+[a-z]+\s*)?[:.\-–]?\s+(?:es\s+)?/i,
      ''
    )
    .replace(/^@+\s*/, '')
    // Aclaración entre paréntesis/corchetes: "tunegocio (mi tienda)".
    .replace(/\s*[([{][^)\]}]*[)\]}]\s*/g, ' ')
    .trim();

  // Con varias palabras: quedarse con la que es el handle — la que arranca en
  // `@`, o la que trae el dominio de la plataforma. Si no hay ninguna pista y
  // hay más de una palabra, es ambiguo (mejor pedir de nuevo que adivinar mal).
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const arroba = tokens.find((t) => t.startsWith('@'));
    const conDominio = tokens.find(
      (t) => /[a-z0-9-]+\.[a-z]{2,}\//i.test(t) || doms.some((d) => t.toLowerCase().includes(d))
    );
    if (arroba) s = arroba;
    else if (conDominio) s = conDominio;
    else return '';
  }
  s = s.replace(/^@+\s*/, '');

  const teniaEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^www\./i.test(s);
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '');
  s = s.split(/[?#\s]/)[0]; // corta en query, fragmento o primer espacio
  const teniaRuta = s.includes('/');
  const partes = s.split('/').filter(Boolean);

  const esDominioPlataforma = (t) => {
    const tl = t.toLowerCase().replace(/^www\./, '');
    return doms.some((d) => tl === d || tl.endsWith('.' + d));
  };
  if (partes.length) {
    if (esDominioPlataforma(partes[0])) partes.shift();
    else if ((teniaRuta || teniaEsquema) && PARECE_DOMINIO.test(partes[0])) partes.shift();
  }

  // Saltar / cortar tramos reservados (Instagram: /_u/<user>, /p/<id>, …).
  while (partes.length) {
    const seg = partes[0].replace(/^@+/, '').toLowerCase();
    if (corte.has(seg)) return '';
    if (salto.has(seg) && partes.length > 1) {
      partes.shift();
      continue;
    }
    break;
  }

  let h = '';
  try {
    h = partes.length ? decodeURIComponent(partes[0]) : '';
  } catch {
    h = partes[0] || '';
  }
  // El usuario nunca arranca/termina en punto (ninguna plataforma lo permite);
  // sí puede arrancar en `_`. Bajamos a minúsculas: los handles son
  // case-insensitive y así no guardamos dos URLs distintas para el mismo perfil.
  return h
    .replace(/^@+/, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .toLowerCase();
}

// --- Fábricas ------------------------------------------------------------

// Fábrica para destinos que son "un link y ya": valida el dominio y antepone
// https:// si falta. Sirve para web, pago, menú, reseñas, agenda.
export function destinoLink({ id, meta }) {
  return {
    id,
    meta,
    normalizar(crudo) {
      const u = aUrlAbsoluta(crudo);
      return u ? { valor: u } : { error: `Poné un link válido (ej: ${meta.placeholder}).` };
    },
    resolver(valor) {
      return { modo: 'redirect', url: aUrlAbsoluta(valor) || valor };
    },
    preview(valor) {
      return `Abre ${aUrlAbsoluta(valor) || valor}`;
    },
  };
}

// Forma válida del usuario ya limpio, por defecto (Instagram/Linktree afinan).
const RE_HANDLE_DEFAULT = /^[a-z0-9._-]{1,60}$/i;

// Fábrica para destinos "usuario de una plataforma": acepta `@juan`, `juan`, la
// URL del perfil o un link de "abrir en la app", y siempre guarda la URL
// canónica. Sirve para Instagram, Linktree, y cualquier red que se resuelva
// como `dominio.com/<usuario>`.
//
//  - `dominios`: hostnames de la plataforma.
//  - `re`: forma completa válida del usuario limpio.
//  - `saltarTramo` / `cortarTramo`: tramos reservados de la ruta.
export function destinoHandle({
  id,
  meta,
  urlDe,
  errorMsg,
  dominios = [],
  re = RE_HANDLE_DEFAULT,
  saltarTramo = [],
  cortarTramo = [],
}) {
  function usuarioValido(crudo) {
    const h = handleDe(crudo, { dominios, saltarTramo, cortarTramo });
    if (!h) return null;
    if (re.test(h)) return h;
    // Rescate CONSERVADOR: solo se saca basura de las PUNTAS (signos,
    // paréntesis, puntos que ninguna plataforma admite al borde). Si el
    // caracter inválido está en el MEDIO (una tilde, una ñ, un guión, un
    // espacio), es error — mejor pedir de nuevo que mandar a un perfil
    // equivocado sin avisar ("juán.pérez" NO se convierte en "ju").
    const podado = h.replace(/^[^a-z0-9_]+/i, '').replace(/[^a-z0-9_]+$/i, '');
    return podado && podado !== h && re.test(podado) ? podado : null;
  }

  return {
    id,
    meta,
    normalizar(crudo) {
      const h = usuarioValido(crudo);
      return h ? { valor: urlDe(h) } : { error: errorMsg };
    },
    resolver(valor) {
      // Valores nuevos ya son URL canónica; filas viejas sin https:// las
      // forzamos igual, para que el redirect no las tome como relativas.
      return { modo: 'redirect', url: aUrlAbsoluta(valor) || valor };
    },
    preview(valor) {
      return `Abre ${valor}`;
    },
  };
}
