// Contraseña opcional del comprador + limitador de intentos en memoria.
//
// Reglas de la contraseña según NIST SP 800-63B: largo mínimo, sin reglas de
// composición (mayúsculas/símbolos), sin vencimiento, y rechazo de contraseñas
// conocidas/filtradas. El chequeo de filtradas usa la API de Have I Been Pwned
// por k-anonymity (solo viajan los primeros 5 caracteres del SHA-1, nunca la
// contraseña) y es best-effort: si HIBP no responde, no bloquea.

import { createHash } from 'node:crypto';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
// bcrypt ignora todo lo que pase de 72 bytes; con tildes/emoji 64 caracteres
// pueden superarlo, así que se valida también en bytes.
const BCRYPT_MAX_BYTES = 72;

const COMUNES = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'contraseña',
  'contrasena', 'qwertyui', 'qwerty123', 'asdfghjk', '11111111', '00000000',
  '87654321', 'abcd1234', '1q2w3e4r', 'iloveyou', 'nexttap123', 'nexttap1',
]);

async function filtradaEnHibp(password) {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefijo = sha1.slice(0, 5);
  const sufijo = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefijo}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const cuerpo = await res.text();
    return cuerpo.split('\n').some((linea) => {
      const [suf, cuenta] = linea.trim().split(':');
      return suf === sufijo && Number(cuenta) > 0;
    });
  } catch {
    return false; // sin red / timeout: no bloquea
  }
}

/** Devuelve un mensaje de error para el usuario, o null si la contraseña sirve. */
export async function validarPassword(password, { email } = {}) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres.`;
  }
  if (password.length > PASSWORD_MAX || Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES) {
    return `La contraseña es demasiado larga (máximo ${PASSWORD_MAX} caracteres).`;
  }
  const baja = password.toLowerCase();
  if (COMUNES.has(baja) || /^(.)\1+$/.test(password)) {
    return 'Esa contraseña es muy común. Elegí otra.';
  }
  if (email && (baja === email.toLowerCase() || baja === email.split('@')[0].toLowerCase())) {
    return 'La contraseña no puede ser tu mail.';
  }
  if (await filtradaEnHibp(password)) {
    return 'Esa contraseña apareció en filtraciones de datos. Elegí otra.';
  }
  return null;
}

/**
 * Limitador de intentos en memoria, por clave (IP, mail...). Alcanza para un
 * solo proceso; si el backend escala a varias instancias habría que moverlo a
 * la base o a Redis.
 * @returns {{ permitido: (clave: string) => boolean, registrarFallo: (clave: string) => void, limpiar: (clave: string) => void }}
 */
export function crearLimitador({ max, ventanaMs }) {
  const fallos = new Map(); // clave -> { count, resetAt }
  const vigente = (clave) => {
    const e = fallos.get(clave);
    if (e && e.resetAt < Date.now()) {
      fallos.delete(clave);
      return null;
    }
    return e || null;
  };
  return {
    permitido(clave) {
      const e = vigente(clave);
      return !e || e.count < max;
    },
    registrarFallo(clave) {
      const e = vigente(clave);
      if (e) e.count++;
      else fallos.set(clave, { count: 1, resetAt: Date.now() + ventanaMs });
    },
    limpiar(clave) {
      fallos.delete(clave);
    },
  };
}
