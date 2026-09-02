// Backfill puntual: mete los últimos N stickers creados en el lote 1 y le pone
// a ese lote una etiqueta de tipo (por defecto "Activación Bloqueada").
//
// Uso:
//   node server/backfill-lote.js                 -> dry run (no escribe nada)
//   node server/backfill-lote.js --apply         -> aplica
//   node server/backfill-lote.js --n 50 --lote 1 --tipo "Activación Bloqueada" --apply
//
// Por defecto solo mueve stickers que hoy NO tienen lote (lote_id IS NULL),
// para no sacar ninguno de un lote existente. --force ignora ese filtro.

import { db } from './db.js';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const N = Math.max(1, Number(flag('n', '50')));
const LOTE_ID = Number(flag('lote', '1'));
const TIPO = flag('tipo', 'Activación Bloqueada');
const NOMBRE = flag('nombre', 'Activación Bloqueada');

async function get(sql, a = []) { return (await db.execute({ sql, args: a })).rows[0] || null; }
async function all(sql, a = []) { return (await db.execute({ sql, args: a })).rows; }
async function run(sql, a = []) { return db.execute({ sql, args: a }); }

// 1. Lote destino
let lote = await get('SELECT id, nombre, tipo FROM lotes WHERE id = ?', [LOTE_ID]);
if (!lote) {
  console.log(`Lote ${LOTE_ID} no existe.`);
  if (APPLY) {
    await run('INSERT INTO lotes (id, nombre, tipo, cantidad) VALUES (?, ?, ?, 0)', [LOTE_ID, NOMBRE, TIPO]);
    // Reacomodar la secuencia para que los próximos INSERT no choquen con este id.
    await run(`SELECT setval(pg_get_serial_sequence('lotes','id'), GREATEST((SELECT MAX(id) FROM lotes), ?))`, [LOTE_ID]);
    lote = await get('SELECT id, nombre, tipo FROM lotes WHERE id = ?', [LOTE_ID]);
    console.log(`  -> creado lote ${LOTE_ID} "${NOMBRE}" (tipo: ${TIPO}).`);
  } else {
    console.log(`  -> con --apply se crearía como "${NOMBRE}" (tipo: ${TIPO}).`);
  }
} else {
  console.log(`Lote ${LOTE_ID}: "${lote.nombre}" (tipo actual: ${lote.tipo || '—'}).`);
  if (lote.tipo !== TIPO) {
    if (APPLY) {
      await run('UPDATE lotes SET tipo = ? WHERE id = ?', [TIPO, LOTE_ID]);
      console.log(`  -> tipo actualizado a "${TIPO}".`);
    } else {
      console.log(`  -> con --apply se pondría tipo "${TIPO}".`);
    }
  }
}

// 2. Stickers a mover: los últimos N por fecha de creación.
const filtro = FORCE ? '' : 'WHERE lote_id IS NULL';
const candidatos = await all(
  `SELECT id, codigo_publico, uid_nfc, lote_id, creado_en
   FROM stickers ${filtro}
   ORDER BY creado_en DESC, id DESC
   LIMIT ?`,
  [N]
);

console.log(`\n${candidatos.length} sticker(s) a mover al lote ${LOTE_ID}${FORCE ? '' : ' (solo los que hoy no tienen lote)'}:`);
for (const c of candidatos) {
  console.log(`  ${c.codigo_publico}  uid=${c.uid_nfc}  lote_actual=${c.lote_id ?? '—'}  creado=${new Date(c.creado_en).toISOString()}`);
}

if (!candidatos.length) {
  console.log('\nNada para hacer.');
  process.exit(0);
}

if (!APPLY) {
  console.log('\nDRY RUN — nada se escribió. Corré de nuevo con --apply para aplicar.');
  process.exit(0);
}

const ids = candidatos.map((c) => c.id);
await run(
  `UPDATE stickers SET lote_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
  [LOTE_ID, ...ids]
);
const total = await get('SELECT COUNT(*) AS n FROM stickers WHERE lote_id = ?', [LOTE_ID]);
await run('UPDATE lotes SET cantidad = ? WHERE id = ?', [Number(total.n), LOTE_ID]);

console.log(`\nListo. ${ids.length} sticker(s) movidos. El lote ${LOTE_ID} ahora tiene ${total.n} chip(s).`);
process.exit(0);
