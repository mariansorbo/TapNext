// Piezas compartidas entre los plugins de destino. Cada función (whatsapp,
// instagram, web...) vive en su propio archivo y solo tiene que cumplir el
// contrato que documenta `index.js`. Acá están los ladrillos que casi todas
// reusan: normalizar un link a URL absoluta, sacar el "usuario" de un handle,
// y dos fábricas para los dos patrones más comunes (un link / un @usuario).

export const limpiar = (s) => String(s ?? '').trim();

// Convierte cualquier cosa que parezca un link en una URL http(s) absoluta.
// `tunegocio.com/x` -> `https://tunegocio.com/x`. Devuelve null si no llega a
// ser una URL válida con dominio.
export function aUrlAbsoluta(crudo) {
  let s = limpiar(crudo);
  if (!s) return null;
  if (/^(mailto:|tel:)/i.test(s)) return s;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    if (!/^https?:$/i.test(u.protocol)) return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const PARECE_DOMINIO = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
// TLDs reales frecuentes: distinguen `instagram.com` (dominio pegado) de
// `juan.perez` (handle con punto). Solo se usa para tokens sueltos sin ruta.
const TLD_REAL = /\.(com|net|org|ar|io|app|co|xyz|me|link|store|shop)$/i;

// Saca el "usuario" de un @handle, un handle pelado o una URL de perfil.
// `instagram.com/tunegocio` -> `tunegocio`, `@tunegocio` -> `tunegocio`.
//
// Clave: un handle sin `/` ni esquema se toma entero como usuario, aunque tenga
// puntos (`juan.perez`, `._juan` son usuarios válidos de Instagram). Solo cuando
// vino una URL con ruta (`instagram.com/user`) o alguien pegó el dominio pelado
// (`instagram.com`) tratamos el primer tramo como dominio y lo sacamos.
export function handleDe(crudo) {
  const bruto = limpiar(crudo);
  let s = bruto.replace(/^@/, '');
  const teniaEsquemaOWww = /^(https?:\/\/|www\.)/i.test(s);
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  s = s.split(/[?#]/)[0];
  const partes = s.split('/').filter(Boolean);
  const teniaRuta = s.includes('/');
  // `instagram.com/user` (ruta) o `instagram.com` pegado de una URL: el primer
  // tramo es el dominio y lo sacamos. Un token suelto SIN ruta ni esquema se
  // toma entero como usuario (`juan.perez`, `._juan` son handles válidos),
  // salvo que sea claramente un dominio pegado (`instagram.com`): forma
  // `algo.tld` con un TLD real conocido.
  const primerTramoEsDominio =
    partes.length &&
    PARECE_DOMINIO.test(partes[0]) &&
    (teniaRuta || teniaEsquemaOWww || TLD_REAL.test(partes[0]));
  if (primerTramoEsDominio) partes.shift();
  try {
    return partes.length ? decodeURIComponent(partes[0]) : '';
  } catch {
    return partes[0] || '';
  }
}

const RE_HANDLE = /^[A-Za-z0-9._-]+$/;

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

// Fábrica para destinos "usuario de una plataforma": acepta `@juan`, `juan` o
// la URL del perfil y siempre guarda la URL canónica. Sirve para Instagram,
// Linktree, y cualquier red que se resuelva como `dominio.com/<usuario>`.
export function destinoHandle({ id, meta, urlDe, errorMsg }) {
  return {
    id,
    meta,
    normalizar(crudo) {
      const h = handleDe(crudo);
      if (!h || !RE_HANDLE.test(h)) return { error: errorMsg };
      return { valor: urlDe(h) };
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
