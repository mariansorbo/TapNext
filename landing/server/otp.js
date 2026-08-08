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
