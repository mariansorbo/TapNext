// Destinos: a dónde manda un llavero cuando lo tapean. Un destino tiene un
// `tipo` (instagram, whatsapp, web...) y un `valor`. El comprador carga el valor
// de la forma más cómoda para él — su @usuario, su número de teléfono, su
// dominio sin `https://` — y acá lo dejamos siempre como una URL absoluta
// navegable, que es lo único que sabe seguir el redirect del tap y la pantalla
// de activación. Antes esto no se normalizaba: si alguien escribía `instagram.com`
// el browser lo tomaba como ruta relativa y el tap tiraba 404.

export const DESTINO_TIPOS = ['whatsapp', 'instagram', 'pago', 'menu', 'review', 'web', 'agenda', 'linktree'];

// Textos por tipo para los formularios del front: en vez de un campo genérico
// "Valor", cada función muestra su propia etiqueta, ejemplo y ayuda.
export const DESTINO_META = {
  whatsapp: {
    label: 'WhatsApp',
    campo: 'Número de WhatsApp',
    placeholder: '11 2233 4455',
    ayuda: 'Con característica, sin el 0 ni el 15. También podés pegar un link wa.me/...',
  },
  instagram: {
    label: 'Instagram',
    campo: 'Usuario de Instagram',
    placeholder: 'tunegocio',
    ayuda: 'Solo tu usuario, sin @ ni el link completo.',
  },
  pago: {
    label: 'Link de pago',
    campo: 'Link de pago',
    placeholder: 'link.mercadopago.com.ar/tunegocio',
    ayuda: 'Tu link de cobro de Mercado Pago, MODO, PayPal, etc.',
  },
  menu: {
    label: 'Menú / carta',
    campo: 'Link del menú',
    placeholder: 'tunegocio.com/menu',
    ayuda: 'La página, PDF o Drive con tu menú o catálogo.',
  },
  review: {
    label: 'Reseñas',
    campo: 'Link para dejar reseña',
    placeholder: 'g.page/r/...',
    ayuda: 'El link donde tus clientes te dejan la reseña (Google, etc.).',
  },
  web: {
    label: 'Web propia',
    campo: 'Tu sitio web',
    placeholder: 'tunegocio.com',
    ayuda: 'El dominio de tu web. Le agregamos https:// solo.',
  },
  agenda: {
    label: 'Agenda / turnos',
    campo: 'Link de tu agenda',
    placeholder: 'calendly.com/tunegocio',
    ayuda: 'Calendly, Cal.com, Google Calendar, etc.',
  },
  linktree: {
    label: 'Linktree',
    campo: 'Usuario de Linktree',
    placeholder: 'tunegocio',
    ayuda: 'Solo tu usuario de Linktree, sin el link completo.',
  },
};

const limpiar = (s) => String(s ?? '').trim();

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
function handleDe(crudo) {
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

function normalizarWhatsapp(crudo) {
  const s = limpiar(crudo);
  let digits = '';
  const wa = s.match(/(?:wa\.me|api\.whatsapp\.com\/send|whatsapp\.com\/send)\/?\??(?:phone=)?\+?([\d\s().-]+)/i);
  if (wa) digits = wa[1].replace(/\D/g, '');
  else if (/^\+?[\d\s().-]+$/.test(s)) digits = s.replace(/\D/g, '');
  if (digits.length < 8) return null;
  // Heurística Argentina: número local de 10 dígitos (característica + abonado)
  // -> le anteponemos 549. Si ya trae código de país, lo dejamos como está.
  if (!digits.startsWith('54') && digits.length === 10) digits = '549' + digits;
  return `https://wa.me/${digits}`;
}

const RE_HANDLE = /^[A-Za-z0-9._-]+$/;

// Valida y normaliza el valor de un destino según su tipo.
// Devuelve { valor } si está OK, o { error } con un mensaje para el usuario.
export function normalizarDestino(tipo, crudo) {
  const raw = limpiar(crudo);
  if (!DESTINO_META[tipo]) return { error: 'Tipo de destino inválido.' };
  if (!raw) return { error: 'Falta el valor del destino.' };

  if (tipo === 'whatsapp') {
    const v = normalizarWhatsapp(raw);
    return v ? { valor: v } : { error: 'Poné un número de WhatsApp válido (con característica) o un link wa.me/...' };
  }

  if (tipo === 'instagram' || tipo === 'linktree') {
    const h = handleDe(raw);
    if (!h || !RE_HANDLE.test(h)) {
      return {
        error:
          tipo === 'instagram'
            ? 'Poné tu usuario de Instagram (ej: tunegocio), sin @ ni el link completo.'
            : 'Poné tu usuario de Linktree (ej: tunegocio).',
      };
    }
    return { valor: tipo === 'instagram' ? `https://instagram.com/${h}` : `https://linktr.ee/${h}` };
  }

  const u = aUrlAbsoluta(raw);
  return u ? { valor: u } : { error: 'Poné un link válido (ej: tunegocio.com).' };
}
