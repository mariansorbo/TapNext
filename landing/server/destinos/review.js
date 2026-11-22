import { aUrlAbsoluta, destinoLink } from './_comun.js';

// Reseñas de Google: el tap tiene que abrir el FORMULARIO de reseña, no la ficha
// del local. Solo se aceptan los dos formatos que lo hacen directo:
//   - g.page/r/CODIGO/review   (link corto de reseña del Perfil de Negocio)
//   - search.google.com/local/writereview?placeid=ID
// Un link común de Maps abre la ficha: se rechaza con una indicación clara.

const ID = 'review';
const META = {
  label: 'Reseñas',
  campo: 'Link para dejar reseña',
  placeholder: 'g.page/r/.../review',
  ayuda:
    'Pegá el link de reseña de tu local en Google: en tu Perfil de Negocio, buscá la opción de pedir o compartir reseñas y copiá ese link. No sirve el link de la ficha de Maps.',
};

const ERR_FICHA =
  'Ese es el link de la ficha del local en Maps, no el de reseña. En tu Perfil de Negocio buscá la opción de pedir o compartir reseñas y pegá ese link (ej: g.page/r/.../review).';
const ERR_INVALIDO =
  'Ese no es un link de reseña de Google. Tiene que ser del tipo g.page/r/.../review (ej: g.page/r/.../review).';

const HOSTS_FICHA = new Set(['maps.app.goo.gl', 'maps.google.com']);

function normalizarResena(crudo) {
  const s = String(crudo ?? '').trim();
  if (!s) return { error: 'Poné el link de reseña (ej: g.page/r/.../review).' };

  const abs = aUrlAbsoluta(s);
  if (!abs) return { error: ERR_INVALIDO };

  const u = new URL(abs);
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  if (HOSTS_FICHA.has(host) || (host === 'google.com' && u.pathname.startsWith('/maps'))) {
    return { error: ERR_FICHA };
  }

  // g.page/r/CODIGO  o  g.page/r/CODIGO/review  -> siempre /review
  if (host === 'g.page') {
    const m = u.pathname.match(/^\/r\/([^/]+)(?:\/review)?\/?$/i);
    if (m) return { valor: `https://g.page/r/${m[1]}/review` };
    return { error: ERR_INVALIDO };
  }

  // search.google.com/local/writereview?placeid=ID -> conservamos solo el placeid
  if (host === 'search.google.com' && /^\/local\/writereview\/?$/i.test(u.pathname)) {
    const placeid = u.searchParams.get('placeid');
    if (placeid && /^[\w-]+$/.test(placeid)) {
      return { valor: `https://search.google.com/local/writereview?placeid=${placeid}` };
    }
    return { error: ERR_INVALIDO };
  }

  return { error: ERR_INVALIDO };
}

const base = destinoLink({ id: ID, meta: META });

export default {
  ...base,
  normalizar: normalizarResena,
};
