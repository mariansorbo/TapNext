// Mide cuánto tarda un tap de punta a punta, desde esta PC (Buenos Aires).
//
//   node scripts/bench-tap.mjs <etiqueta> [--codigo XXXX] [--n 10] [--espera 15]
//   node scripts/bench-tap.mjs --comparar
//
// Corre dos tandas contra cada URL:
//   - espaciada: un pedido cada `--espera` segundos (default 15). Es lo que vive
//     un tap real con poco tráfico: el pool de la base ya cerró la conexión.
//   - ráfaga: pedidos seguidos. El mejor caso, con todo caliente.
// Mide con curl (DNS / conexión / TLS / primer byte) y guarda el resultado en
// scripts/bench-resultados/<etiqueta>.json para comparar contra la siguiente
// corrida. El User-Agent lleva "bot" → el tracking marca estos taps es_bot y no
// ensucian las estadísticas.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'bench-resultados');
const UA = 'NextTap-Bench-bot/1.0';

function arg(nombre, def) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? process.argv[i + 1] : def;
}

function medir(url) {
  const fmt = '{"code":%{http_code},"dns":%{time_namelookup},"conn":%{time_connect},"tls":%{time_appconnect},"ttfb":%{time_starttransfer},"total":%{time_total}}';
  try {
    const out = execFileSync('curl', ['-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-A', UA, '-w', fmt, url], { encoding: 'utf8' });
    return JSON.parse(out);
  } catch {
    return { code: 0, ttfb: NaN, total: NaN };
  }
}

const ms = (s) => Math.round(s * 1000);
function pct(arr, p) {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}
function resumen(muestras) {
  const ttfb = muestras.map((m) => ms(m.ttfb));
  const errores = muestras.filter((m) => m.code === 0 || m.code >= 500).length;
  return { n: muestras.length, errores, min: pct(ttfb, 0), p50: pct(ttfb, 50), p90: pct(ttfb, 90), max: pct(ttfb, 100) };
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function tanda(url, n, espera) {
  const muestras = [];
  for (let i = 0; i < n; i++) {
    if (i > 0 && espera) await sleep(espera);
    const m = medir(url);
    muestras.push(m);
    process.stdout.write(`  ${String(i + 1).padStart(2)}/${n}  ${m.code}  ${ms(m.ttfb)} ms\n`);
  }
  return muestras;
}

function imprimir(filas) {
  console.log('\n' + ['etiqueta', 'prueba', 'n', 'err', 'min', 'p50', 'p90', 'max'].map((h) => h.padEnd(h === 'prueba' ? 22 : h === 'etiqueta' ? 24 : 6)).join(''));
  for (const f of filas) {
    console.log(
      f.etiqueta.padEnd(24) + f.prueba.padEnd(22) +
      [f.n, f.errores, f.min, f.p50, f.p90, f.max].map((x) => String(x).padEnd(6)).join('')
    );
  }
  console.log('(tiempos = ms hasta el primer byte, desde esta PC)\n');
}

if (process.argv.includes('--comparar')) {
  const filas = [];
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
    const r = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    for (const [prueba, s] of Object.entries(r.resumen)) filas.push({ etiqueta: r.etiqueta, prueba, ...s });
  }
  imprimir(filas);
  process.exit(0);
}

const etiqueta = process.argv[2];
if (!etiqueta || etiqueta.startsWith('--')) {
  console.error('Uso: node scripts/bench-tap.mjs <etiqueta> [--codigo XXXX] [--n 10] [--espera 15] [--base https://next-tap.tech] [--api https://tapnext.onrender.com]');
  process.exit(1);
}
const codigo = arg('codigo', 'bench-inexistente');
const n = Number(arg('n', 10));
const espera = Number(arg('espera', 15));
const base = arg('base', 'https://next-tap.tech');
const api = arg('api', 'https://tapnext.onrender.com');

const pruebas = {
  'tap espaciado': [`${base}/v/${codigo}`, espera],
  'tap rafaga': [`${base}/v/${codigo}`, 0],
  'backend sin base': [`${api}/api/health`, 0],
};

const crudo = {};
const res = {};
for (const [nombre, [url, esp]] of Object.entries(pruebas)) {
  console.log(`\n▶ ${nombre}  ${url}${esp ? `  (cada ${esp}s)` : ''}`);
  crudo[nombre] = await tanda(url, n, esp);
  res[nombre] = resumen(crudo[nombre]);
}

mkdirSync(DIR, { recursive: true });
const archivo = join(DIR, `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}_${etiqueta}.json`);
writeFileSync(archivo, JSON.stringify({ etiqueta, fecha: new Date().toISOString(), codigo, base, api, resumen: res, crudo }, null, 2));
imprimir(Object.entries(res).map(([prueba, s]) => ({ etiqueta, prueba, ...s })));
console.log(`Guardado en ${archivo}`);
