// Verificación de identidad del comprador, desacoplada del canal.
//
// El login del comprador es passwordless: se le manda un código de un solo uso
// (OTP) y con eso entra. POR DÓNDE llega ese código es un detalle intercambiable
// — hoy `email`, mañana `whatsapp`, o lo que sea. Cada canal implementa el mismo
// contrato (`CanalVerificacion`) y el resto del backend no sabe cuál está activo.
//
// Elegir canal: variable de entorno `VERIFICACION_CANAL` (`email` | `whatsapp`).
// Por defecto `email`. Si el canal elegido no tiene credenciales cargadas,
// `disponible` es false y el endpoint cae a modo demo (muestra el código en vez
// de mandarlo) sin romper nada.

import { canalEmail } from './canales/email.js';
import { canalWhatsapp } from './canales/whatsapp.js';

/**
 * @typedef {Object} CanalVerificacion
 * @property {string} id                          - identificador estable ('email', 'whatsapp')
 * @property {string} nombre                      - para textos al usuario ("te lo mandamos por email")
 * @property {'whatsapp'|'email'} campoComprador  - columna de `compradores` que identifica a quien lo usa
 * @property {'tel'|'email'} tipoInput            - type del <input> en el front
 * @property {string} placeholder                 - hint del input en el front
 * @property {boolean} disponible                 - si tiene credenciales para enviar de verdad
 * @property {(raw: string) => string|null} normalizarDestino  - valida+normaliza el destino; null si es inválido
 * @property {(destino: string, codigo: string) => Promise<void>} enviarCodigo  - manda el código; throw si falla
 */

const CANALES = {
  [canalEmail.id]: canalEmail,
  [canalWhatsapp.id]: canalWhatsapp,
};

// Columnas de `compradores` que un canal puede usar como identidad. Lista blanca:
// `campoComprador` se interpola en SQL, así que tiene que estar acotado acá.
export const CAMPOS_COMPRADOR_VALIDOS = ['whatsapp', 'email'];

const elegido = process.env.VERIFICACION_CANAL || 'email';

/** El canal activo ahora mismo. */
export const canalVerificacion = CANALES[elegido] || canalEmail;

if (!CANALES[elegido]) {
  console.warn(
    `[verificación] VERIFICACION_CANAL="${elegido}" no existe; usando "${canalVerificacion.id}".`
  );
}
console.log(
  `[verificación] canal activo: ${canalVerificacion.id}` +
    (canalVerificacion.disponible ? '' : ' (modo demo — sin credenciales)')
);

/** Devuelve un canal por su id, o undefined. Sirve para el /verify, que usa el
 *  canal con el que se emitió el OTP, no necesariamente el activo hoy. */
export function canalPorId(id) {
  return CANALES[id];
}
