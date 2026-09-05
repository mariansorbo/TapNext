import { limpiar } from './_comun.js';

// wa.me necesita el número en E.164 sin el "+". Para celulares argentinos eso es
// 54 + 9 + característica + abonado (10 dígitos locales). Si falta el 9 (o sobra
// un 0 / un 15 viejo), WhatsApp abre la app pero NO la conversación — de ahí el
// clásico "el llavero no funciona, solo me abre WhatsApp".
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
    if (resto.startsWith('9')) resto = resto.slice(1); // el 9 lo re-agregamos nosotros
    resto = resto.replace(/^(\d{2,4})15/, '$1'); // 15 viejo después de la característica
    return resto.length === 10 ? '549' + resto : null;
  }

  // Sin código de país: si son 10 dígitos locales, asumimos Argentina.
  const local = digits.replace(/^0/, '').replace(/^(\d{2,4})15/, '$1');
  if (local.length === 10) return '549' + local;

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
    return { modo: 'redirect', url: valor };
  },
  preview(valor) {
    const n = String(valor).replace(/\D/g, '');
    return `Abre un chat de WhatsApp con +${n}`;
  },
};
