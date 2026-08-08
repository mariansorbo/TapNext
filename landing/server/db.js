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
const compradorColumns = db.prepare('PRAGMA table_info(compradores)').all();
if (!compradorColumns.some((col) => col.name === 'email')) {
  db.exec('ALTER TABLE compradores ADD COLUMN email TEXT');
}
