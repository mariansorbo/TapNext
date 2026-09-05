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

// Saca el "usuario" de un @handle, un handle pelado o una URL de perfil.
// `instagram.com/tunegocio` -> `tunegocio`, `@tunegocio` -> `tunegocio`.
export function handleDe(crudo) {
  let s = limpiar(crudo).replace(/^@/, '');
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  s = s.split(/[?#]/)[0];
  const partes = s.split('/').filter(Boolean);
  if (partes.length && partes[0].includes('.')) partes.shift(); // era un dominio
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
