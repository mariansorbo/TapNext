import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Local dev: archivo SQLite en disco. Producción: apuntá TURSO_DATABASE_URL +
// TURSO_AUTH_TOKEN (cuenta gratis en turso.tech) para persistencia real —
// sin esas variables, sigue funcionando local pero se resetea si el host
// tiene disco efímero (ej. Render free tier).
const localDbPath = resolve(fileURLToPath(new URL('.', import.meta.url)), 'data.sqlite');
const dbUrl = process.env.TURSO_DATABASE_URL || `file:${localDbPath}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

export const db = createClient({ url: dbUrl, authToken });

await db.executeMultiple(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS compradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    whatsapp TEXT UNIQUE,
    nombre TEXT,
    email TEXT,
    google_id TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vendedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    codigo_ref TEXT UNIQUE NOT NULL,
    comision_pct REAL NOT NULL DEFAULT 50,
    telegram_chat_id TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stickers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_publico TEXT UNIQUE NOT NULL,
    uid_nfc TEXT UNIQUE,
    comprador_id INTEGER REFERENCES compradores(id),
    vendedor_id INTEGER REFERENCES vendedores(id),
    estado TEXT NOT NULL DEFAULT 'en_stock',
    modelo TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS destinos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sticker_id INTEGER NOT NULL UNIQUE REFERENCES stickers(id),
    tipo TEXT NOT NULL,
    valor TEXT NOT NULL,
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS historial_cambios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sticker_id INTEGER NOT NULL REFERENCES stickers(id),
    comprador_id INTEGER NOT NULL REFERENCES compradores(id),
    campo_modificado TEXT NOT NULL,
    valor_anterior TEXT,
    valor_nuevo TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sticker_id INTEGER REFERENCES stickers(id),
    vendedor_id INTEGER REFERENCES vendedores(id),
    comprador_id INTEGER REFERENCES compradores(id),
    monto REAL NOT NULL,
    payment_id TEXT,
    estado_pago TEXT NOT NULL DEFAULT 'pendiente',
    comision_liquidada INTEGER NOT NULL DEFAULT 0,
    fecha TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS aceptaciones_tyc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sticker_id INTEGER REFERENCES stickers(id),
    comprador_id INTEGER REFERENCES compradores(id),
    version_tyc TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS otp_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    whatsapp TEXT NOT NULL,
    codigo_hash TEXT NOT NULL,
    expira TEXT NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comprador_id INTEGER NOT NULL REFERENCES compradores(id),
    token_hash TEXT NOT NULL UNIQUE,
    expira TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    expira TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migraciones defensivas — por si esto corre contra una base creada con una
// versión anterior del schema (ej. antes de que vendedor_id existiera).
async function columnNames(table) {
  const res = await db.execute(`PRAGMA table_info(${table})`);
  return res.rows.map((r) => r.name);
}

const stickerCols = await columnNames('stickers');
if (!stickerCols.includes('vendedor_id')) {
  await db.execute('ALTER TABLE stickers ADD COLUMN vendedor_id INTEGER REFERENCES vendedores(id)');
}

const compradorCols = await columnNames('compradores');
if (!compradorCols.includes('email')) {
  await db.execute('ALTER TABLE compradores ADD COLUMN email TEXT');
}
if (!compradorCols.includes('google_id')) {
  await db.execute('ALTER TABLE compradores ADD COLUMN google_id TEXT');
}
await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_compradores_google_id ON compradores(google_id)');
