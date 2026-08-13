import { randomInt, randomBytes, createHash } from 'node:crypto';

export function generateOtp() {
  return String(randomInt(0, 10000)).padStart(4, '0');
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
