// node --env-file=.env scripts/fix-destino-l1otra.mjs
// Arregla el destino del sticker l1otra: '_fabridiazz/instagram.com' (sin https://,
// se resolvía como ruta relativa -> 404) -> 'https://instagram.com/_fabridiazz'.
import pg from 'pg';

const cs = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });

const antes = (await pool.query(
  `SELECT d.id, d.tipo, d.valor FROM destinos d JOIN stickers s ON s.id = d.sticker_id WHERE s.codigo_publico = 'l1otra'`
)).rows;
console.log('ANTES:', antes);

const res = await pool.query(
  `UPDATE destinos SET valor = 'https://instagram.com/_fabridiazz', actualizado_en = NOW()
   WHERE sticker_id = (SELECT id FROM stickers WHERE codigo_publico = 'l1otra')
   RETURNING id, tipo, valor, actualizado_en`
);
console.log('DESPUES:', res.rows);

await pool.end();
