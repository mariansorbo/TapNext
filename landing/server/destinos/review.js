import { aUrlAbsoluta, destinoLink, limpiar } from './_comun.js';

// Reseñas: el comprador pega el link de reseñas de su local. Regla del proyecto:
// "mejor un destino raro que ninguno" — se acepta CUALQUIER link válido (Google en
// cualquiera de sus formatos, links de Maps, TripAdvisor, Facebook, etc.). Una
// validación estricta le costó una venta a un comprador con un link válido, así que
// no se rechaza por dominio ni por formato.
//
// A prueba de pegados reales:
//  - "Compartir" desde la app de Maps copia nombre + dirección + link en un solo
//    texto: se extrae el link.
//  - Mensajes tipo "Dejanos tu reseña: https://g.page/r/X/review." (con texto y
//    punto final), envuelto en ( ) o < >, con &amp; (copiado de HTML), con
//    invisibles o espacios duros: se limpia.
//  - Si hay varios links, gana el de Google/Maps; si no, el primero con https://.
//
// Única normalización: `g.page/r/CODIGO` (con o sin `/review`, con `www.`, con
// barra final o con query) queda como `https://g.page/r/CODIGO/review`, que abre
// directo el formulario. Todo lo demás se guarda tal cual (con https:// si faltaba).

const base = destinoLink({
  id: 'review',
  meta: {
    label: 'Reseñas',
    campo: 'Link para dejar reseña',
    placeholder: 'g.page/r/.../review',
    ayuda:
      'Pegá el link de reseñas de tu local. En Google lo sacás desde tu Perfil de Negocio, en la opción de pedir o compartir reseñas. Si lo copiás de Maps con el nombre y la dirección, también sirve.',
  },
});

// Hosts de Google / Maps / links cortos: tienen prioridad cuando hay varios links.
const HOST_GOOGLE = /(^|\.)(g\.page|g\.co|goo\.gl|share\.google|google\.[a-z]{2,3}(\.[a-z]{2})?)$/i;

// Saca de un texto los links candidatos, en el orden en que aparecen.
function candidatos(texto) {
  const t = limpiar(texto).replace(/&amp;/gi, '&');
  const tokens = t
    .split(/\s+/)
    .map((x) =>
      x
        .replace(/^[(<[{"'¿¡]+/, '')
        .replace(/[)\]>}"'.,;:]+$/, '')
    )
    .filter(Boolean);
  const unico = tokens.length === 1;
  const out = [];
  for (const tk of tokens) {
    if (tk.includes('@') && !tk.includes('/')) continue; // mail, no link
    const explicito = /^https?:\/\//i.test(tk);
    const url = aUrlAbsoluta(tk);
    if (!url) continue;
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      continue;
    }
    const google = HOST_GOOGLE.test(host);
    // Un token pelado que parece dominio ("Av.Corrientes") solo cuenta si es lo
    // único que se pegó o si es de Google; dentro de una frase es texto.
    if (!explicito && !google && !unico) continue;
    out.push({ url, score: (google ? 2 : 0) + (explicito ? 1 : 0) });
  }
  return out;
}

function canonico(valor) {
  try {
    const u = new URL(valor);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'g.page') {
      const m = u.pathname.match(/^\/r\/([^/]+)(?:\/review)?\/?$/i);
      if (m) return `https://g.page/r/${m[1]}/review`;
    }
  } catch {
    // ya validado antes: si algo raro pasa, queda el valor tal cual
  }
  return valor;
}

export default {
  ...base,
  normalizar(crudo) {
    const cands = candidatos(crudo);
    if (!cands.length) {
      const t = limpiar(crudo);
      // Con espacios no hay que pegar las palabras como si fueran un link.
      if (/\s/.test(t)) {
        if (/^\+?[\d\s()./-]{6,20}$/.test(t) && /\d/.test(t)) {
          return { error: 'Eso parece un teléfono. Acá va un link (ej: g.page/r/.../review).' };
        }
        return { error: 'No encontré un link en lo que pegaste. Pegá el link de reseñas (ej: g.page/r/.../review).' };
      }
      return base.normalizar(crudo); // mensajes claros (usuario, teléfono, inválido)
    }
    const mejor = cands.reduce((a, b) => (b.score > a.score ? b : a));
    const r = base.normalizar(mejor.url);
    return r.error ? r : { valor: canonico(r.valor) };
  },
};
