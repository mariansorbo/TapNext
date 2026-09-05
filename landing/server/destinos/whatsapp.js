import { limpiar } from './_comun.js';

// wa.me necesita el número en E.164 sin el "+".
//
// Para Argentina WhatsApp identifica la cuenta SIN el 9 de celular (el 9 es solo
// para discar): la cuenta de "+54 9 11 2263 6101" es 541122636101. Un link con
// el 9 (wa.me/549…) lo corrige la web, pero la app de Android abre WhatsApp sin
// la conversación — el clásico "el llavero solo me abre WhatsApp". Así que para
// AR devolvemos 54 + característica + abonado (10 dígitos), sin 9, y sacamos
// también el 0 nacional y el 15 viejo.
//
// Deja un número local argentino en 10 dígitos limpios (característica + abonado):
// saca el 9 de celular, el 15 viejo pegado después de la característica, y — el
// caso porteño — un 15 al principio sin característica (`15 6179 1902` = quiso
// decir `11 6179 1902`; ninguna característica válida empieza con 15).
function localAR(d) {
  let n = d.replace(/^0/, '');
  if (n.length === 11 && n.startsWith('9')) n = n.slice(1); // marcó con el 9
  // 15 viejo entre la característica y el abonado: se saca solo si lo que queda
  // da los 10 dígitos de un número completo (evita romper un abonado que
  // legítimamente empieza con 15).
  n = n.replace(/^(\d{2,4})15(\d+)$/, (m, a, b) => (a.length + b.length === 10 ? a + b : m));
  n = n.replace(/^15(\d{8})$/, '11$1'); // 15<abonado> sin característica → celu porteño
  return n;
}

// El usuario carga su número como lo marca en el celular; acá lo dejamos listo.
export function aE164(crudo) {
  const s = limpiar(crudo);
  let digits = '';
  const wa = s.match(/(?:wa\.me|api\.whatsapp\.com\/send|whatsapp\.com\/send)\/?\??(?:phone=)?\+?([\d\s().-]+)/i);
  if (wa) digits = wa[1].replace(/\D/g, '');
  else if (/^\+?[\d\s().-]+$/.test(s)) digits = s.replace(/\D/g, '');
  if (!digits) return null;

  digits = digits.replace(/^00/, ''); // 00 = prefijo internacional

  // Ya trae el código de país de Argentina.
  if (digits.startsWith('54')) {
    const resto = localAR(digits.slice(2));
    return resto.length === 10 ? '54' + resto : null;
  }

  // Sin código de país: asumimos Argentina.
  const local = localAR(digits);
  if (local.length === 10) return '54' + local;

  // Otro país: si parece un internacional plausible, lo dejamos como vino.
  if (digits.length >= 11 && digits.length <= 15) return digits;

  return null;
}

/** @type {import('./index.js').Destino} */
export default {
  id: 'whatsapp',
  meta: {
    label: 'WhatsApp',
    campo: 'Número de WhatsApp',
    placeholder: '11 2233 4455',
    ayuda: 'Con característica (ej: 11), como lo marcás en el celular. El resto lo armamos nosotros. También podés pegar un link wa.me/...',
  },
  normalizar(crudo) {
    const e164 = aE164(crudo);
    return e164
      ? { valor: `https://wa.me/${e164}` }
      : { error: 'Poné un número de WhatsApp válido (con característica) o un link wa.me/...' };
  },
  resolver(valor) {
    // Re-normaliza: así las filas viejas guardadas con el 9 (wa.me/549…) también
    // se corrigen al redirigir, sin migración.
    const e164 = aE164(valor);
    return { modo: 'redirect', url: e164 ? `https://wa.me/${e164}` : valor };
  },
  preview(valor) {
    const e164 = aE164(valor) || String(valor).replace(/\D/g, '');
    return `Abre un chat de WhatsApp con +${e164}`;
  },
};
