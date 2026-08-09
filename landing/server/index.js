import express from 'express';
import cors from 'cors';
import { randomBytes, createHmac } from 'node:crypto';
import { db } from './db.js';
import { generateOtp, hashValue, generateToken } from './otp.js';

const PORT = process.env.PORT || 3001;
const OTP_TTL_MINUTES = 5;
const OTP_THROTTLE_SECONDS = 30;
const SESSION_TTL_MINUTES = 30;
const DESTINO_TIPOS = ['whatsapp', 'instagram', 'pago', 'menu', 'review', 'web', 'agenda', 'linktree'];

// Login con Google — opcional, alternativo al WhatsApp+OTP (no lo reemplaza).
// Queda invisible hasta que se carguen estas tres variables de entorno.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const GOOGLE_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
const GOOGLE_STATE_TTL_MS = 5 * 60_000;
const googleStates = new Map(); // state -> expira (ms) — CSRF del flujo OAuth, en memoria alcanza para esta escala

// Admin — login simple por contraseña compartida (el documento de requerimientos
// original dejaba esto "no definido"; esta es una decisión pragmática de MVP,
// pensada para un solo admin). Sin ADMIN_PASSWORD configurada, el panel queda
// inaccesible (no hay contraseña default).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SESSION_TTL_MINUTES = 60;

// Programación de chips en el taller (RS-01/RS-02): la clave de escritura de
// cada chip se DERIVA de secreto_maestro + uid_nfc — nunca se guarda en la
// base por chip. El único dato sensible a proteger es este secreto único.
const CHIP_MASTER_SECRET = process.env.CHIP_MASTER_SECRET || '';
// URL pública del router (este mismo backend) — es lo que se graba en el chip.
const PUBLIC_ROUTER_BASE = process.env.PUBLIC_ROUTER_BASE || `http://localhost:${process.env.PORT || 3001}`;

function deriveChipPassword(uidNfc) {
  // Hex de 8 bytes — el software de programación del chip suele necesitar
  // recortar/adaptar esto al tamaño exacto que pida su PWD_AUTH (ej. NTAG
  // 213/215/216 usa PWD de 4 bytes). La fórmula es lo que importa: siempre
  // reproducible a partir del secreto maestro + el UID, nunca almacenada.
  return createHmac('sha256', CHIP_MASTER_SECRET).update(uidNfc).digest('hex').slice(0, 16);
}

const app = express();
app.use(cors());
app.use(express.json());

function isoInMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function generateCodigoPublico() {
  // No secuencial (RS-03) — evita que se puedan barrer URLs tipo /v/A100, /v/A101...
  return randomBytes(5).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase();
}
function generateUidNfc() {
  return randomBytes(4).toString('hex');
}

async function get(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows[0] || null;
}
async function all(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows;
}
async function run(sql, args = []) {
  const res = await db.execute({ sql, args });
  return { lastInsertRowid: Number(res.lastInsertRowid || 0), rowsAffected: res.rowsAffected };
}

// --- Auth: WhatsApp + OTP, no passwords (RF-12/RF-13) ---

app.post('/api/auth/otp/request', async (req, res) => {
  const whatsapp = String(req.body?.whatsapp || '').trim();
  if (!whatsapp) return res.status(400).json({ error: 'Falta el WhatsApp.' });

  const recent = await get(
    `SELECT id FROM otp_sessions WHERE whatsapp = ? AND usado = 0 AND creado_en > datetime('now', ?) ORDER BY id DESC LIMIT 1`,
    [whatsapp, `-${OTP_THROTTLE_SECONDS} seconds`]
  );
  if (recent) {
    return res.status(429).json({ error: 'Esperá unos segundos antes de pedir otro código.' });
  }

  const code = generateOtp();
  await run('INSERT INTO otp_sessions (whatsapp, codigo_hash, expira) VALUES (?, ?, ?)', [
    whatsapp,
    hashValue(code),
    isoInMinutes(OTP_TTL_MINUTES),
  ]);

  // No hay integración real con WhatsApp Business API todavía — simulamos el envío.
  console.log(`[OTP demo] Código para ${whatsapp}: ${code} (expira en ${OTP_TTL_MINUTES} min)`);

  // DEV ONLY: nunca devolver el código en la respuesta en producción — acá reemplaza
  // al envío real por WhatsApp mientras no haya esa integración conectada.
  res.json({ ok: true, debug_otp: code });
});

app.post('/api/auth/otp/verify', async (req, res) => {
  const whatsapp = String(req.body?.whatsapp || '').trim();
  const code = String(req.body?.code || '').trim();
  if (!whatsapp || !code) return res.status(400).json({ error: 'Faltan datos.' });

  const otp = await get(
    `SELECT * FROM otp_sessions WHERE whatsapp = ? AND usado = 0 AND expira > datetime('now') ORDER BY id DESC LIMIT 1`,
    [whatsapp]
  );

  if (!otp || otp.codigo_hash !== hashValue(code)) {
    return res.status(401).json({ error: 'Código inválido o expirado.' });
  }

  await run('UPDATE otp_sessions SET usado = 1 WHERE id = ?', [otp.id]);

  let comprador = await get('SELECT * FROM compradores WHERE whatsapp = ?', [whatsapp]);
  if (!comprador) {
    const result = await run('INSERT INTO compradores (whatsapp) VALUES (?)', [whatsapp]);
    comprador = await get('SELECT * FROM compradores WHERE id = ?', [result.lastInsertRowid]);
  }

  const token = generateToken();
  await run('INSERT INTO sesiones (comprador_id, token_hash, expira) VALUES (?, ?, ?)', [
    comprador.id,
    hashValue(token),
    isoInMinutes(SESSION_TTL_MINUTES),
  ]);

  res.json({
    token,
    comprador: { id: comprador.id, whatsapp: comprador.whatsapp, nombre: comprador.nombre, email: comprador.email },
  });
});

app.get('/api/auth/config', (req, res) => {
  res.json({ googleEnabled: GOOGLE_ENABLED });
});

app.get('/api/auth/google/start', (req, res) => {
  if (!GOOGLE_ENABLED) {
    return res.redirect(`${FRONTEND_URL}/mi-panel.html?google_error=not_configured`);
  }
  const state = generateToken();
  googleStates.set(state, Date.now() + GOOGLE_STATE_TTL_MS);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const stateExpira = googleStates.get(state);
  googleStates.delete(state);

  if (!GOOGLE_ENABLED || !code || !stateExpira || stateExpira < Date.now()) {
    return res.redirect(`${FRONTEND_URL}/mi-panel.html?google_error=invalid_state`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error || 'No se pudo canjear el código de Google.');

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profileRes.ok || !profile.sub) throw new Error('No se pudo leer el perfil de Google.');

    let comprador = await get('SELECT * FROM compradores WHERE google_id = ?', [profile.sub]);
    if (!comprador && profile.email) {
      comprador = await get('SELECT * FROM compradores WHERE email = ?', [profile.email]);
      if (comprador) {
        await run('UPDATE compradores SET google_id = ? WHERE id = ?', [profile.sub, comprador.id]);
      }
    }
    if (!comprador) {
      const result = await run('INSERT INTO compradores (google_id, email, nombre) VALUES (?, ?, ?)', [
        profile.sub,
        profile.email || null,
        profile.name || null,
      ]);
      comprador = await get('SELECT * FROM compradores WHERE id = ?', [result.lastInsertRowid]);
    }

    const token = generateToken();
    await run('INSERT INTO sesiones (comprador_id, token_hash, expira) VALUES (?, ?, ?)', [
      comprador.id,
      hashValue(token),
      isoInMinutes(SESSION_TTL_MINUTES),
    ]);

    res.redirect(`${FRONTEND_URL}/mi-panel.html?token=${token}`);
  } catch (err) {
    console.error('[Google OAuth] error:', err.message);
    res.redirect(`${FRONTEND_URL}/mi-panel.html?google_error=server_error`);
  }
});

app.delete('/api/auth/session', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) await run('DELETE FROM sesiones WHERE token_hash = ?', [hashValue(token)]);
  res.status(204).end();
});

// RF-15b: la sesión de edición expira tras inactividad corta — ventana deslizante.
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Falta autenticación.' });

  const tokenHash = hashValue(token);
  const sesion = await get(`SELECT * FROM sesiones WHERE token_hash = ? AND expira > datetime('now')`, [tokenHash]);
  if (!sesion) return res.status(401).json({ error: 'Sesión inválida o expirada.' });

  await run('UPDATE sesiones SET expira = ? WHERE id = ?', [isoInMinutes(SESSION_TTL_MINUTES), sesion.id]);

  req.comprador = await get('SELECT * FROM compradores WHERE id = ?', [sesion.comprador_id]);
  next();
}

// --- Panel del comprador (/mi-panel) ---

app.get('/api/me', requireAuth, (req, res) => {
  const { id, whatsapp, nombre, email } = req.comprador;
  res.json({ id, whatsapp, nombre, email });
});

// Mail de respaldo opcional — no se usa para loguearse, solo para avisos y recuperación
// si el número de WhatsApp deja de estar en manos de su dueño original.
app.patch('/api/me', requireAuth, async (req, res) => {
  const email = String(req.body?.email ?? '').trim();
  if (email && !email.includes('@')) {
    return res.status(400).json({ error: 'Ese mail no parece válido.' });
  }
  await run('UPDATE compradores SET email = ? WHERE id = ?', [email || null, req.comprador.id]);
  const actualizado = await get('SELECT id, whatsapp, nombre, email FROM compradores WHERE id = ?', [
    req.comprador.id,
  ]);
  res.json(actualizado);
});

app.get('/api/me/stickers', requireAuth, async (req, res) => {
  const rows = await all(
    `SELECT s.id, s.codigo_publico, s.estado, s.modelo, d.tipo AS destino_tipo, d.valor AS destino_valor, d.actualizado_en AS destino_actualizado_en
       FROM stickers s
       LEFT JOIN destinos d ON d.sticker_id = s.id
       WHERE s.comprador_id = ?
       ORDER BY s.id`,
    [req.comprador.id]
  );

  res.json(
    rows.map((r) => ({
      id: r.id,
      codigoPublico: r.codigo_publico,
      estado: r.estado,
      modelo: r.modelo,
      destino: r.destino_tipo ? { tipo: r.destino_tipo, valor: r.destino_valor, actualizadoEn: r.destino_actualizado_en } : null,
    }))
  );
});

app.patch('/api/stickers/:id/destino', requireAuth, async (req, res) => {
  const stickerId = Number(req.params.id);
  const tipo = String(req.body?.tipo || '').trim();
  const valor = String(req.body?.valor || '').trim();

  if (!DESTINO_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de destino inválido.' });
  if (!valor) return res.status(400).json({ error: 'Falta el valor del destino.' });

  const sticker = await get('SELECT * FROM stickers WHERE id = ? AND comprador_id = ?', [stickerId, req.comprador.id]);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (sticker.estado !== 'activo') {
    return res.status(400).json({ error: 'Este sticker todavía no está activado.' });
  }

  const anterior = await get('SELECT * FROM destinos WHERE sticker_id = ?', [stickerId]);

  await db.execute({
    sql: `INSERT INTO destinos (sticker_id, tipo, valor, actualizado_en) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(sticker_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, actualizado_en = datetime('now')`,
    args: [stickerId, tipo, valor],
  });

  await run(
    `INSERT INTO historial_cambios (sticker_id, comprador_id, campo_modificado, valor_anterior, valor_nuevo)
     VALUES (?, ?, 'destino', ?, ?)`,
    [stickerId, req.comprador.id, anterior ? `${anterior.tipo}:${anterior.valor}` : null, `${tipo}:${valor}`]
  );

  // No hay integración real de mail todavía — simulamos el aviso si el comprador cargó uno de respaldo.
  if (req.comprador.email) {
    console.log(
      `[Email demo] Aviso a ${req.comprador.email}: cambiaste el destino del sticker ${sticker.codigo_publico} a "${tipo}: ${valor}".`
    );
  }

  const actualizado = await get('SELECT * FROM destinos WHERE sticker_id = ?', [stickerId]);
  res.json({ tipo: actualizado.tipo, valor: actualizado.valor, actualizadoEn: actualizado.actualizado_en });
});

// --- Admin (/admin) — inventario, vendedores, ventas, comisiones ---
// RF-22: separación de permisos — el admin NO tiene, por diseño, ningún
// endpoint para leer o editar el destino configurado por un comprador.

app.post('/api/admin/login', async (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'El panel de admin todavía no está configurado.' });
  const password = String(req.body?.password || '');
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta.' });

  const token = generateToken();
  await run('INSERT INTO admin_sesiones (token_hash, expira) VALUES (?, ?)', [
    hashValue(token),
    isoInMinutes(ADMIN_SESSION_TTL_MINUTES),
  ]);
  res.json({ token });
});

app.delete('/api/admin/session', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) await run('DELETE FROM admin_sesiones WHERE token_hash = ?', [hashValue(token)]);
  res.status(204).end();
});

async function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Falta autenticación.' });

  const tokenHash = hashValue(token);
  const sesion = await get(`SELECT * FROM admin_sesiones WHERE token_hash = ? AND expira > datetime('now')`, [
    tokenHash,
  ]);
  if (!sesion) return res.status(401).json({ error: 'Sesión inválida o expirada.' });

  await run('UPDATE admin_sesiones SET expira = ? WHERE id = ?', [isoInMinutes(ADMIN_SESSION_TTL_MINUTES), sesion.id]);
  next();
}

app.get('/api/admin/vendedores', requireAdmin, async (req, res) => {
  const vendedores = await all(`
    SELECT v.*,
      (SELECT COUNT(*) FROM stickers s WHERE s.vendedor_id = v.id) AS stock_total,
      (SELECT COUNT(*) FROM stickers s WHERE s.vendedor_id = v.id AND s.estado = 'en_stock') AS stock_disponible
    FROM vendedores v ORDER BY v.id
  `);
  res.json(
    vendedores.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      codigoRef: v.codigo_ref,
      comisionPct: v.comision_pct,
      stockTotal: v.stock_total,
      stockDisponible: v.stock_disponible,
    }))
  );
});

app.post('/api/admin/vendedores', requireAdmin, async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const codigoRef = String(req.body?.codigoRef || '').trim().toLowerCase();
  const comisionPct = Number(req.body?.comisionPct ?? 50);

  if (!nombre || !codigoRef) return res.status(400).json({ error: 'Faltan datos.' });
  if (!/^[a-z0-9-]+$/.test(codigoRef)) {
    return res.status(400).json({ error: 'El código de referencia solo puede tener letras, números y guiones.' });
  }

  const existe = await get('SELECT id FROM vendedores WHERE codigo_ref = ?', [codigoRef]);
  if (existe) return res.status(409).json({ error: 'Ya existe un vendedor con ese código de referencia.' });

  const result = await run('INSERT INTO vendedores (nombre, codigo_ref, comision_pct) VALUES (?, ?, ?)', [
    nombre,
    codigoRef,
    comisionPct,
  ]);
  res.status(201).json({ id: result.lastInsertRowid, nombre, codigoRef, comisionPct });
});

app.get('/api/admin/stickers', requireAdmin, async (req, res) => {
  const rows = await all(`
    SELECT s.id, s.codigo_publico, s.uid_nfc, s.estado, s.modelo, s.creado_en,
      v.nombre AS vendedor_nombre, v.codigo_ref AS vendedor_ref,
      c.whatsapp AS comprador_whatsapp, c.nombre AS comprador_nombre
    FROM stickers s
    LEFT JOIN vendedores v ON v.id = s.vendedor_id
    LEFT JOIN compradores c ON c.id = s.comprador_id
    ORDER BY s.id DESC
  `);
  res.json(
    rows.map((r) => ({
      id: r.id,
      codigoPublico: r.codigo_publico,
      uidNfc: r.uid_nfc,
      estado: r.estado,
      modelo: r.modelo,
      creadoEn: r.creado_en,
      vendedor: r.vendedor_nombre ? { nombre: r.vendedor_nombre, codigoRef: r.vendedor_ref } : null,
      comprador: r.comprador_whatsapp ? { whatsapp: r.comprador_whatsapp, nombre: r.comprador_nombre } : null,
    }))
  );
});

const MODELOS = ['llavero', 'tarjeta', 'placa'];

app.post('/api/admin/stickers/batch', requireAdmin, async (req, res) => {
  const cantidad = Math.min(Math.max(Number(req.body?.cantidad) || 0, 1), 100);
  const modelo = String(req.body?.modelo || '').trim();
  const vendedorId = req.body?.vendedorId ? Number(req.body.vendedorId) : null;

  if (!MODELOS.includes(modelo)) return res.status(400).json({ error: 'Modelo inválido.' });
  if (vendedorId) {
    const vendedor = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });
  }

  const creados = [];
  for (let i = 0; i < cantidad; i++) {
    const codigoPublico = generateCodigoPublico();
    const uidNfc = generateUidNfc();
    const result = await run(
      'INSERT INTO stickers (codigo_publico, uid_nfc, vendedor_id, estado, modelo) VALUES (?, ?, ?, ?, ?)',
      [codigoPublico, uidNfc, vendedorId, 'en_stock', modelo]
    );
    creados.push({ id: result.lastInsertRowid, codigoPublico, uidNfc });
  }

  res.status(201).json({ creados });
});

// Alta individual "de taller": partís de un uid_nfc real (leído del chip físico)
// en vez de generarlo al azar. Devuelve la clave de escritura derivada UNA
// SOLA VEZ, para programar el chip en el momento — no se guarda en ningún lado.
app.post('/api/admin/stickers/individual', requireAdmin, async (req, res) => {
  if (!CHIP_MASTER_SECRET) {
    return res.status(503).json({ error: 'Configurá CHIP_MASTER_SECRET antes de dar de alta chips reales.' });
  }
  const uidNfc = String(req.body?.uidNfc || '').trim();
  const modelo = String(req.body?.modelo || '').trim();
  const vendedorId = req.body?.vendedorId ? Number(req.body.vendedorId) : null;

  if (!uidNfc) return res.status(400).json({ error: 'Falta el UID del chip.' });
  if (!MODELOS.includes(modelo)) return res.status(400).json({ error: 'Modelo inválido.' });
  if (vendedorId) {
    const vendedor = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });
  }

  const existente = await get('SELECT id FROM stickers WHERE uid_nfc = ?', [uidNfc]);
  if (existente) return res.status(409).json({ error: 'Ese UID ya está registrado.' });

  const codigoPublico = generateCodigoPublico();
  const writePassword = deriveChipPassword(uidNfc);
  const result = await run(
    'INSERT INTO stickers (codigo_publico, uid_nfc, vendedor_id, estado, modelo) VALUES (?, ?, ?, ?, ?)',
    [codigoPublico, uidNfc, vendedorId, 'en_stock', modelo]
  );

  res.status(201).json({
    id: result.lastInsertRowid,
    codigoPublico,
    uidNfc,
    url: `${PUBLIC_ROUTER_BASE}/v/${codigoPublico}`,
    writePassword,
  });
});

app.patch('/api/admin/stickers/:id/asignar', requireAdmin, async (req, res) => {
  const stickerId = Number(req.params.id);
  const vendedorId = Number(req.body?.vendedorId);

  const sticker = await get('SELECT * FROM stickers WHERE id = ?', [stickerId]);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (sticker.estado !== 'en_stock') {
    return res.status(400).json({ error: 'Solo se puede reasignar stock que todavía no fue vendido.' });
  }
  const vendedor = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
  if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });

  await run('UPDATE stickers SET vendedor_id = ? WHERE id = ?', [vendedorId, stickerId]);
  res.json({ ok: true });
});

app.get('/api/admin/ventas', requireAdmin, async (req, res) => {
  const conditions = [];
  const args = [];
  if (req.query.vendedorId) {
    conditions.push('ve.vendedor_id = ?');
    args.push(Number(req.query.vendedorId));
  }
  if (req.query.desde) {
    conditions.push('ve.fecha >= ?');
    args.push(String(req.query.desde));
  }
  if (req.query.hasta) {
    conditions.push('ve.fecha <= ?');
    args.push(String(req.query.hasta));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await all(
    `
    SELECT ve.*, s.codigo_publico, v.nombre AS vendedor_nombre
    FROM ventas ve
    LEFT JOIN stickers s ON s.id = ve.sticker_id
    LEFT JOIN vendedores v ON v.id = ve.vendedor_id
    ${where}
    ORDER BY ve.fecha DESC
  `,
    args
  );

  res.json(
    rows.map((r) => ({
      id: r.id,
      stickerCodigo: r.codigo_publico,
      vendedorNombre: r.vendedor_nombre,
      monto: r.monto,
      estadoPago: r.estado_pago,
      comisionLiquidada: Boolean(r.comision_liquidada),
      fecha: r.fecha,
    }))
  );
});

app.get('/api/admin/comisiones', requireAdmin, async (req, res) => {
  const rows = await all(`
    SELECT v.id, v.nombre, v.comision_pct,
      COALESCE(SUM(CASE WHEN ve.estado_pago = 'confirmado' THEN ve.monto ELSE 0 END), 0) AS ventas_totales,
      COALESCE(SUM(CASE WHEN ve.estado_pago = 'confirmado' AND ve.comision_liquidada = 0 THEN ve.monto ELSE 0 END), 0) AS base_pendiente,
      COALESCE(SUM(CASE WHEN ve.estado_pago = 'confirmado' AND ve.comision_liquidada = 1 THEN ve.monto ELSE 0 END), 0) AS base_liquidada
    FROM vendedores v
    LEFT JOIN ventas ve ON ve.vendedor_id = v.id
    GROUP BY v.id
    ORDER BY v.id
  `);

  res.json(
    rows.map((r) => ({
      vendedorId: r.id,
      nombre: r.nombre,
      comisionPct: r.comision_pct,
      ventasTotales: r.ventas_totales,
      comisionPendiente: Math.round((r.base_pendiente * r.comision_pct) / 100),
      comisionLiquidada: Math.round((r.base_liquidada * r.comision_pct) / 100),
    }))
  );
});

app.patch('/api/admin/ventas/:id/liquidar', requireAdmin, async (req, res) => {
  const ventaId = Number(req.params.id);
  const venta = await get('SELECT id FROM ventas WHERE id = ?', [ventaId]);
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada.' });
  await run('UPDATE ventas SET comision_liquidada = 1 WHERE id = ?', [ventaId]);
  res.json({ ok: true });
});

// --- Router público: acá redirige el chip al ser tapeado (RF-14). ---
// Siempre va al destino configurado, nunca abre el panel de edición.

app.set('trust proxy', true);

const ROUTER_RATE_LIMIT = 60; // por IP, por minuto — RS-05, evita scraping masivo del inventario
const ROUTER_RATE_WINDOW_MS = 60_000;
const routerHits = new Map(); // ip -> { count, resetAt }

function routerThrottle(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = routerHits.get(ip);
  if (!entry || entry.resetAt < now) {
    routerHits.set(ip, { count: 1, resetAt: now + ROUTER_RATE_WINDOW_MS });
    return next();
  }
  entry.count++;
  if (entry.count > ROUTER_RATE_LIMIT) {
    return res.status(429).send('Demasiados intentos. Probá de nuevo en un rato.');
  }
  next();
}

app.get('/v/:codigo', routerThrottle, async (req, res) => {
  const sticker = await get('SELECT * FROM stickers WHERE codigo_publico = ?', [req.params.codigo]);

  if (sticker && sticker.estado === 'activo') {
    const destino = await get('SELECT * FROM destinos WHERE sticker_id = ?', [sticker.id]);
    if (destino) return res.redirect(302, destino.valor);
  }

  // Sticker inexistente, todavía no activado, o sin destino cargado — no hay
  // pantalla de activación construida todavía (RF-08/09), así que por ahora
  // cae a la landing en vez de mostrar un error crudo.
  res.redirect(302, FRONTEND_URL);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API en http://localhost:${PORT}`);
});
