import pg from 'pg';
import { randomBytes } from 'node:crypto';

const { Pool } = pg;

// Postgres real — DATABASE_URL es la convención estándar (Render, Railway,
// Supabase, Neon, Heroku... todos la setean así). En local, corré tu propio
// Postgres y poné DATABASE_URL en landing/.env (ver .env.example).
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'Falta DATABASE_URL. Necesitás un Postgres real — local (docker/instalado) o hosteado (ej. Render Postgres) — y poner su connection string en landing/.env.'
  );
}
// La mayoría de los Postgres hosteados (Render, Supabase, Neon, Railway...)
// piden SSL y usan certificados que node no valida por default. localhost no
// lo necesita.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const pool = new Pool({ connectionString, ssl: isLocal ? false : { rejectUnauthorized: false } });

// Traduce placeholders estilo SQLite (`?`) a los de Postgres (`$1, $2...`) —
// así el resto del backend no tiene que cambiar la forma de escribir SQL.
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Todo INSERT devuelve automáticamente el id insertado (Postgres no tiene
// "lastInsertRowid" como SQLite) — excepto `precios`, que no tiene columna id
// (su clave primaria es función+modelo).
function withReturningId(sql) {
  if (/^\s*insert\s+into\s+precios\b/i.test(sql)) return sql;
  if (/^\s*insert\s+into\b/i.test(sql) && !/\breturning\b/i.test(sql)) {
    return `${sql.replace(/;\s*$/, '')} RETURNING id`;
  }
  return sql;
}

export const db = {
  // Acepta un string (DDL / multi-statement, sin params) o {sql, args} — el
  // mismo shape que usaba @libsql/client, para no tener que tocar el resto
  // del backend.
  async execute(input) {
    if (typeof input === 'string') {
      const res = await pool.query(withReturningId(input));
      return { rows: res.rows || [] };
    }
    const { sql, args = [] } = input;
    const text = toPgPlaceholders(withReturningId(sql));
    const res = await pool.query(text, args);
    return { rows: res.rows, rowsAffected: res.rowCount };
  },
  // DDL con varios statements separados por ; (sin params) — node-postgres
  // los corre todos de una con el protocolo simple.
  async executeMultiple(sql) {
    await pool.query(sql);
  },
};

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS compradores (
    id SERIAL PRIMARY KEY,
    whatsapp TEXT UNIQUE,
    nombre TEXT,
    email TEXT,
    google_id TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS vendedores (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    codigo_ref TEXT UNIQUE NOT NULL,
    comision_pct REAL NOT NULL DEFAULT 50,
    telegram_chat_id TEXT,
    whatsapp TEXT UNIQUE,
    password_hash TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Lote de impresión/registro: se da de alta primero, antes de que exista
  -- ningún UID individual — agrupa los chips que se registraron juntos.
  CREATE TABLE IF NOT EXISTS lotes (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    cantidad INTEGER,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Identidad inmutable del chip físico: se inserta una vez al registrar el
  -- UID y nunca se vuelve a tocar. Todo lo que cambia con el tiempo (modelo
  -- asignado, vendedor, comprador, estado) vive versionado en sticker_estados
  -- (SCD tipo 2) — ver más abajo.
  CREATE TABLE IF NOT EXISTS stickers (
    id SERIAL PRIMARY KEY,
    codigo_publico TEXT UNIQUE NOT NULL,
    uid_nfc TEXT UNIQUE,
    lote_id INTEGER REFERENCES lotes(id),
    -- Cuándo se armó el candado físico (AUTH0 escrito) — ver
    -- 01a - Programación física del chip. Vive acá y no en sticker_estados
    -- porque no es un paso del ciclo de vida comercial: es un hecho físico
    -- de una sola dirección, autodeclarado por el admin (el sistema no tiene
    -- lector NFC conectado y nunca puede verificarlo solo).
    protegido_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- SCD tipo 2: una fila por cada estado que tuvo el sticker en su ciclo de
  -- vida (registrado → con modelo → con vendedor → vendido). vigente_hasta
  -- NULL = fila actual; nunca se hace UPDATE de los campos de negocio, se
  -- cierra la fila vieja (vigente_hasta = NOW()) y se inserta una nueva.
  CREATE TABLE IF NOT EXISTS sticker_estados (
    id SERIAL PRIMARY KEY,
    sticker_id INTEGER NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
    etapa TEXT NOT NULL,
    modelo TEXT,
    funcion TEXT,
    vendedor_id INTEGER REFERENCES vendedores(id),
    comprador_id INTEGER REFERENCES compradores(id),
    estado TEXT NOT NULL,
    vigente_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    vigente_hasta TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sticker_estado_actual
    ON sticker_estados(sticker_id) WHERE vigente_hasta IS NULL;

  CREATE TABLE IF NOT EXISTS destinos (
    id SERIAL PRIMARY KEY,
    sticker_id INTEGER NOT NULL UNIQUE REFERENCES stickers(id),
    tipo TEXT NOT NULL,
    valor TEXT NOT NULL,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS historial_cambios (
    id SERIAL PRIMARY KEY,
    sticker_id INTEGER NOT NULL REFERENCES stickers(id),
    comprador_id INTEGER NOT NULL REFERENCES compradores(id),
    campo_modificado TEXT NOT NULL,
    valor_anterior TEXT,
    valor_nuevo TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Una venta es un pago (una preferencia de Mercado Pago) que puede cubrir
  -- varios stickers a la vez — el detalle de qué stickers y con qué destino
  -- cada uno vive en venta_items, no acá.
  CREATE TABLE IF NOT EXISTS ventas (
    id SERIAL PRIMARY KEY,
    vendedor_id INTEGER REFERENCES vendedores(id),
    comprador_id INTEGER REFERENCES compradores(id),
    monto REAL NOT NULL,
    payment_id TEXT,
    estado_pago TEXT NOT NULL DEFAULT 'pendiente',
    comision_liquidada INTEGER NOT NULL DEFAULT 0,
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS venta_items (
    id SERIAL PRIMARY KEY,
    venta_id INTEGER NOT NULL REFERENCES ventas(id),
    sticker_id INTEGER NOT NULL REFERENCES stickers(id),
    monto REAL NOT NULL,
    destino_tipo TEXT,
    destino_valor TEXT
  );

  CREATE TABLE IF NOT EXISTS aceptaciones_tyc (
    id SERIAL PRIMARY KEY,
    sticker_id INTEGER REFERENCES stickers(id),
    comprador_id INTEGER REFERENCES compradores(id),
    version_tyc TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Precio por modelo imprimible (llavero/tarjeta/placa/suelto) — el mismo
  -- precio para cualquier función, editable desde el panel de Admin.
  CREATE TABLE IF NOT EXISTS precios (
    modelo TEXT PRIMARY KEY,
    precio REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otp_sessions (
    id SERIAL PRIMARY KEY,
    whatsapp TEXT NOT NULL,
    codigo_hash TEXT NOT NULL,
    expira TIMESTAMPTZ NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id SERIAL PRIMARY KEY,
    comprador_id INTEGER NOT NULL REFERENCES compradores(id),
    token_hash TEXT NOT NULL UNIQUE,
    expira TIMESTAMPTZ NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS admin_sesiones (
    id SERIAL PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    expira TIMESTAMPTZ NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Login del vendedor: WhatsApp + contraseña (a diferencia del comprador, que
  -- entra con OTP). Mismo patrón de tabla de sesión que sesiones/admin_sesiones.
  CREATE TABLE IF NOT EXISTS vendedor_sesiones (
    id SERIAL PRIMARY KEY,
    vendedor_id INTEGER NOT NULL REFERENCES vendedores(id),
    token_hash TEXT NOT NULL UNIQUE,
    expira TIMESTAMPTZ NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Migraciones defensivas — Postgres soporta "IF NOT EXISTS" nativo en ADD
  -- COLUMN, así que no hace falta inspeccionar el schema a mano como con SQLite.
  ALTER TABLE stickers ADD COLUMN IF NOT EXISTS lote_id INTEGER REFERENCES lotes(id);
  ALTER TABLE stickers ADD COLUMN IF NOT EXISTS protegido_en TIMESTAMPTZ;
  -- Etiqueta libre del lote (ej. "Activación Bloqueada"). Solo informativa —
  -- el comportamiento del tap lo sigue decidiendo esLoteEspecial(uid_nfc).
  ALTER TABLE lotes ADD COLUMN IF NOT EXISTS tipo TEXT;
  ALTER TABLE compradores ADD COLUMN IF NOT EXISTS email TEXT;
  ALTER TABLE compradores ADD COLUMN IF NOT EXISTS google_id TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_compradores_google_id ON compradores(google_id);
  ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS whatsapp TEXT;
  ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS email TEXT;
  ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS password_hash TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vendedores_whatsapp ON vendedores(whatsapp);
  -- El vendedor puede loguearse con email + contraseña (además de whatsapp).
  -- Parcial: filas históricas sin email quedan fuera del índice único.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vendedores_email ON vendedores(LOWER(email)) WHERE email IS NOT NULL;
  ALTER TABLE sticker_estados DROP COLUMN IF EXISTS entregado_en CASCADE;
  -- Token opaco para el link público del vendedor (?s=...), separado del
  -- codigo_ref legible que usa para loguearse/identificarse en su panel —
  -- así no se puede enumerar vendedores cambiando el parámetro en la URL.
  ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS link_token TEXT;
  -- Promociones de venta presencial (ver "Modo de venta 2x1" en el vault).
  -- Cada promo agrupa unidades del mismo modelo de a unidades_pack y
  -- descuenta cada grupo, ya sea por % del precio de lista (pct_lista) o
  -- fijando el total del grupo ('monto_fijo', con montos por modelo en
  -- promocion_montos). El estándar es "no hay promo" — no lleva fila acá.
  CREATE TABLE IF NOT EXISTS promociones (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    unidades_pack INTEGER NOT NULL DEFAULT 2,
    modo_precio TEXT NOT NULL,          -- 'pct_lista' | 'monto_fijo'
    descuento_pct REAL,                 -- solo si modo_precio = 'pct_lista'
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  -- Total del grupo (pack de unidades_pack unidades) para un modelo, cuando
  -- la promo es monto_fijo. Modelo sin fila = la promo no le aplica.
  CREATE TABLE IF NOT EXISTS promocion_montos (
    promocion_id INTEGER NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
    modelo TEXT NOT NULL,
    monto_pack REAL NOT NULL,
    PRIMARY KEY (promocion_id, modelo)
  );
  -- Un token de link presencial por (vendedor, promo). Es la contracara
  -- física de cada cara del llavero del vendedor: cada promo activa le da al
  -- vendedor un link propio, aparte del común (vendedores.link_token). El modo
  -- no viaja editable en la URL: entrar por este token es lo que fija la promo.
  CREATE TABLE IF NOT EXISTS vendedor_promo_tokens (
    id SERIAL PRIMARY KEY,
    vendedor_id INTEGER NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
    promocion_id INTEGER NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    UNIQUE (vendedor_id, promocion_id)
  );
  -- Promo con la que se cerró la venta (NULL = venta estándar).
  ALTER TABLE ventas ADD COLUMN IF NOT EXISTS promocion_id INTEGER REFERENCES promociones(id);
  -- Limpieza de una iteración anterior (columnas efímeras, nunca tuvieron datos
  -- de valor): el modo de venta ahora es ventas.promocion_id + vendedor_promo_tokens.
  ALTER TABLE vendedores DROP COLUMN IF EXISTS link_token_2x1;
  ALTER TABLE ventas DROP COLUMN IF EXISTS modo_venta;
  -- Canal por el que se emitió cada OTP ('email' | 'whatsapp'). Las filas
  -- previas a este cambio quedan NULL: eran todas por whatsapp.
  ALTER TABLE otp_sessions ADD COLUMN IF NOT EXISTS canal TEXT;
  -- El comprador puede identificarse por email (canal de verificación email),
  -- no solo por whatsapp. Índice para el lookup del login; parcial porque hay
  -- filas históricas con email NULL.
  CREATE INDEX IF NOT EXISTS idx_compradores_email ON compradores(email) WHERE email IS NOT NULL;
  -- Alias o CVU de Mercado Pago del vendedor, para liquidarle la comisión por
  -- transferencia. Solo dato de contacto de pago — no se valida contra MP.
  ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS alias_mp TEXT;
  -- Liquidación de comisión: número de operación de la transferencia y cuándo
  -- se hizo. Se completan al confirmar la liquidación desde el panel de Admin.
  ALTER TABLE ventas ADD COLUMN IF NOT EXISTS liquidacion_ref TEXT;
  ALTER TABLE ventas ADD COLUMN IF NOT EXISTS liquidada_en TIMESTAMPTZ;
`);

// Backfill: todo vendedor que no tenga link_token (altas previas a este
// cambio) recibe uno random antes de crear el índice único de abajo.
const vendedoresSinToken = (
  await db.execute('SELECT id FROM vendedores WHERE link_token IS NULL')
).rows;
for (const v of vendedoresSinToken) {
  await db.execute({
    sql: 'UPDATE vendedores SET link_token = ? WHERE id = ?',
    args: [randomBytes(6).toString('hex'), v.id],
  });
}

await db.executeMultiple(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vendedores_link_token ON vendedores(link_token);
`);

// Seed de las promos base. Idempotente (ON CONFLICT sobre el slug) — editar
// montos/porcentajes después se hace desde la base, no acá.
await db.executeMultiple(`
  INSERT INTO promociones (slug, nombre, unidades_pack, modo_precio, descuento_pct)
  VALUES
    ('2x1', '2x1', 2, 'pct_lista', 50),
    ('2x30', '2 x 30k', 2, 'monto_fijo', NULL)
  ON CONFLICT (slug) DO NOTHING;

  INSERT INTO promocion_montos (promocion_id, modelo, monto_pack)
  SELECT p.id, 'llavero', 30000 FROM promociones p WHERE p.slug = '2x30'
  ON CONFLICT (promocion_id, modelo) DO NOTHING;
`);

// Backfill de tokens: un token por cada (vendedor, promo activa) que todavía
// no lo tenga. Corre también cuando se agrega una promo nueva o un vendedor
// nuevo (el alta de vendedor además lo hace en el endpoint, para no depender
// de un reinicio).
const paresSinToken = (
  await db.execute(`
    SELECT v.id AS vendedor_id, p.id AS promocion_id
    FROM vendedores v CROSS JOIN promociones p
    WHERE p.activa
      AND NOT EXISTS (
        SELECT 1 FROM vendedor_promo_tokens t
        WHERE t.vendedor_id = v.id AND t.promocion_id = p.id
      )
  `)
).rows;
for (const par of paresSinToken) {
  await db.execute({
    sql: 'INSERT INTO vendedor_promo_tokens (vendedor_id, promocion_id, token) VALUES (?, ?, ?)',
    args: [par.vendedor_id, par.promocion_id, randomBytes(6).toString('hex')],
  });
}

// Migración de datos: si `stickers` todavía tiene las columnas viejas
// (mutables) de una versión pre-SCD, movemos el estado actual de cada fila a
// sticker_estados antes de eliminarlas — así no se pierde el inventario ya
// cargado en producción al pasar al modelo versionado.
const columnasViejas = (
  await db.execute(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'stickers' AND column_name IN ('estado', 'modelo', 'funcion', 'vendedor_id', 'comprador_id')`
  )
).rows.map((r) => r.column_name);

if (columnasViejas.length > 0) {
  const filas = (
    await db.execute(
      'SELECT id, comprador_id, vendedor_id, estado, modelo, funcion FROM stickers ORDER BY id'
    )
  ).rows;
  for (const s of filas) {
    const etapa = s.comprador_id ? 'vendido' : s.vendedor_id ? 'en_vendedor' : s.modelo ? 'con_modelo' : 'en_lote';
    await db.execute({
      sql: `INSERT INTO sticker_estados (sticker_id, etapa, modelo, funcion, vendedor_id, comprador_id, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [s.id, etapa, s.modelo, s.funcion, s.vendedor_id, s.comprador_id, s.estado || 'en_stock'],
    });
  }
  await db.executeMultiple(`
    ALTER TABLE stickers DROP COLUMN IF EXISTS comprador_id;
    ALTER TABLE stickers DROP COLUMN IF EXISTS vendedor_id;
    ALTER TABLE stickers DROP COLUMN IF EXISTS estado;
    ALTER TABLE stickers DROP COLUMN IF EXISTS modelo;
    ALTER TABLE stickers DROP COLUMN IF EXISTS funcion;
  `);
  console.log(`[migración SCD] ${filas.length} sticker(s) migrados de columnas mutables a sticker_estados.`);
}

// Migración de datos: `precios` pasó de un valor por función+modelo a un
// valor único por modelo — si la tabla todavía tiene la columna `funcion`,
// colapsamos a una fila por modelo (privilegiando el precio de whatsapp, que
// hoy siempre coincide con el resto) antes de tirar la columna vieja.
const preciosConFuncion = (
  await db.execute(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'precios' AND column_name = 'funcion'`
  )
).rows;
if (preciosConFuncion.length > 0) {
  const filas = (
    await db.execute(`SELECT DISTINCT ON (modelo) modelo, precio FROM precios ORDER BY modelo, (funcion = 'whatsapp') DESC`)
  ).rows;
  await db.executeMultiple('CREATE TABLE IF NOT EXISTS tmp_precios_migracion (modelo TEXT PRIMARY KEY, precio REAL NOT NULL);');
  for (const f of filas) {
    await db.execute({
      sql: 'INSERT INTO tmp_precios_migracion (modelo, precio) VALUES (?, ?) ON CONFLICT (modelo) DO NOTHING RETURNING modelo',
      args: [f.modelo, f.precio],
    });
  }
  await db.executeMultiple('DROP TABLE precios; ALTER TABLE tmp_precios_migracion RENAME TO precios;');
  console.log(`[migración precios] tabla precios pasó de función+modelo a un precio único por modelo (${filas.length} modelos).`);
}

// Vista de lectura: expone el estado ACTUAL de cada sticker (identidad +
// última fila vigente de sticker_estados) con los mismos nombres de columna
// que tenía la tabla `stickers` antes de la migración — así casi todo el
// backend sigue leyendo con un SELECT normal, solo escribe distinto.
// protegido_en va al final del SELECT a propósito: CREATE OR REPLACE VIEW en
// Postgres no permite reordenar/insertar columnas en el medio de una vista ya
// existente, solo agregar al final (si no, tira "cannot change name of view
// column" contra la posición que ocupaba antes creado_en).
await db.executeMultiple(`
  CREATE OR REPLACE VIEW stickers_actual AS
  SELECT st.id, st.codigo_publico, st.uid_nfc, st.lote_id, st.creado_en,
         se.etapa, se.modelo, se.funcion, se.vendedor_id, se.comprador_id, se.estado, se.vigente_desde,
         st.protegido_en
  FROM stickers st
  JOIN sticker_estados se ON se.sticker_id = st.id AND se.vigente_hasta IS NULL;
`);

// Precarga un precio por modelo — el admin lo puede editar después desde el panel.
const PRECIOS_DEFAULT_POR_MODELO = { llavero: 8500, tarjeta: 7500, placa: 11000, suelto: 4500 };
const preciosExistentes = (await db.execute('SELECT COUNT(*) AS n FROM precios')).rows[0].n;
if (Number(preciosExistentes) === 0) {
  for (const [modelo, precio] of Object.entries(PRECIOS_DEFAULT_POR_MODELO)) {
    await db.execute({ sql: 'INSERT INTO precios (modelo, precio) VALUES (?, ?)', args: [modelo, precio] });
  }
}
