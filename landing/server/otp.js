import { randomInt, randomBytes, createHash } from 'node:crypto';

// 6 dígitos: 1.000.000 de combinaciones. Junto con el tope de intentos por
// código (ver /api/auth/otp/verify) adivinarlo es impracticable.
export const OTP_DIGITOS = 6;

export function generateOtp() {
  return String(randomInt(0, 10 ** OTP_DIGITOS)).padStart(OTP_DIGITOS, '0');
}

export function hashValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function generateToken() {
  return randomBytes(32).toString('hex');
}

// Token corto para el link público del vendedor (?s=...) — no adivinable
// (2^48 de espacio) pero lo bastante corto para un QR/URL prolija.
export function generateLinkToken() {
  return randomBytes(6).toString('hex');
}
