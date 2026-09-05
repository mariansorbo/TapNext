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
    let resto = digits.slice(2).replace(/^0/, ''); // 0 nacional pegado al país (raro)
    if (resto.startsWith('9')) resto = resto.slice(1); // 9 de celular: la cuenta va sin él
    resto = resto.replace(/^(\d{2,4})15/, '$1'); // 15 viejo después de la característica
    return resto.length === 10 ? '54' + resto : null;
  }

  // Sin código de país: asumimos Argentina.
  let local = digits.replace(/^0/, '');
  if (local.length === 11 && local.startsWith('9')) local = local.slice(1); // marcó con el 9
  local = local.replace(/^(\d{2,4})15/, '$1');
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
    ayuda: 'Tu número como lo marcás en el celular. Le agregamos el 54 9 solo. También podés pegar un link wa.me/...',
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
