// Registry de destinos: a dónde manda un llavero cuando lo tapean.
//
// Cada función es un plugin en su propio archivo (whatsapp.js, instagram.js...)
// que cumple el contrato `Destino` de abajo. El resto del backend solo habla con
// este registry: no sabe nada de wa.me, de @handles ni de https://. Agregar una
// función nueva = un archivo nuevo + una línea en `PLUGINS`. Nada más se toca.
//
// El comprador carga el valor de la forma más cómoda para él — su número, su
// @usuario, su dominio sin https:// — y `normalizar` lo deja siempre como algo
// que el redirect del tap y la pantalla de activación pueden seguir.

import { aUrlAbsoluta } from './_comun.js';
import whatsapp from './whatsapp.js';
import instagram from './instagram.js';
import pago from './pago.js';
import menu from './menu.js';
import review from './review.js';
import web from './web.js';
import agenda from './agenda.js';
import linktree from './linktree.js';

export { aUrlAbsoluta };

/**
 * @typedef {Object} Destino
 * @property {string} id  - identificador estable ('whatsapp', 'instagram'...)
 * @property {{label:string, campo:string, placeholder:string, ayuda:string}} meta
 *           - textos para el formulario del front (una etiqueta/ejemplo por función)
 * @property {(crudo: string) => {valor: string} | {error: string}} normalizar
 *           - valida + normaliza lo que tipeó el usuario; `error` es un mensaje para él
 * @property {(valor: string) => {modo: 'redirect', url: string, interstitial?: boolean} | {modo: 'landing', datos: object}} resolver
 *           - qué hace el tap con un valor ya normalizado. Hoy todos son `redirect`;
 *             `modo` deja lugar para funciones que necesiten una landing (vCard, WiFi).
 *             `interstitial: false` → redirect HTTP directo, sin la pantalla de
 *             marca (WhatsApp lo necesita para que Android abra la app)
 * @property {(valor: string) => string} preview  - frase legible de qué va a pasar
 */

const PLUGINS = [whatsapp, instagram, pago, menu, review, web, agenda, linktree];
const REGISTRY = Object.fromEntries(PLUGINS.map((p) => [p.id, p]));

export const DESTINO_TIPOS = PLUGINS.map((p) => p.id);
export const DESTINO_META = Object.fromEntries(PLUGINS.map((p) => [p.id, p.meta]));

/** El plugin de un tipo, o null si no existe. */
export function destinoPlugin(tipo) {
  return REGISTRY[tipo] || null;
}

// Valida y normaliza el valor de un destino según su tipo.
// Devuelve { valor } si está OK, o { error } con un mensaje para el usuario.
export function normalizarDestino(tipo, crudo) {
  const p = REGISTRY[tipo];
  if (!p) return { error: 'Tipo de destino inválido.' };
  const raw = String(crudo ?? '').trim();
  if (!raw) return { error: 'Falta el valor del destino.' };
  return p.normalizar(raw);
}

// Resuelve un destino ya guardado a la acción del tap. Filas viejas se guardaron
// sin https://: el fallback las fuerza a URL absoluta igual que antes.
export function resolverDestino(tipo, valor) {
  const p = REGISTRY[tipo];
  if (p) return p.resolver(valor);
  return { modo: 'redirect', url: aUrlAbsoluta(valor) || valor };
}

// Frase legible de a dónde manda un destino ("Abre un chat de WhatsApp con...").
export function previewDestino(tipo, valor) {
  const p = REGISTRY[tipo];
  return p ? p.preview(valor) : `Abre ${aUrlAbsoluta(valor) || valor}`;
}
