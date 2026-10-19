// Backend contra la Postgres de ESTA PC (DATABASE_URL_LOCAL del .env), para
// probar la base migrada sin tocar producción:
//
//   node scripts/server-local.mjs            → puerto 3002, sin mails ni MP
//   node scripts/server-local.mjs --prod     → con todas las claves (cuando
//                                              esta máquina sea el backend real)
//
// Sin --prod se vacían las claves que hablan con terceros: si no, el aviso de
// "pago que no llegó" mandaría mails duplicados de ventas que Render ya avisó.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANDING = join(dirname(fileURLToPath(import.meta.url)), '..');
const prod = process.argv.includes('--prod');

for (const linea of readFileSync(join(LANDING, '.env'), 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
if (!process.env.DATABASE_URL_LOCAL) throw new Error('Falta DATABASE_URL_LOCAL en landing/.env');
process.env.DATABASE_URL = process.env.DATABASE_URL_LOCAL;
process.env.PORT ||= prod ? '3001' : '3002';

if (!prod) {
  for (const k of ['RESEND_API_KEY', 'MP_ACCESS_TOKEN', 'ENVIOPACK_API_KEY', 'ENVIOPACK_SECRET_KEY',
    'META_CAPI_ACCESS_TOKEN', 'WHATSAPP_BUSINESS_TOKEN', 'PAP_URL', 'GA_API_SECRET']) delete process.env[k];
}

process.chdir(LANDING);
console.log(`[server-local] base local, puerto ${process.env.PORT}${prod ? ' (PROD)' : ' (sin terceros)'}`);
await import('../server/index.js');
