import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { randomBytes, createHmac } from 'node:crypto';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { db } from './db.js';
import { generateOtp, hashValue, generateToken, generateLinkToken } from './otp.js';
import { canalVerificacion, canalPorId, CAMPOS_COMPRADOR_VALIDOS } from './verificacion/index.js';

const PORT = process.env.PORT || 3001;
const OTP_TTL_MINUTES = 5;
const OTP_THROTTLE_SECONDS = 30;
const SESSION_TTL_MINUTES = 30;
const DESTINO_TIPOS = ['whatsapp', 'instagram', 'pago', 'menu', 'review', 'web', 'agenda', 'linktree'];

// Lote especial: stickers ya impresos sobre un material que NO admite candado
// físico (no se puede write-lock el chip) y que NO llevan ningún ID impreso.
// No nos interesa leer ni registrar su UID real — se dan de alta con un
// uid_nfc sentinel = LOTE_ESPECIAL_PREFIX + codigo_publico. Cuando el uid
// arranca con ese prefijo, el sticker sigue un flujo de venta aparte:
// quien lo tiene en la mano lo activa (posesión física = dueño legítimo),
// sin vendedor, sin pago y sin OTP previo. Ver activacion.html + /api/activacion.
const LOTE_ESPECIAL_PREFIX = '00000';
const esLoteEspecial = (uidNfc) => typeof uidNfc === 'string' && uidNfc.startsWith(LOTE_ESPECIAL_PREFIX);

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

// Vendedor — login con WhatsApp + contraseña (a diferencia del comprador, que
// entra con OTP: el vendedor necesita entrar rápido y repetidas veces durante
// una jornada de venta, sin depender de recibir un WhatsApp cada vez). La
// contraseña la define/resetea el admin al cargar o editar el vendedor.
const VENDEDOR_SESSION_TTL_MINUTES = 60 * 12;

// Programación de chips en el taller (RS-01/RS-02): la clave de escritura de
// cada chip se DERIVA de secreto_maestro + uid_nfc — nunca se guarda en la
// base por chip. El único dato sensible a proteger es este secreto único.
const CHIP_MASTER_SECRET = process.env.CHIP_MASTER_SECRET || '';
// URL pública del router (este mismo backend) — es lo que se graba en el chip.
const PUBLIC_ROUTER_BASE = process.env.PUBLIC_ROUTER_BASE || `http://localhost:${process.env.PORT || 3001}`;

// Pagos — Mercado Pago Checkout Pro. Sin MP_ACCESS_TOKEN configurada, los
// endpoints de venta/pago quedan inactivos (mismo patrón que Google Sign-In).
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_ENABLED = Boolean(MP_ACCESS_TOKEN);
const mpClient = MP_ENABLED ? new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN }) : null;
// 'suelto' = sticker NFC sin impreso 3D (sin case) — se representa con
// modelo = NULL en la tabla stickers, tanto para stock todavía sin asignar
// como, una vez con vendedor, para stock deliberadamente destinado a
// venderse suelto (no hay forma de distinguir ambos casos en el inventario;
// la distinción solo importa al momento de la venta). El precio de cada
// modelo (mismo para cualquier función) vive en la tabla `precios` (ver /api/admin/precios).

function deriveChipPassword(uidNfc) {
  // Hex de 8 bytes — el software de programación del chip suele necesitar
  // recortar/adaptar esto al tamaño exacto que pida su PWD_AUTH (ej. NTAG
  // 213/215/216 usa PWD de 4 bytes). La fórmula es lo que importa: siempre
  // reproducible a partir del secreto maestro + el UID, nunca almacenada.
  return createHmac('sha256', CHIP_MASTER_SECRET).update(uidNfc).digest('hex').slice(0, 16);
}

function deriveChipPack(uidNfc) {
  // Mismo secreto + UID que PWD_AUTH, con un sufijo distinto para que no dé
  // el mismo hash — así el PACK es igual de reproducible sin depender de que
  // alguien lo recuerde a mano (ver 01a - Programación física del chip).
  // NTAG213/215/216 usa PACK de 2 bytes.
  return createHmac('sha256', CHIP_MASTER_SECRET).update(`${uidNfc}:pack`).digest('hex').slice(0, 4);
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
  return { lastInsertRowid: res.rows[0]?.id ?? null, rowsAffected: res.rowsAffected };
}

// --- Ciclo de vida del sticker (SCD tipo 2, ver server/db.js) ---
// El estado "actual" de un sticker nunca se pisa con UPDATE: se cierra la
// fila vigente en sticker_estados y se inserta una nueva con los campos
// mergeados. `stickers_actual` (vista) expone siempre la fila vigente.

function derivarEtapa({ comprador_id, vendedor_id, modelo }) {
  if (comprador_id) return 'vendido';
  if (vendedor_id) return 'en_vendedor';
  if (modelo) return 'con_modelo';
  return 'en_lote';
}

// Crea la primera fila de estado de un sticker recién registrado (alta de UID).
async function crearEstadoInicial(stickerId, { modelo = null, funcion = null, vendedorId = null } = {}) {
  const etapa = derivarEtapa({ comprador_id: null, vendedor_id: vendedorId, modelo });
  const estado = 'en_stock';
  await run(
    `INSERT INTO sticker_estados (sticker_id, etapa, modelo, funcion, vendedor_id, comprador_id, estado)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [stickerId, etapa, modelo, funcion, vendedorId, estado]
  );
}

// Cierra la fila vigente de un sticker y abre una nueva con los campos de
// `patch` mergeados sobre el estado actual (lo no especificado se conserva).
async function transicionarSticker(stickerId, patch) {
  const actual = await get('SELECT * FROM stickers_actual WHERE id = ?', [stickerId]);
  if (!actual) throw new Error(`Sticker ${stickerId} no encontrado.`);

  const siguiente = {
    modelo: 'modelo' in patch ? patch.modelo : actual.modelo,
    funcion: 'funcion' in patch ? patch.funcion : actual.funcion,
    vendedor_id: 'vendedor_id' in patch ? patch.vendedor_id : actual.vendedor_id,
    comprador_id: 'comprador_id' in patch ? patch.comprador_id : actual.comprador_id,
    estado: 'estado' in patch ? patch.estado : actual.estado,
  };
  siguiente.etapa = derivarEtapa(siguiente);

  await run('UPDATE sticker_estados SET vigente_hasta = NOW() WHERE sticker_id = ? AND vigente_hasta IS NULL', [
    stickerId,
  ]);
  await run(
    `INSERT INTO sticker_estados (sticker_id, etapa, modelo, funcion, vendedor_id, comprador_id, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [stickerId, siguiente.etapa, siguiente.modelo, siguiente.funcion, siguiente.vendedor_id, siguiente.comprador_id, siguiente.estado]
  );
  return siguiente;
}

// --- Auth: OTP passwordless, canal de verificación intercambiable (RF-12/RF-13) ---
//
// El código de un solo uso se manda por el canal activo (`canalVerificacion`:
// email hoy, whatsapp cuando se active). La columna `otp_sessions.whatsapp`
// guarda el "destino" sea cual sea el canal — se llama así por historia, no
// implica que sea un teléfono. `otp_sessions.canal` deja registrado con qué
// canal se emitió, así el /verify sabe con qué campo identificar al comprador
// aunque el canal activo cambie entremedio.

app.post('/api/auth/otp/request', async (req, res) => {
  const canal = canalVerificacion;
  const bruto = req.body?.destino ?? req.body?.whatsapp ?? req.body?.email ?? '';
  const destino = canal.normalizarDestino(bruto);
  if (!destino) return res.status(400).json({ error: `Ingresá un ${canal.nombre} válido.` });

  const throttleCutoff = new Date(Date.now() - OTP_THROTTLE_SECONDS * 1000).toISOString();
  const recent = await get(
    `SELECT id FROM otp_sessions WHERE whatsapp = ? AND usado = 0 AND creado_en > ? ORDER BY id DESC LIMIT 1`,
    [destino, throttleCutoff]
  );
  if (recent) {
    return res.status(429).json({ error: 'Esperá unos segundos antes de pedir otro código.' });
  }

  const code = generateOtp();
  await run('INSERT INTO otp_sessions (whatsapp, canal, codigo_hash, expira) VALUES (?, ?, ?, ?)', [
    destino,
    canal.id,
    hashValue(code),
    isoInMinutes(OTP_TTL_MINUTES),
  ]);

  if (canal.disponible) {
    try {
      await canal.enviarCodigo(destino, code);
    } catch (err) {
      console.error(`[OTP] Falló el envío por ${canal.id}:`, err.message);
      return res.status(502).json({ error: `No se pudo enviar el código por ${canal.nombre}. Probá de nuevo.` });
    }
    return res.json({ ok: true });
  }

  // Sin credenciales del canal: modo demo.
  console.log(`[OTP demo] Código para ${destino} (${canal.id}): ${code} (expira en ${OTP_TTL_MINUTES} min)`);

  // DEV ONLY: nunca devolver el código en la respuesta en producción — acá
  // reemplaza al envío real mientras el canal no tenga credenciales cargadas.
  res.json({ ok: true, debug_otp: code });
});

app.post('/api/auth/otp/verify', async (req, res) => {
  const brutoDestino = req.body?.destino ?? req.body?.whatsapp ?? req.body?.email ?? '';
  const destino = canalVerificacion.normalizarDestino(brutoDestino) || String(brutoDestino).trim();
  const code = String(req.body?.code || '').trim();
  if (!destino || !code) return res.status(400).json({ error: 'Faltan datos.' });

  const otp = await get(
    `SELECT * FROM otp_sessions WHERE whatsapp = ? AND usado = 0 AND expira > NOW() ORDER BY id DESC LIMIT 1`,
    [destino]
  );

  if (!otp || otp.codigo_hash !== hashValue(code)) {
    return res.status(401).json({ error: 'Código inválido o expirado.' });
  }

  await run('UPDATE otp_sessions SET usado = 1 WHERE id = ?', [otp.id]);

  // Con qué campo de `compradores` se identifica quien acaba de verificar,
  // según el canal que emitió el OTP (con fallback al canal activo).
  const canalEmisor = canalPorId(otp.canal) || canalVerificacion;
  const campo = canalEmisor.campoComprador;
  if (!CAMPOS_COMPRADOR_VALIDOS.includes(campo)) {
    return res.status(500).json({ error: 'Canal de verificación mal configurado.' });
  }

  let comprador = await get(`SELECT * FROM compradores WHERE ${campo} = ?`, [destino]);
  if (!comprador) {
    const result = await run(`INSERT INTO compradores (${campo}) VALUES (?)`, [destino]);
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
  res.json({
    googleEnabled: GOOGLE_ENABLED,
    verificacion: {
      canal: canalVerificacion.id,
      nombre: canalVerificacion.nombre,
      tipoInput: canalVerificacion.tipoInput,
      placeholder: canalVerificacion.placeholder,
    },
  });
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
  const sesion = await get(`SELECT * FROM sesiones WHERE token_hash = ? AND expira > NOW()`, [tokenHash]);
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
       FROM stickers_actual s
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

  const sticker = await get('SELECT * FROM stickers_actual WHERE id = ? AND comprador_id = ?', [stickerId, req.comprador.id]);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (sticker.estado !== 'activo') {
    return res.status(400).json({ error: 'Este sticker todavía no está activado.' });
  }

  const anterior = await get('SELECT * FROM destinos WHERE sticker_id = ?', [stickerId]);

  await db.execute({
    sql: `INSERT INTO destinos (sticker_id, tipo, valor, actualizado_en) VALUES (?, ?, ?, NOW())
     ON CONFLICT(sticker_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, actualizado_en = NOW()`,
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

// --- Ventas y pagos (wizard de compra → Mercado Pago Checkout Pro) ---

// Crea la venta (reserva un sticker en stock + registra el destino elegido, a la
// espera de pago) y devuelve el link de Checkout Pro. El destino recién se aplica
// de verdad al sticker cuando el webhook confirma el pago (ver /api/pagos/webhook).
// Stock disponible de un vendedor puntual — lo usa el wizard de compra presencial
// para mostrar solo los modelos que ese vendedor tiene físicamente consigo (con
// su NFC ya adentro), en vez del catálogo completo. Se busca primero por
// link_token (link nuevo, no adivinable); codigo_ref queda como fallback
// TEMPORAL mientras se reimprimen los stickers ya repartidos con el link
// viejo (?ref=<codigo_ref>) — sacar el fallback una vez reimpresos todos.
app.get('/api/public/vendedores/:ref/stock', async (req, res) => {
  const ref = String(req.params.ref || '').trim().toLowerCase();
  const vendedor = await get('SELECT id, nombre FROM vendedores WHERE link_token = ? OR codigo_ref = ?', [ref, ref]);
  if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });

  const rows = await all(
    'SELECT modelo, COUNT(*) AS cantidad FROM stickers_actual WHERE vendedor_id = ? AND estado = ? GROUP BY modelo',
    [vendedor.id, 'en_stock']
  );
  // Funciones que este vendedor tiene físicamente asignadas (independiente del
  // modelo) — el wizard usa esto para deshabilitar en el paso 1 las funciones
  // que no tiene consigo, igual que ya hace con los modelos en el paso 2.
  const funcionRows = await all(
    'SELECT DISTINCT funcion FROM stickers_actual WHERE vendedor_id = ? AND estado = ? AND funcion IS NOT NULL',
    [vendedor.id, 'en_stock']
  );
  // modelo NULL = sticker sin impreso 3D ("suelto") — se agrupa como su propio bucket.
  res.json({
    vendedor: vendedor.nombre,
    modelos: rows.map((r) => ({ modelo: r.modelo || 'suelto', cantidad: r.cantidad })),
    funciones: funcionRows.map((r) => r.funcion),
  });
});

// Precio por modelo — lo usa el wizard de compra para calcular el total.
app.get('/api/public/precios', async (req, res) => {
  const rows = await all('SELECT modelo, precio FROM precios');
  res.json(rows);
});

// Una venta = un pago (una preferencia de Mercado Pago) que puede cubrir
// varios stickers a la vez. El body espera `items`: un array de
// {modelo, destinoTipo, destinoValor} — uno por sticker que se quiere
// comprar en esta misma transacción. El envío (si aplica) es único por
// venta, no por item.
app.post('/api/ventas', requireAuth, async (req, res) => {
  if (!MP_ENABLED) return res.status(503).json({ error: 'Los pagos todavía no están configurados.' });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const vendedorToken = String(req.body?.vendedorToken || '').trim().toLowerCase();
  const envio = req.body?.envio && Number(req.body.envio.price) > 0 ? req.body.envio : null;

  if (!items.length) return res.status(400).json({ error: 'No hay productos en la compra.' });
  for (const item of items) {
    const modelo = String(item?.modelo || '').trim();
    const destinoTipo = String(item?.destinoTipo || '').trim();
    // 'suelto' = sticker sin impreso 3D — es una opción válida de compra, no un modelo real.
    if (modelo !== 'suelto' && !MODELOS.includes(modelo)) return res.status(400).json({ error: 'Modelo inválido.' });
    if (!DESTINO_TIPOS.includes(destinoTipo)) return res.status(400).json({ error: 'Tipo de destino inválido.' });
    // El valor del destino (el link/handle real) es opcional acá a propósito:
    // el comprador puede pagar y activar el NFC ahora, y configurar recién
    // desde su panel a dónde redirige — no hace falta decidirlo antes de pagar.
  }

  // Mismo fallback temporal que el endpoint de stock: acepta el token nuevo o
  // el codigo_ref viejo, hasta reimprimir todos los stickers repartidos.
  let vendedor = null;
  if (vendedorToken) {
    vendedor = await get('SELECT id FROM vendedores WHERE link_token = ? OR codigo_ref = ?', [vendedorToken, vendedorToken]);
  }

  // Reservamos un sticker en_stock por cada item pedido, antes de crear nada,
  // para no dejar una venta a medio armar si se corta el stock a mitad de camino.
  const reservados = [];
  for (const item of items) {
    const modelo = String(item.modelo).trim();
    const esSuelto = modelo === 'suelto';
    const modeloClause = esSuelto ? 'modelo IS NULL' : 'modelo = ?';
    const modeloArgs = esSuelto ? [] : [modelo];
    const sticker =
      (vendedor &&
        (await get(`SELECT * FROM stickers_actual WHERE estado = ? AND ${modeloClause} AND vendedor_id = ? LIMIT 1`, [
          'en_stock',
          ...modeloArgs,
          vendedor.id,
        ]))) ||
      (await get(`SELECT * FROM stickers_actual WHERE estado = ? AND ${modeloClause} LIMIT 1`, ['en_stock', ...modeloArgs]));

    if (!sticker || reservados.some((r) => r.sticker.id === sticker.id)) {
      return res.status(409).json({ error: `No hay stock disponible de ${modelo} en este momento.` });
    }
    const precioRow = await get('SELECT precio FROM precios WHERE modelo = ?', [modelo]);
    if (!precioRow) return res.status(409).json({ error: `No hay precio definido para ${modelo}.` });
    reservados.push({ sticker, item, precio: precioRow.precio });
  }

  let vendedorIdVenta = vendedor?.id || null;
  const montoItems = reservados.reduce((sum, r) => sum + r.precio, 0);
  const monto = montoItems + (envio ? Number(envio.price) : 0);

  for (const { sticker } of reservados) {
    await transicionarSticker(sticker.id, { comprador_id: req.comprador.id, estado: 'vendido_pendiente' });
    if (!vendedorIdVenta && sticker.vendedor_id) vendedorIdVenta = sticker.vendedor_id;
  }

  const ventaResult = await run(
    `INSERT INTO ventas (vendedor_id, comprador_id, monto, estado_pago) VALUES (?, ?, ?, 'pendiente')`,
    [vendedorIdVenta, req.comprador.id, monto]
  );
  const ventaId = ventaResult.lastInsertRowid;

  for (const { sticker, item, precio } of reservados) {
    await run('INSERT INTO venta_items (venta_id, sticker_id, monto, destino_tipo, destino_valor) VALUES (?, ?, ?, ?, ?)', [
      ventaId,
      sticker.id,
      precio,
      String(item.destinoTipo).trim(),
      String(item.destinoValor || '').trim() || null,
    ]);
  }

  try {
    const mpItems = reservados.map(({ item, precio }) => ({
      title: `Sticker AltoqueTap — ${item.modelo}`,
      quantity: 1,
      unit_price: precio,
      currency_id: 'ARS',
    }));
    if (envio) {
      mpItems.push({ title: 'Envío', quantity: 1, unit_price: Number(envio.price), currency_id: 'ARS' });
    }
    const preference = await new Preference(mpClient).create({
      body: {
        items: mpItems,
        external_reference: String(ventaId),
        back_urls: {
          success: `${FRONTEND_URL}/pedido.html?venta=${ventaId}&pago=exito`,
          failure: `${FRONTEND_URL}/pedido.html?venta=${ventaId}&pago=error`,
          pending: `${FRONTEND_URL}/pedido.html?venta=${ventaId}&pago=pendiente`,
        },
        auto_return: 'approved',
        notification_url: `${PUBLIC_ROUTER_BASE}/api/pagos/webhook`,
      },
    });
    res.status(201).json({ ventaId, initPoint: preference.init_point });
  } catch (err) {
    console.error('[Mercado Pago] error creando preferencia:', err.message);
    // Si no se pudo iniciar el pago, no dejamos nada reservado a medias:
    // liberamos los stickers reservados y borramos la venta que recién armamos.
    await run('DELETE FROM venta_items WHERE venta_id = ?', [ventaId]);
    await run('DELETE FROM ventas WHERE id = ?', [ventaId]);
    for (const { sticker } of reservados) {
      await transicionarSticker(sticker.id, { comprador_id: null, estado: 'en_stock' });
    }
    res.status(502).json({ error: 'No se pudo iniciar el pago. Probá de nuevo.' });
  }
});

app.get('/api/ventas/:id', requireAuth, async (req, res) => {
  const venta = await get('SELECT * FROM ventas WHERE id = ? AND comprador_id = ?', [
    Number(req.params.id),
    req.comprador.id,
  ]);
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada.' });

  const items = await all(
    `SELECT vi.*, s.codigo_publico, s.modelo FROM venta_items vi JOIN stickers_actual s ON s.id = vi.sticker_id
     WHERE vi.venta_id = ?`,
    [venta.id]
  );

  res.json({
    id: venta.id,
    estadoPago: venta.estado_pago,
    monto: venta.monto,
    items: items.map((it) => ({
      stickerCodigo: it.codigo_publico,
      modelo: it.modelo || 'suelto',
      destinoTipo: it.destino_tipo,
      destinoValor: it.destino_valor,
    })),
  });
});

// Mercado Pago llama acá cuando cambia el estado de un pago (no hay sesión de
// usuario en este request). Confirmamos el estado real contra la API de MP en
// vez de confiar en el payload de la notificación (evita pagos falsificados).
app.post('/api/pagos/webhook', async (req, res) => {
  if (!MP_ENABLED) return res.sendStatus(200);

  const type = req.query.type || req.body?.type || req.body?.topic;
  const paymentId = req.query['data.id'] || req.body?.data?.id;
  if (type !== 'payment' || !paymentId) return res.sendStatus(200);

  try {
    const payment = await new Payment(mpClient).get({ id: paymentId });
    const ventaId = Number(payment.external_reference);
    const venta = await get('SELECT * FROM ventas WHERE id = ?', [ventaId]);
    if (!venta || venta.estado_pago === 'confirmado') return res.sendStatus(200);

    const items = await all('SELECT * FROM venta_items WHERE venta_id = ?', [ventaId]);

    if (payment.status === 'approved') {
      await run('UPDATE ventas SET estado_pago = ?, payment_id = ? WHERE id = ?', [
        'confirmado',
        String(payment.id),
        ventaId,
      ]);
      // Activamos cada sticker de la venta — una venta con varios items activa
      // varios stickers a la vez. El destino es opcional: si el comprador no
      // lo cargó al pagar, el sticker igual queda "activo" y disponible para
      // usar/editar desde su panel apenas quiera (ver mi-panel.js).
      for (const item of items) {
        if (item.destino_valor) {
          await db.execute({
            sql: `INSERT INTO destinos (sticker_id, tipo, valor, actualizado_en) VALUES (?, ?, ?, NOW())
             ON CONFLICT(sticker_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, actualizado_en = NOW()`,
            args: [item.sticker_id, item.destino_tipo, item.destino_valor],
          });
        }
        await transicionarSticker(item.sticker_id, { estado: 'activo' });
      }
    } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
      await run('UPDATE ventas SET estado_pago = ?, payment_id = ? WHERE id = ?', [
        'rechazado',
        String(payment.id),
        ventaId,
      ]);
      // Liberamos todos los stickers reservados de esta venta para que vuelvan a estar disponibles.
      for (const item of items) {
        const actual = await get('SELECT estado FROM stickers_actual WHERE id = ?', [item.sticker_id]);
        if (actual?.estado === 'vendido_pendiente') {
          await transicionarSticker(item.sticker_id, { comprador_id: null, estado: 'en_stock' });
        }
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[Mercado Pago] error procesando webhook:', err.message);
    res.sendStatus(200); // devolvemos 200 igual — si no, MP reintenta agresivamente
  }
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
  const sesion = await get(`SELECT * FROM admin_sesiones WHERE token_hash = ? AND expira > NOW()`, [
    tokenHash,
  ]);
  if (!sesion) return res.status(401).json({ error: 'Sesión inválida o expirada.' });

  await run('UPDATE admin_sesiones SET expira = ? WHERE id = ?', [isoInMinutes(ADMIN_SESSION_TTL_MINUTES), sesion.id]);
  next();
}

// --- Panel del vendedor (/vendedor) — login WhatsApp+contraseña, ver qué
// stickers vendidos todavía tiene que entregar (RS-06: verificación de
// entrega física por codigo_publico). ---

app.post('/api/vendedor/login', async (req, res) => {
  const whatsapp = String(req.body?.whatsapp || '').trim();
  const password = String(req.body?.password || '');
  if (!whatsapp || !password) return res.status(400).json({ error: 'Faltan datos.' });

  const vendedor = await get('SELECT * FROM vendedores WHERE whatsapp = ?', [whatsapp]);
  if (!vendedor || !vendedor.password_hash) {
    return res.status(401).json({ error: 'WhatsApp o contraseña incorrectos.' });
  }
  const ok = await bcrypt.compare(password, vendedor.password_hash);
  if (!ok) return res.status(401).json({ error: 'WhatsApp o contraseña incorrectos.' });

  const token = generateToken();
  await run('INSERT INTO vendedor_sesiones (vendedor_id, token_hash, expira) VALUES (?, ?, ?)', [
    vendedor.id,
    hashValue(token),
    isoInMinutes(VENDEDOR_SESSION_TTL_MINUTES),
  ]);
  res.json({ token, vendedor: { id: vendedor.id, nombre: vendedor.nombre, codigoRef: vendedor.codigo_ref } });
});

app.delete('/api/vendedor/session', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) await run('DELETE FROM vendedor_sesiones WHERE token_hash = ?', [hashValue(token)]);
  res.status(204).end();
});

async function requireVendedor(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Falta autenticación.' });

  const tokenHash = hashValue(token);
  const sesion = await get(`SELECT * FROM vendedor_sesiones WHERE token_hash = ? AND expira > NOW()`, [tokenHash]);
  if (!sesion) return res.status(401).json({ error: 'Sesión inválida o expirada.' });

  await run('UPDATE vendedor_sesiones SET expira = ? WHERE id = ?', [
    isoInMinutes(VENDEDOR_SESSION_TTL_MINUTES),
    sesion.id,
  ]);

  req.vendedor = await get('SELECT id, nombre, codigo_ref, comision_pct, whatsapp FROM vendedores WHERE id = ?', [
    sesion.vendedor_id,
  ]);
  next();
}

app.get('/api/vendedor/me', requireVendedor, (req, res) => {
  const { id, nombre, codigo_ref, comision_pct } = req.vendedor;
  res.json({ id, nombre, codigoRef: codigo_ref, comisionPct: comision_pct });
});

// Stock que el admin le asignó a este vendedor y todavía no vendió — lo que
// tiene físicamente consigo para vender.
app.get('/api/vendedor/stock', requireVendedor, async (req, res) => {
  const rows = await all(
    `SELECT id, codigo_publico, modelo, funcion FROM stickers_actual
       WHERE vendedor_id = ? AND etapa = 'en_vendedor'
       ORDER BY id`,
    [req.vendedor.id]
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      codigoPublico: r.codigo_publico,
      modelo: r.modelo || 'suelto',
      funcion: r.funcion,
    }))
  );
});

// Ventas ya confirmadas (pagadas) de este vendedor — el codigo_publico de cada
// una es el ID que tiene que coincidir con el imprimible que le entrega al
// comprador (mecanismo de verificación de entrega, RS-06). El admin es quien
// después marca la entrega/liquidación desde su propio panel.
app.get('/api/vendedor/ventas', requireVendedor, async (req, res) => {
  const rows = await all(
    `SELECT s.id, s.codigo_publico, s.modelo, s.funcion, s.vigente_desde, c.whatsapp AS comprador_whatsapp, c.nombre AS comprador_nombre
       FROM stickers_actual s
       LEFT JOIN compradores c ON c.id = s.comprador_id
       WHERE s.vendedor_id = ? AND s.etapa = 'vendido' AND s.estado = 'activo'
       ORDER BY s.vigente_desde DESC`,
    [req.vendedor.id]
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      codigoPublico: r.codigo_publico,
      modelo: r.modelo || 'suelto',
      funcion: r.funcion,
      vendidoEn: r.vigente_desde,
      comprador: r.comprador_whatsapp ? { whatsapp: r.comprador_whatsapp, nombre: r.comprador_nombre } : null,
    }))
  );
});

app.get('/api/admin/vendedores', requireAdmin, async (req, res) => {
  const vendedores = await all(`
    SELECT v.*,
      (SELECT COUNT(*) FROM stickers_actual s WHERE s.vendedor_id = v.id) AS stock_total,
      (SELECT COUNT(*) FROM stickers_actual s WHERE s.vendedor_id = v.id AND s.estado = 'en_stock') AS stock_disponible
    FROM vendedores v ORDER BY v.id
  `);
  res.json(
    vendedores.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      codigoRef: v.codigo_ref,
      linkToken: v.link_token,
      linkCompra: `${PUBLIC_ROUTER_BASE}/comprar.html?s=${v.link_token}`,
      comisionPct: v.comision_pct,
      whatsapp: v.whatsapp,
      tieneLogin: Boolean(v.password_hash),
      stockTotal: v.stock_total,
      stockDisponible: v.stock_disponible,
    }))
  );
});

const BCRYPT_ROUNDS = 10;

app.post('/api/admin/vendedores', requireAdmin, async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const codigoRef = String(req.body?.codigoRef || '').trim().toLowerCase();
  const comisionPct = Number(req.body?.comisionPct ?? 50);
  const whatsapp = String(req.body?.whatsapp || '').trim();
  const password = String(req.body?.password || '');

  if (!nombre || !codigoRef) return res.status(400).json({ error: 'Faltan datos.' });
  if (!/^[a-z0-9-]+$/.test(codigoRef)) {
    return res.status(400).json({ error: 'El código de referencia solo puede tener letras, números y guiones.' });
  }
  if (whatsapp && !password) return res.status(400).json({ error: 'Si cargás un WhatsApp, definí también una contraseña para su login.' });

  const existe = await get('SELECT id FROM vendedores WHERE codigo_ref = ?', [codigoRef]);
  if (existe) return res.status(409).json({ error: 'Ya existe un vendedor con ese código de referencia.' });
  if (whatsapp) {
    const otroWa = await get('SELECT id FROM vendedores WHERE whatsapp = ?', [whatsapp]);
    if (otroWa) return res.status(409).json({ error: 'Ya existe un vendedor con ese WhatsApp.' });
  }

  const passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null;
  const linkToken = generateLinkToken();
  const result = await run(
    'INSERT INTO vendedores (nombre, codigo_ref, comision_pct, whatsapp, password_hash, link_token) VALUES (?, ?, ?, ?, ?, ?)',
    [nombre, codigoRef, comisionPct, whatsapp || null, passwordHash, linkToken]
  );
  res.status(201).json({
    id: result.lastInsertRowid,
    nombre,
    codigoRef,
    linkToken,
    linkCompra: `${PUBLIC_ROUTER_BASE}/comprar.html?s=${linkToken}`,
    comisionPct,
    whatsapp: whatsapp || null,
  });
});

app.patch('/api/admin/vendedores/:id', requireAdmin, async (req, res) => {
  const vendedorId = Number(req.params.id);
  const vendedor = await get('SELECT * FROM vendedores WHERE id = ?', [vendedorId]);
  if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });

  const nombre = String(req.body?.nombre || '').trim();
  const codigoRef = String(req.body?.codigoRef || '').trim().toLowerCase();
  const comisionPct = Number(req.body?.comisionPct ?? vendedor.comision_pct);
  // whatsapp/password son opcionales en el PATCH: si no vienen en el body, se
  // conservan; si vienen vacíos explícitamente, se limpian (permite "sacarle" el login).
  const whatsapp = 'whatsapp' in (req.body || {}) ? String(req.body.whatsapp || '').trim() : vendedor.whatsapp;
  const password = String(req.body?.password || '');

  if (!nombre || !codigoRef) return res.status(400).json({ error: 'Faltan datos.' });
  if (!/^[a-z0-9-]+$/.test(codigoRef)) {
    return res.status(400).json({ error: 'El código de referencia solo puede tener letras, números y guiones.' });
  }
  if (whatsapp && !password && !vendedor.password_hash) {
    return res.status(400).json({ error: 'Si cargás un WhatsApp, definí también una contraseña para su login.' });
  }

  const otro = await get('SELECT id FROM vendedores WHERE codigo_ref = ? AND id != ?', [codigoRef, vendedorId]);
  if (otro) return res.status(409).json({ error: 'Ya existe otro vendedor con ese código de referencia.' });
  if (whatsapp) {
    const otroWa = await get('SELECT id FROM vendedores WHERE whatsapp = ? AND id != ?', [whatsapp, vendedorId]);
    if (otroWa) return res.status(409).json({ error: 'Ya existe otro vendedor con ese WhatsApp.' });
  }

  const passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : vendedor.password_hash;
  await run('UPDATE vendedores SET nombre = ?, codigo_ref = ?, comision_pct = ?, whatsapp = ?, password_hash = ? WHERE id = ?', [
    nombre,
    codigoRef,
    comisionPct,
    whatsapp || null,
    whatsapp ? passwordHash : null,
    vendedorId,
  ]);
  res.json({ id: vendedorId, nombre, codigoRef, comisionPct, whatsapp: whatsapp || null });
});

app.delete('/api/admin/vendedores/:id', requireAdmin, async (req, res) => {
  const vendedorId = Number(req.params.id);
  const vendedor = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
  if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });

  const stock = await get('SELECT id FROM stickers_actual WHERE vendedor_id = ? LIMIT 1', [vendedorId]);
  if (stock) return res.status(409).json({ error: 'Tiene stock asignado — reasigná o eliminá esos stickers primero.' });
  const venta = await get('SELECT id FROM ventas WHERE vendedor_id = ? LIMIT 1', [vendedorId]);
  if (venta) return res.status(409).json({ error: 'Tiene ventas registradas — no se puede eliminar un vendedor con historial.' });

  await run('DELETE FROM vendedores WHERE id = ?', [vendedorId]);
  res.status(204).end();
});

app.get('/api/admin/stickers', requireAdmin, async (req, res) => {
  const rows = await all(`
    SELECT s.id, s.codigo_publico, s.uid_nfc, s.estado, s.funcion, s.modelo, s.protegido_en, s.creado_en, s.vigente_desde, l.nombre AS lote_nombre,
      v.nombre AS vendedor_nombre, v.codigo_ref AS vendedor_ref,
      c.whatsapp AS comprador_whatsapp, c.nombre AS comprador_nombre
    FROM stickers_actual s
    LEFT JOIN lotes l ON l.id = s.lote_id
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
      funcion: r.funcion,
      modelo: r.modelo,
      protegidoEn: r.protegido_en,
      creadoEn: r.creado_en,
      // Fecha desde la que está vigente el estado actual — cuando el sticker
      // tiene vendedor asignado, coincide con la fecha de esa asignación (la
      // transición de vendedor siempre abre una fila nueva en sticker_estados).
      asignadoEn: r.vendedor_ref ? r.vigente_desde : null,
      lote: r.lote_nombre,
      vendedor: r.vendedor_nombre ? { nombre: r.vendedor_nombre, codigoRef: r.vendedor_ref } : null,
      comprador: r.comprador_whatsapp ? { whatsapp: r.comprador_whatsapp, nombre: r.comprador_nombre } : null,
    }))
  );
});

const MODELOS = ['llavero', 'tarjeta', 'placa'];

app.post('/api/admin/stickers/batch', requireAdmin, async (req, res) => {
  const cantidad = Math.min(Math.max(Number(req.body?.cantidad) || 0, 1), 100);
  const modelo = String(req.body?.modelo || '').trim();
  const funcion = String(req.body?.funcion || '').trim();
  const vendedorId = req.body?.vendedorId ? Number(req.body.vendedorId) : null;

  if (!MODELOS.includes(modelo)) return res.status(400).json({ error: 'Modelo inválido.' });
  if (funcion && !DESTINO_TIPOS.includes(funcion)) return res.status(400).json({ error: 'Función inválida.' });
  if (vendedorId) {
    const vendedor = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });
  }

  // El lote se registra primero — agrupa los UID que se dan de alta juntos
  // en esta misma tanda, antes de asignarlos a un vendedor o comprador.
  const loteResult = await run('INSERT INTO lotes (nombre, cantidad) VALUES (?, ?)', [
    `Lote ${new Date().toISOString().slice(0, 10)} — ${modelo} x${cantidad}`,
    cantidad,
  ]);
  const loteId = loteResult.lastInsertRowid;

  const creados = [];
  for (let i = 0; i < cantidad; i++) {
    const codigoPublico = generateCodigoPublico();
    const uidNfc = generateUidNfc();
    const result = await run('INSERT INTO stickers (codigo_publico, uid_nfc, lote_id) VALUES (?, ?, ?)', [
      codigoPublico,
      uidNfc,
      loteId,
    ]);
    const stickerId = result.lastInsertRowid;
    await crearEstadoInicial(stickerId, { modelo, funcion: funcion || null, vendedorId });
    creados.push({ id: stickerId, codigoPublico, uidNfc });
  }

  res.status(201).json({ loteId, creados });
});

// Alta de un lote ESPECIAL (stickers ya impresos, sin candado físico, sin ID
// impreso). No se registra ningún UID real: cada sticker recibe un uid_nfc
// sentinel = LOTE_ESPECIAL_PREFIX + codigo_publico. Devuelve la lista de links
// de activación — uno por sticker — que hay que grabar en cada chip.
app.post('/api/admin/stickers/lote-especial', requireAdmin, async (req, res) => {
  const modelo = String(req.body?.modelo || 'llavero').trim();
  const nombre = String(req.body?.nombre || '').trim() || `Lote especial ${new Date().toISOString().slice(0, 10)}`;

  if (!MODELOS.includes(modelo)) return res.status(400).json({ error: 'Modelo inválido.' });

  // `codigos` explícitos: para stickers YA impresos/grabados con un código
  // decidido afuera (no se puede regrabar el chip, así que la base se adapta
  // al sticker y no al revés). Si no se pasan, se generan al azar.
  const codigosPedidos = Array.isArray(req.body?.codigos)
    ? req.body.codigos.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean)
    : null;

  if (codigosPedidos) {
    if (codigosPedidos.some((c) => !/^[a-z0-9]{3,32}$/.test(c))) {
      return res.status(400).json({ error: 'Cada código debe ser alfanumérico (3–32 chars).' });
    }
    if (new Set(codigosPedidos).size !== codigosPedidos.length) {
      return res.status(400).json({ error: 'Hay códigos repetidos en la lista.' });
    }
    const enUso = await all(
      `SELECT codigo_publico FROM stickers WHERE codigo_publico = ANY(?)`,
      [codigosPedidos]
    );
    if (enUso.length) {
      return res.status(409).json({ error: `Ya existen: ${enUso.map((r) => r.codigo_publico).join(', ')}` });
    }
  }

  const cantidad = codigosPedidos
    ? codigosPedidos.length
    : Math.min(Math.max(Number(req.body?.cantidad) || 0, 1), 100);

  const loteResult = await run('INSERT INTO lotes (nombre, cantidad) VALUES (?, ?)', [nombre, cantidad]);
  const loteId = loteResult.lastInsertRowid;

  const creados = [];
  for (let i = 0; i < cantidad; i++) {
    let codigoPublico = codigosPedidos ? codigosPedidos[i] : null;
    // codigo_publico único (reintenta ante la colisión, muy poco probable)
    while (!codigoPublico) {
      const cand = generateCodigoPublico();
      const yaHay = await get('SELECT id FROM stickers WHERE codigo_publico = ?', [cand]);
      if (!yaHay) codigoPublico = cand;
    }
    const uidNfc = `${LOTE_ESPECIAL_PREFIX}${codigoPublico}`;
    const result = await run('INSERT INTO stickers (codigo_publico, uid_nfc, lote_id) VALUES (?, ?, ?)', [
      codigoPublico,
      uidNfc,
      loteId,
    ]);
    await crearEstadoInicial(result.lastInsertRowid, { modelo, funcion: null, vendedorId: null });
    creados.push({
      id: result.lastInsertRowid,
      codigoPublico,
      // Se graba el router del backend (302 puro), no la landing: el primer tap
      // de un lote especial sin dueño lo redirige a /activacion/ desde /v/, y una
      // vez activado el tap va directo al destino sin pasar por ninguna pantalla.
      link: `${PUBLIC_ROUTER_BASE}/v/${codigoPublico}`,
    });
  }

  res.status(201).json({ loteId, cantidad: creados.length, creados, links: creados.map((c) => c.link) });
});

// Alta individual "de taller": partís de un uid_nfc real (leído del chip físico)
// en vez de generarlo al azar. Devuelve la clave de escritura derivada UNA
// SOLA VEZ, para programar el chip en el momento — no se guarda en ningún lado.
app.post('/api/admin/stickers/individual', requireAdmin, async (req, res) => {
  if (!CHIP_MASTER_SECRET) {
    return res.status(503).json({ error: 'Configurá CHIP_MASTER_SECRET antes de dar de alta chips reales.' });
  }
  const uidNfc = String(req.body?.uidNfc || '').trim();
  // Función, modelo y vendedor son opcionales acá a propósito: el alta de un
  // chip NFC, la asignación de función/modelo (según qué impreso 3D lo lleva
  // adentro) y la asignación de vendedor no siempre pasan en el mismo
  // momento ni en ese orden — cada una se puede completar después, por
  // separado (ver PATCH /stickers/:id/funcion, /modelo y /asignar).
  const funcion = String(req.body?.funcion || '').trim();
  const modelo = String(req.body?.modelo || '').trim();
  const vendedorId = req.body?.vendedorId ? Number(req.body.vendedorId) : null;
  // ID de imprimible: el mismo código que se graba en el NFC, para que el
  // impreso 3D y el chip que lleva adentro queden identificados con un único
  // id físico. Si no se especifica, se genera uno al azar (comportamiento previo).
  const codigoImprimible = String(req.body?.codigoImprimible || '').trim();
  // Lote al que pertenece este UID — opcional: se puede registrar "suelto"
  // (sin lote) o asociarlo a un lote ya existente dado de alta antes.
  const loteId = req.body?.loteId ? Number(req.body.loteId) : null;

  if (!uidNfc) return res.status(400).json({ error: 'Falta el UID del chip.' });
  if (funcion && !DESTINO_TIPOS.includes(funcion)) return res.status(400).json({ error: 'Función inválida.' });
  if (modelo && !MODELOS.includes(modelo)) return res.status(400).json({ error: 'Modelo inválido.' });
  if (vendedorId) {
    const vendedor = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });
  }
  if (loteId) {
    const lote = await get('SELECT id FROM lotes WHERE id = ?', [loteId]);
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado.' });
  }

  const existente = await get('SELECT id FROM stickers WHERE uid_nfc = ?', [uidNfc]);
  if (existente) return res.status(409).json({ error: 'Ese UID ya está registrado.' });

  if (codigoImprimible) {
    const codigoEnUso = await get('SELECT id FROM stickers WHERE codigo_publico = ?', [codigoImprimible]);
    if (codigoEnUso) return res.status(409).json({ error: 'Ese ID de imprimible ya está en uso.' });
  }

  const codigoPublico = codigoImprimible || generateCodigoPublico();
  const writePassword = deriveChipPassword(uidNfc);
  const writePack = deriveChipPack(uidNfc);
  const result = await run('INSERT INTO stickers (codigo_publico, uid_nfc, lote_id) VALUES (?, ?, ?)', [
    codigoPublico,
    uidNfc,
    loteId,
  ]);
  await crearEstadoInicial(result.lastInsertRowid, { modelo: modelo || null, funcion: funcion || null, vendedorId });

  res.status(201).json({
    id: result.lastInsertRowid,
    codigoPublico,
    uidNfc,
    url: `${PUBLIC_ROUTER_BASE}/v/${codigoPublico}`,
    writePassword,
    writePack,
  });
});

// Recalcula PWD_AUTH y PACK de un chip ya registrado — son determinísticos a
// partir de uid_nfc + CHIP_MASTER_SECRET, así que se pueden pedir las veces
// que haga falta (ej. para reprogramar un chip ya protegido) sin depender de
// haber copiado la clave que se mostró una sola vez en el alta.
app.get('/api/admin/stickers/:id/clave', requireAdmin, async (req, res) => {
  if (!CHIP_MASTER_SECRET) {
    return res.status(503).json({ error: 'Configurá CHIP_MASTER_SECRET para recalcular claves.' });
  }
  const stickerId = Number(req.params.id);
  const sticker = await get('SELECT uid_nfc FROM stickers WHERE id = ?', [stickerId]);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (!sticker.uid_nfc) return res.status(400).json({ error: 'Este sticker no tiene UID real (es de un lote simulado).' });

  res.json({
    writePassword: deriveChipPassword(sticker.uid_nfc),
    writePack: deriveChipPack(sticker.uid_nfc),
  });
});

// Confirmación manual de que el AUTH0 ya se escribió a mano en el chip
// físico (ver 01a) — el sistema no tiene lector NFC conectado, así que nunca
// puede verificar el candado por su cuenta, solo registrar que el admin lo
// hizo.
app.patch('/api/admin/stickers/:id/candado', requireAdmin, async (req, res) => {
  const stickerId = Number(req.params.id);
  const sticker = await get('SELECT id, uid_nfc, protegido_en FROM stickers WHERE id = ?', [stickerId]);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (!sticker.uid_nfc) return res.status(400).json({ error: 'Este sticker no tiene UID real (es de un lote simulado).' });
  if (sticker.protegido_en) return res.status(409).json({ error: 'Ya estaba marcado como protegido.' });

  await run('UPDATE stickers SET protegido_en = NOW() WHERE id = ?', [stickerId]);
  res.json({ ok: true });
});

// Asignar (o quitar, mandando vendedorId vacío) el vendedor de un NFC en stock —
// independiente de si ya tiene modelo definido o no.
app.patch('/api/admin/stickers/:id/asignar', requireAdmin, async (req, res) => {
  const stickerId = Number(req.params.id);
  const vendedorId = req.body?.vendedorId ? Number(req.body.vendedorId) : null;

  const sticker = await get('SELECT * FROM stickers_actual WHERE id = ?', [stickerId]);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (sticker.estado !== 'en_stock') {
    return res.status(400).json({ error: 'Solo se puede reasignar stock que todavía no fue vendido.' });
  }
  if (vendedorId) {
    const vendedor = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });
  }

  await transicionarSticker(stickerId, { vendedor_id: vendedorId });
  res.json({ ok: true });
});

// Asignar (o quitar) la función (tipo de destino previsto para el impreso) de
// un NFC en stock — mismo patrón que modelo: independiente, opcional, y solo
// editable mientras siga sin vendedor asignado.
app.patch('/api/admin/stickers/:id/funcion', requireAdmin, async (req, res) => {
  const stickerId = Number(req.params.id);
  const funcion = String(req.body?.funcion || '').trim();

  const sticker = await get('SELECT * FROM stickers_actual WHERE id = ?', [stickerId]);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (sticker.estado !== 'en_stock') {
    return res.status(400).json({ error: 'Solo se puede editar la función de stock que todavía no fue vendido.' });
  }
  if (funcion && !DESTINO_TIPOS.includes(funcion)) return res.status(400).json({ error: 'Función inválida.' });

  await transicionarSticker(stickerId, { funcion: funcion || null });
  res.json({ ok: true });
});

// Asignar (o quitar) el modelo de un NFC en stock — independiente de si ya
// tiene vendedor asignado o no. Así el UID se puede registrar "crudo" apenas
// se lee el chip, y el modelo/vendedor se completan después, en cualquier orden.
app.patch('/api/admin/stickers/:id/modelo', requireAdmin, async (req, res) => {
  const stickerId = Number(req.params.id);
  const modelo = String(req.body?.modelo || '').trim();

  const sticker = await get('SELECT * FROM stickers_actual WHERE id = ?', [stickerId]);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (sticker.estado !== 'en_stock') {
    return res.status(400).json({ error: 'Solo se puede editar el modelo de stock que todavía no fue vendido.' });
  }
  if (modelo && !MODELOS.includes(modelo)) return res.status(400).json({ error: 'Modelo inválido.' });

  await transicionarSticker(stickerId, { modelo: modelo || null });
  res.json({ ok: true });
});

// Precio por modelo imprimible — mismo precio para cualquier función.
app.get('/api/admin/precios', requireAdmin, async (req, res) => {
  const rows = await all('SELECT modelo, precio FROM precios ORDER BY modelo');
  res.json(rows);
});

app.patch('/api/admin/precios', requireAdmin, async (req, res) => {
  const modelo = String(req.body?.modelo || '').trim();
  const precio = Number(req.body?.precio);

  if (!MODELOS.includes(modelo) && modelo !== 'suelto') return res.status(400).json({ error: 'Modelo inválido.' });
  if (!Number.isFinite(precio) || precio < 0) return res.status(400).json({ error: 'Precio inválido.' });

  await run(
    `INSERT INTO precios (modelo, precio) VALUES (?, ?)
     ON CONFLICT(modelo) DO UPDATE SET precio = excluded.precio`,
    [modelo, precio]
  );
  res.json({ ok: true });
});

app.delete('/api/admin/stickers/:id', requireAdmin, async (req, res) => {
  const stickerId = Number(req.params.id);
  const sticker = await get('SELECT * FROM stickers_actual WHERE id = ?', [stickerId]);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (sticker.estado !== 'en_stock') {
    return res.status(409).json({ error: 'Solo se puede eliminar stock que todavía no fue vendido.' });
  }
  // sticker_estados tiene ON DELETE CASCADE — se lleva puesto todo el historial de estados.
  await run('DELETE FROM stickers WHERE id = ?', [stickerId]);
  res.status(204).end();
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
    SELECT ve.*, v.nombre AS vendedor_nombre
    FROM ventas ve
    LEFT JOIN vendedores v ON v.id = ve.vendedor_id
    ${where}
    ORDER BY ve.fecha DESC
  `,
    args
  );

  // Una venta puede tener varios stickers — traemos los códigos de todas de
  // una sola consulta y los agrupamos en memoria en vez de hacer N+1.
  const itemRows = rows.length
    ? await all(
        `SELECT vi.venta_id, s.codigo_publico, s.modelo FROM venta_items vi
         JOIN stickers_actual s ON s.id = vi.sticker_id
         WHERE vi.venta_id IN (${rows.map(() => '?').join(',')})`,
        rows.map((r) => r.id)
      )
    : [];
  const itemsPorVenta = new Map();
  for (const it of itemRows) {
    if (!itemsPorVenta.has(it.venta_id)) itemsPorVenta.set(it.venta_id, []);
    itemsPorVenta.get(it.venta_id).push({ stickerCodigo: it.codigo_publico, modelo: it.modelo || 'suelto' });
  }

  res.json(
    rows.map((r) => ({
      id: r.id,
      items: itemsPorVenta.get(r.id) || [],
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
  const sticker = await get('SELECT * FROM stickers_actual WHERE codigo_publico = ?', [req.params.codigo]);

  if (sticker && sticker.estado === 'activo') {
    const destino = await get('SELECT * FROM destinos WHERE sticker_id = ?', [sticker.id]);
    if (destino) return res.redirect(302, destino.valor);
  }

  // Lote especial todavía sin activar: el primer tap del comprador lo lleva
  // directo a la pantalla de activación libre (no a la landing).
  if (sticker && esLoteEspecial(sticker.uid_nfc) && sticker.comprador_id == null) {
    return res.redirect(302, `${FRONTEND_URL}/activacion/${sticker.codigo_publico}`);
  }

  // Sticker inexistente, todavía no activado, o sin destino cargado — no hay
  // pantalla de activación construida todavía (RF-08/09), así que por ahora
  // cae a la landing en vez de mostrar un error crudo.
  res.redirect(302, FRONTEND_URL);
});

// --- Activación libre del lote especial (sin vendedor, sin pago, sin OTP) ---
// Posesión física del sticker = dueño legítimo. Ver LOTE_ESPECIAL_PREFIX.

app.get('/api/activacion/:codigo', routerThrottle, async (req, res) => {
  const sticker = await get('SELECT * FROM stickers_actual WHERE codigo_publico = ?', [req.params.codigo]);
  if (!sticker || !esLoteEspecial(sticker.uid_nfc)) {
    return res.status(404).json({ error: 'Este código no corresponde a un sticker activable.' });
  }
  const yaActivado = sticker.comprador_id != null;
  const destino = yaActivado ? await get('SELECT valor FROM destinos WHERE sticker_id = ?', [sticker.id]) : null;
  res.json({
    codigo: sticker.codigo_publico,
    modelo: sticker.modelo || 'llavero',
    yaActivado,
    // Si ya está activado, el tap tiene que ir al destino configurado — la
    // página de activación redirige ahí en vez de mostrarse.
    destino: destino ? destino.valor : null,
    tipos: DESTINO_TIPOS,
  });
});

// La identidad del que activa se verifica con el mismo canal que el login del
// comprador (`canalVerificacion`: email hoy). El front hace el ciclo OTP normal
// (/api/auth/otp/request + /verify), consigue un token de sesión y llega acá ya
// autenticado — por eso este endpoint usa `requireAuth` y no pide ningún dato
// de contacto: lo toma de `req.comprador`.
app.post('/api/activacion/:codigo', requireAuth, async (req, res) => {
  const tipo = String(req.body?.tipo || '').trim();
  const valor = String(req.body?.valor || '').trim();

  if (!DESTINO_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Elegí un tipo de destino.' });
  if (!valor) return res.status(400).json({ error: 'Completá a dónde tiene que redirigir el sticker.' });

  const sticker = await get('SELECT * FROM stickers_actual WHERE codigo_publico = ?', [req.params.codigo]);
  if (!sticker || !esLoteEspecial(sticker.uid_nfc)) {
    return res.status(404).json({ error: 'Este código no corresponde a un sticker activable.' });
  }
  if (sticker.comprador_id != null) {
    return res.status(409).json({ error: 'Este sticker ya fue activado. Entrá a "Mi panel" para editarlo.' });
  }

  const comprador = req.comprador;

  await transicionarSticker(sticker.id, { comprador_id: comprador.id, funcion: tipo, estado: 'activo' });

  await db.execute({
    sql: `INSERT INTO destinos (sticker_id, tipo, valor, actualizado_en) VALUES (?, ?, ?, NOW())
          ON CONFLICT(sticker_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, actualizado_en = NOW()`,
    args: [sticker.id, tipo, valor],
  });
  await run(
    `INSERT INTO historial_cambios (sticker_id, comprador_id, campo_modificado, valor_anterior, valor_nuevo)
     VALUES (?, ?, 'activacion', NULL, ?)`,
    [sticker.id, comprador.id, `${tipo}:${valor}`]
  );

  res.status(201).json({ ok: true, panelUrl: `${FRONTEND_URL}/mi-panel.html` });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API en http://localhost:${PORT}`);
});
