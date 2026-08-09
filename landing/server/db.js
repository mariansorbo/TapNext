import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const dbPath = resolve(fileURLToPath(new URL('.', import.meta.url)), 'data.sqlite');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS compradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    whatsapp TEXT UNIQUE NOT NULL,
    nombre TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stickers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_publico TEXT UNIQUE NOT NULL,
    uid_nfc TEXT UNIQUE,
    comprador_id INTEGER REFERENCES compradores(id),
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
`);

// Migración: mail de respaldo opcional, agregado después de la tabla original.
let compradorColumns = db.prepare('PRAGMA table_info(compradores)').all();
if (!compradorColumns.some((col) => col.name === 'email')) {
  db.exec('ALTER TABLE compradores ADD COLUMN email TEXT');
  compradorColumns = db.prepare('PRAGMA table_info(compradores)').all();
}

// Migración: login opcional con Google — una cuenta ya no depende únicamente
// del WhatsApp, así que ese campo pasa a ser opcional (SQLite no permite
// aflojar un NOT NULL con ALTER, hay que reconstruir la tabla).
const whatsappCol = compradorColumns.find((col) => col.name === 'whatsapp');
if (whatsappCol?.notnull) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE compradores_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp TEXT UNIQUE,
      nombre TEXT,
      email TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO compradores_new (id, whatsapp, nombre, email, creado_en)
      SELECT id, whatsapp, nombre, email, creado_en FROM compradores;
    DROP TABLE compradores;
    ALTER TABLE compradores_new RENAME TO compradores;
    PRAGMA foreign_keys = ON;
  `);
  compradorColumns = db.prepare('PRAGMA table_info(compradores)').all();
}
if (!compradorColumns.some((col) => col.name === 'google_id')) {
  db.exec('ALTER TABLE compradores ADD COLUMN google_id TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_compradores_google_id ON compradores(google_id)');
