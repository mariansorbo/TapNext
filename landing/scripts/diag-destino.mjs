// node --env-file=.env scripts/diag-destino.mjs [codigo]
import pg from 'pg';

const cs = process.env.DATABASE_URL;
if (!cs) throw new Error('Falta DATABASE_URL (corré con: node --env-file=.env scripts/diag-destino.mjs)');
const pool = new pg.Pool({ connectionString: cs, ssl: /localhost|127\.0\.0\.1/.test(cs) ? false : { rejectUnauthorized: false } });

const codigo = process.argv[2] || null;
const show = async (label, sql, args = []) => {
  const { rows } = await pool.query(sql, args);
  console.log(`\n=== ${label} ===`);
  console.dir(rows, { depth: null });
};

if (codigo) {
  await show(`sticker ${codigo}`,
    `SELECT id, codigo_publico, uid_nfc, etapa, modelo, funcion, estado, vendedor_id, comprador_id
     FROM stickers_actual WHERE codigo_publico = ?`.replace('?', '$1'), [codigo]);
  await show(`destino de ${codigo}`,
    `SELECT d.* FROM destinos d JOIN stickers s ON s.id = d.sticker_id WHERE s.codigo_publico = $1`, [codigo]);
} else {
  await show('stickers_actual (ult. 10)',
    `SELECT id, codigo_publico, uid_nfc, etapa, modelo, funcion, estado, comprador_id FROM stickers_actual ORDER BY id DESC LIMIT 10`);
  await show('destinos (todos)',
    `SELECT d.*, s.codigo_publico FROM destinos d JOIN stickers s ON s.id = d.sticker_id ORDER BY d.actualizado_en DESC`);
  await show('compradores (ult. 5)',
    `SELECT id, email, whatsapp, creado_en FROM compradores ORDER BY id DESC LIMIT 5`);
  await show('ventas (ult. 5)',
    `SELECT id, comprador_id, vendedor_id, monto, estado_pago, payment_id, fecha FROM ventas ORDER BY id DESC LIMIT 5`);
  await show('venta_items (ult. 5)',
    `SELECT * FROM venta_items ORDER BY id DESC LIMIT 5`);
}

await pool.end();
