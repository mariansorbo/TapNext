import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { randomBytes, createHmac } from 'node:crypto';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { db } from './db.js';
import { generateOtp, hashValue, generateToken, generateLinkToken } from './otp.js';
import { enviarCorreo, mailCompraComprador, mailVentaVendedor } from './correo.js';
import { canalVerificacion, canalPorId, CAMPOS_COMPRADOR_VALIDOS } from './verificacion/index.js';
import { DESTINO_TIPOS, DESTINO_META, normalizarDestino, aUrlAbsoluta } from './destinos.js';

const PORT = process.env.PORT || 3001;
const OTP_TTL_MINUTES = 5;
const OTP_THROTTLE_SECONDS = 30;
const SESSION_TTL_MINUTES = 30;

// Lote especial: stickers ya impresos sobre un material que NO admite candado
// físico (no se puede write-lock el chip) y que NO llevan ningún ID impreso.
// No nos interesa leer ni registrar su UID real — se dan de alta con un
// uid_nfc sentinel = LOTE_ESPECIAL_PREFIX + codigo_publico. Cuando el uid
// arranca con ese prefijo, el sticker sigue un flujo de venta aparte:
// quien lo tiene en la mano lo activa (posesión física = dueño legítimo),
// sin vendedor, sin pago y sin OTP previo. Ver activacion.html + /api/activacion.
const LOTE_ESPECIAL_PREFIX = '00000';
const esLoteEspecial = (uidNfc) => typeof uidNfc === 'string' && uidNfc.startsWith(LOTE_ESPECIAL_PREFIX);

// Vendedor por defecto del proceso de activación libre (lote especial): a él se
// le atribuye la venta al activar, y a él se le asigna el stock del lote al
// crearlo. Se resuelve por codigo_ref; sobreescribible por env var.
const LOTE_ESPECIAL_VENDEDOR_REF = process.env.LOTE_ESPECIAL_VENDEDOR_REF || 'marianovich';
async function vendedorEspecialId() {
  if (!LOTE_ESPECIAL_VENDEDOR_REF) return null;
  const v = await get('SELECT id FROM vendedores WHERE codigo_ref = ?', [LOTE_ESPECIAL_VENDEDOR_REF]);
  return v ? v.id : null;
}

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
// URL pública de ESTE backend. El webhook de Mercado Pago tiene que pegarle a
// Render directo — PUBLIC_ROUTER_BASE puede apuntar al dominio del frontend
// (para que los links /v/ queden lindos), y ahí el webhook daría 404. Render
// setea RENDER_EXTERNAL_URL solo; en local cae a PUBLIC_ROUTER_BASE.
const API_PUBLIC_URL =
  process.env.RENDER_EXTERNAL_URL || process.env.API_PUBLIC_URL || PUBLIC_ROUTER_BASE;

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

// --- Activación liberada (ver "Activación liberada" en el vault NextTap - Knowledge) ---
// Una liberación es un permiso para activar un sticker GRATIS (sin Mercado Pago).
// Está "vigente" mientras no se usó, no se revocó y no venció.
async function liberacionVigente(stickerId) {
  return get(
    `SELECT * FROM activaciones_liberadas
      WHERE sticker_id = ? AND usada_en IS NULL AND revocada_en IS NULL
        AND (expira_en IS NULL OR expira_en > NOW())
      ORDER BY id DESC LIMIT 1`,
    [stickerId]
  );
}

// Foto del estado actual de un sticker, para el antes/después de la bitácora.
async function snapshotSticker(stickerId) {
  const s = await get(
    'SELECT estado, funcion, modelo, vendedor_id, comprador_id FROM stickers_actual WHERE id = ?',
    [stickerId]
  );
  if (!s) return null;
  const d = await get('SELECT tipo, valor FROM destinos WHERE sticker_id = ?', [stickerId]);
  return { ...s, destino: d ? `${d.tipo}:${d.valor}` : null };
}

// Bitácora de acciones manuales del admin (sticker_eventos_admin) — el "porqué"
// que sticker_estados no guarda.
async function registrarEventoAdmin(stickerId, tipo, { antes = null, despues = null, motivo = null } = {}) {
  await run(
    `INSERT INTO sticker_eventos_admin (sticker_id, tipo, antes, despues, motivo) VALUES (?, ?, ?, ?, ?)`,
    [stickerId, tipo, antes ? JSON.stringify(antes) : null, despues ? JSON.stringify(despues) : null, motivo || null]
  );
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
    destinos: DESTINO_TIPOS.map((id) => ({ id, ...DESTINO_META[id] })),
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

  if (!DESTINO_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de destino inválido.' });
  const norm = normalizarDestino(tipo, req.body?.valor);
  if (norm.error) return res.status(400).json({ error: norm.error });
  const valor = norm.valor;

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
// Resuelve el ref del link presencial (?s=) a un vendedor y, si el link es de
// una promo (vendedor_promo_tokens), también a esa promo. Orden de resolución:
// token de promo → link_token común → codigo_ref legacy.
async function resolverRefPresencial(ref) {
  if (!ref) return { vendedor: null, promocionId: null };
  const promoTok = await get(
    `SELECT v.id, v.nombre, t.promocion_id
       FROM vendedor_promo_tokens t
       JOIN vendedores v ON v.id = t.vendedor_id
       JOIN promociones p ON p.id = t.promocion_id
      WHERE t.token = ? AND p.activa`,
    [ref]
  );
  if (promoTok) {
    return { vendedor: { id: promoTok.id, nombre: promoTok.nombre }, promocionId: promoTok.promocion_id };
  }
  const v = await get('SELECT id, nombre FROM vendedores WHERE link_token = ? OR codigo_ref = ?', [ref, ref]);
  return { vendedor: v || null, promocionId: null };
}

// Aplica una promo a las unidades reservadas. En el flujo actual todas son del
// mismo modelo, pero se agrupa por modelo por robustez. Devuelve el mismo array
// con `precio` (final) en cada item. Sin promo → precio de lista.
function preciosConPromo(reservados, promo, montosPorModelo) {
  if (!promo) return reservados.map((r) => ({ ...r, precio: r.precioLista }));
  const n = promo.unidades_pack;
  const idxPorModelo = new Map();
  reservados.forEach((r, i) => {
    const m = r.item.modelo;
    if (!idxPorModelo.has(m)) idxPorModelo.set(m, []);
    idxPorModelo.get(m).push(i);
  });
  const precioFinal = new Array(reservados.length);
  for (const [modelo, idxs] of idxPorModelo) {
    const unit = reservados[idxs[0]].precioLista;
    const enPromo = Math.floor(idxs.length / n) * n; // unidades que entran en un grupo completo
    let totalGrupo;
    if (promo.modo_precio === 'monto_fijo') {
      const montoPack = montosPorModelo.get(modelo);
      totalGrupo = montoPack == null ? unit * n : montoPack; // sin monto para ese modelo → la promo no aplica
    } else {
      totalGrupo = unit * n * (1 - Number(promo.descuento_pct) / 100);
    }
    idxs.forEach((idx, k) => {
      if (k >= enPromo) {
        precioFinal[idx] = unit;
        return;
      }
      // Repartimos el total del grupo entre sus n unidades; el sobrante del
      // redondeo cae en la primera, para que la suma del grupo dé exacta.
      const base = Math.round(totalGrupo / n);
      precioFinal[idx] = k % n === 0 ? totalGrupo - base * (n - 1) : base;
    });
  }
  return reservados.map((r, i) => ({ ...r, precio: precioFinal[i] }));
}

app.get('/api/public/vendedores/:ref/stock', async (req, res) => {
  const ref = String(req.params.ref || '').trim().toLowerCase();
  const { vendedor, promocionId } = await resolverRefPresencial(ref);
  if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });

  // Si el link es de una promo, el wizard avisa en el paso 1 cuánto falta para
  // llegar al pack (el mínimo real lo valida POST /api/ventas).
  let promo = null;
  if (promocionId) {
    const p = await get('SELECT slug, nombre, unidades_pack FROM promociones WHERE id = ? AND activa', [promocionId]);
    if (p) promo = { slug: p.slug, nombre: p.nombre, unidadesPack: p.unidades_pack };
  }

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
  // Combos modelo+función realmente en mano — el wizard de compra fusiona los
  // pasos "función" y "modelo" en uno solo y arma sus tarjetas desde acá.
  // El stock con funcion IS NULL (sin función asignada) no arma combo vendible:
  // hay que asignarle función desde el panel de Admin para que aparezca.
  const comboRows = await all(
    `SELECT modelo, funcion, COUNT(*) AS cantidad
     FROM stickers_actual
     WHERE vendedor_id = ? AND estado = ? AND funcion IS NOT NULL
     GROUP BY modelo, funcion`,
    [vendedor.id, 'en_stock']
  );
  // modelo NULL = sticker sin impreso 3D ("suelto") — se agrupa como su propio bucket.
  res.json({
    vendedor: vendedor.nombre,
    modelos: rows.map((r) => ({ modelo: r.modelo || 'suelto', cantidad: r.cantidad })),
    funciones: funcionRows.map((r) => r.funcion),
    combos: comboRows.map((r) => ({ modelo: r.modelo || 'suelto', funcion: r.funcion, cantidad: r.cantidad })),
    promo,
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
    // Pero si lo cargó, lo validamos ya (y se guarda normalizado más abajo).
    if (String(item?.destinoValor || '').trim()) {
      const norm = normalizarDestino(destinoTipo, item.destinoValor);
      if (norm.error) return res.status(400).json({ error: norm.error });
    }
  }

  // Resuelve vendedor + promo por el token del link presencial (acepta el token
  // común, un token de promo, o el codigo_ref legacy).
  const { vendedor, promocionId } = await resolverRefPresencial(vendedorToken);

  // Si el link era de una promo, la cargamos para calcular el descuento y
  // validar el mínimo de unidades.
  let promo = null;
  const montosPromo = new Map();
  if (promocionId) {
    promo = await get('SELECT * FROM promociones WHERE id = ? AND activa', [promocionId]);
    if (promo) {
      if (items.length < promo.unidades_pack) {
        return res.status(400).json({ error: `La promo ${promo.nombre} necesita al menos ${promo.unidades_pack} unidades.` });
      }
      const montoRows = await all('SELECT modelo, monto_pack FROM promocion_montos WHERE promocion_id = ?', [promo.id]);
      for (const m of montoRows) montosPromo.set(m.modelo, m.monto_pack);
    }
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
    reservados.push({ sticker, item, precioLista: precioRow.precio });
  }

  // Resuelve el precio final de cada unidad según la promo (o precio de lista).
  const conPromo = preciosConPromo(reservados, promo, montosPromo);

  let vendedorIdVenta = vendedor?.id || null;
  const montoItems = conPromo.reduce((sum, r) => sum + r.precio, 0);
  const monto = montoItems + (envio ? Number(envio.price) : 0);

  for (const { sticker } of conPromo) {
    await transicionarSticker(sticker.id, { comprador_id: req.comprador.id, estado: 'vendido_pendiente' });
    if (!vendedorIdVenta && sticker.vendedor_id) vendedorIdVenta = sticker.vendedor_id;
  }

  const ventaResult = await run(
    `INSERT INTO ventas (vendedor_id, comprador_id, monto, estado_pago, promocion_id) VALUES (?, ?, ?, 'pendiente', ?)`,
    [vendedorIdVenta, req.comprador.id, monto, promo ? promo.id : null]
  );
  const ventaId = ventaResult.lastInsertRowid;

  for (const { sticker, item, precio } of conPromo) {
    await run('INSERT INTO venta_items (venta_id, sticker_id, monto, destino_tipo, destino_valor) VALUES (?, ?, ?, ?, ?)', [
      ventaId,
      sticker.id,
      precio,
      String(item.destinoTipo).trim(),
      String(item.destinoValor || '').trim()
        ? normalizarDestino(String(item.destinoTipo).trim(), item.destinoValor).valor || null
        : null,
    ]);
  }

  try {
    const mpItems = conPromo.map(({ item, precio }) => ({
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
        notification_url: `${API_PUBLIC_URL}/api/pagos/webhook`,
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

// Manda los avisos post-venta (pago ya confirmado). Nunca lanza: si falta el
// mail de alguna de las partes, o Resend no está configurado, se saltea esa
// parte y sigue. Se llama una sola vez por venta — el webhook sale temprano si
// la venta ya estaba 'confirmado'.
async function notificarVentaConfirmada(ventaId) {
  try {
    const venta = await get('SELECT * FROM ventas WHERE id = ?', [ventaId]);
    if (!venta) return;

    const items = await all(
      `SELECT s.codigo_publico, s.modelo
         FROM venta_items vi JOIN stickers_actual s ON s.id = vi.sticker_id
        WHERE vi.venta_id = ?
        ORDER BY vi.id`,
      [ventaId]
    );
    if (!items.length) return;
    const itemsMail = items.map((r) => ({ codigoPublico: r.codigo_publico, modelo: r.modelo }));
    const panelComprador = `${FRONTEND_URL}/mi-panel.html`;
    const panelVendedor = `${FRONTEND_URL}/vendedor.html`;

    const comprador = venta.comprador_id
      ? await get('SELECT nombre, whatsapp, email FROM compradores WHERE id = ?', [venta.comprador_id])
      : null;
    if (comprador?.email) {
      const { subject, text, html } = mailCompraComprador({ items: itemsMail, panelUrl: panelComprador });
      await enviarCorreo({ to: comprador.email, subject, text, html });
    } else {
      console.log(`[correo] Venta ${ventaId}: el comprador no tiene mail cargado — no se le avisa.`);
    }

    const vendedor = venta.vendedor_id
      ? await get('SELECT nombre, email FROM vendedores WHERE id = ?', [venta.vendedor_id])
      : null;
    if (vendedor?.email) {
      const { subject, text, html } = mailVentaVendedor({
        items: itemsMail,
        comprador,
        monto: venta.monto,
        panelUrl: panelVendedor,
      });
      await enviarCorreo({ to: vendedor.email, subject, text, html });
    } else if (venta.vendedor_id) {
      console.log(`[correo] Venta ${ventaId}: el vendedor no tiene mail cargado — no se le avisa.`);
    }
  } catch (err) {
    console.error(`[correo] Error armando los avisos de la venta ${ventaId}:`, err.message);
  }
}

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
          // Ya debería venir normalizado desde /api/ventas, pero re-normalizamos
          // por las dudas (ventas viejas, cargas manuales) y caemos al crudo si
          // no valida — mejor un destino raro que ninguno.
          const norm = normalizarDestino(item.destino_tipo, item.destino_valor);
          await db.execute({
            sql: `INSERT INTO destinos (sticker_id, tipo, valor, actualizado_en) VALUES (?, ?, ?, NOW())
             ON CONFLICT(sticker_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, actualizado_en = NOW()`,
            args: [item.sticker_id, item.destino_tipo, norm.valor || aUrlAbsoluta(item.destino_valor) || item.destino_valor],
          });
        }
        await transicionarSticker(item.sticker_id, { estado: 'activo' });
        // Si este sticker se activó vía una "activación liberada con pago",
        // marcamos esa liberación como usada (la gratis se marca en el POST).
        await run(
          `UPDATE activaciones_liberadas SET usada_en = NOW(), usada_por_comprador_id = ?, venta_id = ?
            WHERE sticker_id = ? AND gratis = FALSE AND usada_en IS NULL AND revocada_en IS NULL`,
          [venta.comprador_id, ventaId, item.sticker_id]
        );
      }
      // Aviso por mail (best-effort) al comprador y al vendedor con el/los
      // codigo_publico que corresponden a esta venta — es el ID que el
      // vendedor tiene que entregar y el comprador tiene que recibir.
      await notificarVentaConfirmada(ventaId);
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

// --- Panel del vendedor (/vendedor) — login con contraseña + WhatsApp o email,
// ver qué stickers vendidos todavía tiene que entregar (RS-06: verificación de
// entrega física por codigo_publico). ---

const ES_EMAIL = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

app.post('/api/vendedor/login', async (req, res) => {
  // Acepta `identificador` (nuevo, whatsapp o email) y `whatsapp` (compat).
  const identificador = String(req.body?.identificador || req.body?.whatsapp || req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!identificador || !password) return res.status(400).json({ error: 'Faltan datos.' });

  const porEmail = identificador.includes('@');
  const vendedor = await get(
    porEmail
      ? 'SELECT * FROM vendedores WHERE LOWER(email) = LOWER(?)'
      : 'SELECT * FROM vendedores WHERE whatsapp = ?',
    [identificador]
  );
  if (!vendedor || !vendedor.password_hash) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  const ok = await bcrypt.compare(password, vendedor.password_hash);
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

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
  // Links de promo por vendedor (uno por promo activa), para el modal "Ver links".
  const promoTokens = await all(`
    SELECT t.vendedor_id, t.token, p.nombre
      FROM vendedor_promo_tokens t
      JOIN promociones p ON p.id = t.promocion_id
     WHERE p.activa
     ORDER BY p.id
  `);
  const linksPromoPorVendedor = new Map();
  for (const t of promoTokens) {
    if (!linksPromoPorVendedor.has(t.vendedor_id)) linksPromoPorVendedor.set(t.vendedor_id, []);
    linksPromoPorVendedor
      .get(t.vendedor_id)
      .push({ nombre: t.nombre, url: `${PUBLIC_ROUTER_BASE}/comprar.html?s=${t.token}` });
  }
  res.json(
    vendedores.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      codigoRef: v.codigo_ref,
      linkToken: v.link_token,
      linkCompra: `${PUBLIC_ROUTER_BASE}/comprar.html?s=${v.link_token}`,
      links: [
        { nombre: 'Venta común', url: `${PUBLIC_ROUTER_BASE}/comprar.html?s=${v.link_token}` },
        ...(linksPromoPorVendedor.get(v.id) || []),
      ],
      comisionPct: v.comision_pct,
      whatsapp: v.whatsapp,
      email: v.email,
      aliasMp: v.alias_mp,
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
  const email = String(req.body?.email || '').trim().toLowerCase();
  const aliasMp = String(req.body?.aliasMp || '').trim();
  const password = String(req.body?.password || '');

  if (!nombre || !codigoRef) return res.status(400).json({ error: 'Faltan datos.' });
  if (!/^[a-z0-9-]+$/.test(codigoRef)) {
    return res.status(400).json({ error: 'El código de referencia solo puede tener letras, números y guiones.' });
  }
  if (email && !ES_EMAIL(email)) return res.status(400).json({ error: 'El email no tiene un formato válido.' });
  const contacto = whatsapp || email;
  if (contacto && !password) {
    return res.status(400).json({ error: 'Si cargás WhatsApp o email para su login, definí también una contraseña.' });
  }

  const existe = await get('SELECT id FROM vendedores WHERE codigo_ref = ?', [codigoRef]);
  if (existe) return res.status(409).json({ error: 'Ya existe un vendedor con ese código de referencia.' });
  if (whatsapp) {
    const otroWa = await get('SELECT id FROM vendedores WHERE whatsapp = ?', [whatsapp]);
    if (otroWa) return res.status(409).json({ error: 'Ya existe un vendedor con ese WhatsApp.' });
  }
  if (email) {
    const otroMail = await get('SELECT id FROM vendedores WHERE LOWER(email) = ?', [email]);
    if (otroMail) return res.status(409).json({ error: 'Ya existe un vendedor con ese email.' });
  }

  const passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null;
  const linkToken = generateLinkToken();
  const result = await run(
    'INSERT INTO vendedores (nombre, codigo_ref, comision_pct, whatsapp, email, alias_mp, password_hash, link_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [nombre, codigoRef, comisionPct, whatsapp || null, email || null, aliasMp || null, passwordHash, linkToken]
  );
  const nuevoVendedorId = result.lastInsertRowid;
  // Un token de link por cada promo activa (mismo criterio que el backfill de db.js).
  const promosActivas = await all('SELECT id FROM promociones WHERE activa');
  for (const p of promosActivas) {
    await run('INSERT INTO vendedor_promo_tokens (vendedor_id, promocion_id, token) VALUES (?, ?, ?)', [
      nuevoVendedorId,
      p.id,
      generateLinkToken(),
    ]);
  }
  res.status(201).json({
    id: nuevoVendedorId,
    nombre,
    codigoRef,
    linkToken,
    linkCompra: `${PUBLIC_ROUTER_BASE}/comprar.html?s=${linkToken}`,
    comisionPct,
    whatsapp: whatsapp || null,
    email: email || null,
    aliasMp: aliasMp || null,
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
  const email = 'email' in (req.body || {})
    ? String(req.body.email || '').trim().toLowerCase()
    : (vendedor.email || '');
  const aliasMp = 'aliasMp' in (req.body || {})
    ? String(req.body.aliasMp || '').trim()
    : (vendedor.alias_mp || '');
  const password = String(req.body?.password || '');

  if (!nombre || !codigoRef) return res.status(400).json({ error: 'Faltan datos.' });
  if (!/^[a-z0-9-]+$/.test(codigoRef)) {
    return res.status(400).json({ error: 'El código de referencia solo puede tener letras, números y guiones.' });
  }
  if (email && !ES_EMAIL(email)) return res.status(400).json({ error: 'El email no tiene un formato válido.' });
  const contacto = whatsapp || email;
  if (contacto && !password && !vendedor.password_hash) {
    return res.status(400).json({ error: 'Si cargás WhatsApp o email para su login, definí también una contraseña.' });
  }

  const otro = await get('SELECT id FROM vendedores WHERE codigo_ref = ? AND id != ?', [codigoRef, vendedorId]);
  if (otro) return res.status(409).json({ error: 'Ya existe otro vendedor con ese código de referencia.' });
  if (whatsapp) {
    const otroWa = await get('SELECT id FROM vendedores WHERE whatsapp = ? AND id != ?', [whatsapp, vendedorId]);
    if (otroWa) return res.status(409).json({ error: 'Ya existe otro vendedor con ese WhatsApp.' });
  }
  if (email) {
    const otroMail = await get('SELECT id FROM vendedores WHERE LOWER(email) = ? AND id != ?', [email, vendedorId]);
    if (otroMail) return res.status(409).json({ error: 'Ya existe otro vendedor con ese email.' });
  }

  const passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : vendedor.password_hash;
  await run('UPDATE vendedores SET nombre = ?, codigo_ref = ?, comision_pct = ?, whatsapp = ?, email = ?, alias_mp = ?, password_hash = ? WHERE id = ?', [
    nombre,
    codigoRef,
    comisionPct,
    whatsapp || null,
    email || null,
    aliasMp || null,
    contacto ? passwordHash : null,
    vendedorId,
  ]);
  res.json({ id: vendedorId, nombre, codigoRef, comisionPct, whatsapp: whatsapp || null, email: email || null, aliasMp: aliasMp || null });
});

app.delete('/api/admin/vendedores/:id', requireAdmin, async (req, res) => {
  const vendedorId = Number(req.params.id);
  const vendedor = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
  if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });

  const stock = await get('SELECT id FROM stickers_actual WHERE vendedor_id = ? LIMIT 1', [vendedorId]);
  if (stock) return res.status(409).json({ error: 'Tiene stock asignado — reasigná o eliminá esos stickers primero.' });
  const venta = await get('SELECT id FROM ventas WHERE vendedor_id = ? LIMIT 1', [vendedorId]);
  if (venta) return res.status(409).json({ error: 'Tiene ventas registradas — no se puede eliminar un vendedor con historial.' });

  // Sin stock ni ventas: lo único que puede colgar es alguna sesión de panel.
  await run('DELETE FROM vendedor_sesiones WHERE vendedor_id = ?', [vendedorId]);
  await run('DELETE FROM vendedores WHERE id = ?', [vendedorId]);
  res.status(204).end();
});

app.get('/api/admin/stickers', requireAdmin, async (req, res) => {
  const rows = await all(`
    SELECT s.id, s.codigo_publico, s.uid_nfc, s.estado, s.funcion, s.modelo, s.protegido_en, s.creado_en, s.vigente_desde,
      s.lote_id, l.nombre AS lote_nombre, l.cantidad AS lote_cantidad, l.creado_en AS lote_creado_en, l.tipo AS lote_tipo,
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
      // Lote especial: modelo y función quedaron fijados al crear el lote —
      // el panel los muestra de solo lectura (ver admin.js).
      loteEspecial: esLoteEspecial(r.uid_nfc),
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
      loteId: r.lote_id,
      loteCantidad: r.lote_cantidad,
      loteCreadoEn: r.lote_creado_en,
      // Etiqueta libre del lote, si se le puso una (ej. "Activación Bloqueada").
      loteTipoNombre: r.lote_tipo || null,
      // Tipo derivado: 'especial' (llaveros pre-impresos sin candado, UID
      // sentinel), 'normal' (tanda registrada junta desde el panel), o
      // 'suelto' (chip cargado de a uno en el taller, sin lote).
      loteTipo: esLoteEspecial(r.uid_nfc) ? 'especial' : (r.lote_id ? 'normal' : 'suelto'),
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
  const nombre = String(req.body?.nombre || '').trim() || `Lote especial ${new Date().toISOString().slice(0, 10)}`;
  const modeloDefault = String(req.body?.modelo || 'llavero').trim();
  // Sobrescribir: si ya hay un lote con este mismo nombre, en vez de crear uno
  // nuevo (y quedar con dos lotes homónimos) se le agregan los stickers al
  // lote existente. Los stickers que ya tenía no se tocan.
  const sobrescribir = req.body?.sobrescribir === true || req.body?.overwrite === true;

  // Tres formas de decir qué crear (en orden de prioridad):
  //  - items:   [{ modelo, funcion, codigo? }] → uno por entrada, con su función
  //  - codigos: ["abc123", ...]                → stickers ya grabados afuera
  //  - cantidad + modelo                       → N iguales, sin función
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  const codigosPedidos = Array.isArray(req.body?.codigos)
    ? req.body.codigos.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean)
    : null;

  let specs;
  if (items) {
    if (!items.length) return res.status(400).json({ error: 'Agregá al menos un sticker.' });
    specs = items.map((it) => ({
      codigo: it?.codigo ? String(it.codigo).trim().toLowerCase() : null,
      modelo: String(it?.modelo || modeloDefault).trim(),
      funcion: it?.funcion ? String(it.funcion).trim() : null,
    }));
  } else if (codigosPedidos) {
    specs = codigosPedidos.map((c) => ({ codigo: c, modelo: modeloDefault, funcion: null }));
  } else {
    const cantidad = Math.min(Math.max(Number(req.body?.cantidad) || 0, 1), 100);
    specs = Array.from({ length: cantidad }, () => ({ codigo: null, modelo: modeloDefault, funcion: null }));
  }
  if (specs.length > 100) return res.status(400).json({ error: 'Máximo 100 stickers por lote.' });

  for (const s of specs) {
    if (!MODELOS.includes(s.modelo)) return res.status(400).json({ error: `Modelo inválido: ${s.modelo}` });
    if (s.funcion && !DESTINO_TIPOS.includes(s.funcion)) {
      return res.status(400).json({ error: `Función inválida: ${s.funcion}` });
    }
    if (s.codigo && !/^[a-z0-9]{3,32}$/.test(s.codigo)) {
      return res.status(400).json({ error: 'Cada código debe ser alfanumérico (3–32 chars).' });
    }
  }
  const codigos = specs.map((s) => s.codigo).filter(Boolean);
  if (new Set(codigos).size !== codigos.length) {
    return res.status(400).json({ error: 'Hay códigos repetidos en la lista.' });
  }
  if (codigos.length) {
    const enUso = await all(`SELECT codigo_publico FROM stickers WHERE codigo_publico = ANY(?)`, [codigos]);
    if (enUso.length) {
      return res.status(409).json({ error: `Ya existen: ${enUso.map((r) => r.codigo_publico).join(', ')}` });
    }
  }

  const loteExistente = sobrescribir
    ? await get('SELECT id FROM lotes WHERE nombre = ? ORDER BY id DESC LIMIT 1', [nombre])
    : null;
  let loteId;
  if (loteExistente) {
    loteId = loteExistente.id;
    await run('UPDATE lotes SET cantidad = COALESCE(cantidad, 0) + ? WHERE id = ?', [specs.length, loteId]);
  } else {
    const loteResult = await run('INSERT INTO lotes (nombre, cantidad) VALUES (?, ?)', [nombre, specs.length]);
    loteId = loteResult.lastInsertRowid;
  }
  const vendedorId = await vendedorEspecialId();

  const creados = [];
  for (const s of specs) {
    let codigoPublico = s.codigo;
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
    await crearEstadoInicial(result.lastInsertRowid, { modelo: s.modelo, funcion: s.funcion, vendedorId });
    creados.push({
      id: result.lastInsertRowid,
      codigoPublico,
      modelo: s.modelo,
      funcion: s.funcion,
      // Se graba el router del backend (302 puro): el primer tap de un lote
      // especial sin dueño redirige a /activacion/ desde /v/, y una vez
      // activado el tap va directo al destino sin pasar por ninguna pantalla.
      link: `${PUBLIC_ROUTER_BASE}/v/${codigoPublico}`,
    });
  }

  res.status(201).json({
    loteId,
    cantidad: creados.length,
    creados,
    links: creados.map((c) => c.link),
    loteReusado: Boolean(loteExistente),
  });
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
  // Sobrescribir: si el UID ya está registrado, en vez de cortar con 409 se
  // re-aplica función / modelo / vendedor / lote sobre el chip existente. El
  // codigo_publico (y por lo tanto la URL y las claves derivadas del UID) no
  // cambia. La activación y el dueño, si ya está activo, se conservan.
  const sobrescribir = req.body?.sobrescribir === true || req.body?.overwrite === true;

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

  const existente = await get('SELECT id, codigo_publico, lote_id FROM stickers WHERE uid_nfc = ?', [uidNfc]);
  if (existente && !sobrescribir) return res.status(409).json({ error: 'Ese UID ya está registrado.' });

  const writePassword = deriveChipPassword(uidNfc);
  const writePack = deriveChipPack(uidNfc);

  if (existente) {
    // El chip físico es el mismo (UID) → se conserva su codigo_publico y solo
    // se re-aplican los campos que vengan seteados en esta pasada.
    if (loteId && loteId !== existente.lote_id) {
      await run('UPDATE stickers SET lote_id = ? WHERE id = ?', [loteId, existente.id]);
      await run('UPDATE lotes SET cantidad = COALESCE(cantidad, 0) + 1 WHERE id = ?', [loteId]);
    }
    // No se toca `estado` ni `comprador_id`: si el chip ya estaba vendido /
    // activo, sigue estándolo — sobrescribir solo re-apunta función/modelo/vendedor.
    await transicionarSticker(existente.id, {
      ...(modelo ? { modelo } : {}),
      ...(funcion ? { funcion } : {}),
      ...(vendedorId ? { vendedor_id: vendedorId } : {}),
    });
    return res.status(200).json({
      id: existente.id,
      codigoPublico: existente.codigo_publico,
      uidNfc,
      loteId: loteId || existente.lote_id,
      url: `${PUBLIC_ROUTER_BASE}/v/${existente.codigo_publico}`,
      writePassword,
      writePack,
      sobrescrito: true,
    });
  }

  if (codigoImprimible) {
    const codigoEnUso = await get('SELECT id FROM stickers WHERE codigo_publico = ?', [codigoImprimible]);
    if (codigoEnUso) return res.status(409).json({ error: 'Ese ID de imprimible ya está en uso.' });
  }

  const codigoPublico = codigoImprimible || generateCodigoPublico();
  const result = await run('INSERT INTO stickers (codigo_publico, uid_nfc, lote_id) VALUES (?, ?, ?)', [
    codigoPublico,
    uidNfc,
    loteId,
  ]);
  await crearEstadoInicial(result.lastInsertRowid, { modelo: modelo || null, funcion: funcion || null, vendedorId });
  // Mantenemos `cantidad` del lote al día a medida que se le suman chips
  // (el asistente de grabado carga de a uno) — así la grilla muestra el x N real.
  if (loteId) {
    await run('UPDATE lotes SET cantidad = COALESCE(cantidad, 0) + 1 WHERE id = ?', [loteId]);
  }

  res.status(201).json({
    id: result.lastInsertRowid,
    codigoPublico,
    uidNfc,
    loteId,
    url: `${PUBLIC_ROUTER_BASE}/v/${codigoPublico}`,
    writePassword,
    writePack,
  });
});

// Lotes: listar y crear uno vacío. El asistente de grabado de chips crea un
// lote al empezar una tanda y le va sumando cada chip (loteId en
// /stickers/individual), así el taller sabe qué lote está escribiendo.
app.get('/api/admin/lotes', requireAdmin, async (req, res) => {
  const rows = await all(`
    SELECT l.id, l.nombre, l.tipo, l.creado_en, COUNT(s.id) AS chips
    FROM lotes l
    LEFT JOIN stickers s ON s.lote_id = l.id
    GROUP BY l.id, l.nombre, l.tipo, l.creado_en
    ORDER BY l.id DESC
  `);
  res.json(rows.map((r) => ({
    id: r.id, nombre: r.nombre, tipo: r.tipo || null, creadoEn: r.creado_en, chips: Number(r.chips) || 0,
  })));
});

app.post('/api/admin/lotes', requireAdmin, async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim()
    || `Taller ${new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  const tipo = String(req.body?.tipo || '').trim() || null;
  const result = await run('INSERT INTO lotes (nombre, tipo, cantidad) VALUES (?, ?, 0)', [nombre, tipo]);
  res.status(201).json({ id: result.lastInsertRowid, nombre, tipo });
});

// Editar nombre / tipo (etiqueta libre) de un lote existente.
app.patch('/api/admin/lotes/:id', requireAdmin, async (req, res) => {
  const loteId = Number(req.params.id);
  const lote = await get('SELECT id, nombre, tipo FROM lotes WHERE id = ?', [loteId]);
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado.' });
  const nombre = 'nombre' in (req.body || {}) ? String(req.body.nombre || '').trim() : lote.nombre;
  const tipo = 'tipo' in (req.body || {}) ? (String(req.body.tipo || '').trim() || null) : lote.tipo;
  if (!nombre) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
  await run('UPDATE lotes SET nombre = ?, tipo = ? WHERE id = ?', [nombre, tipo, loteId]);
  res.json({ id: loteId, nombre, tipo });
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

// --- Activación liberada: activar un producto GRATIS (sin Mercado Pago) ---
// Ver "Activación liberada" en el vault NextTap - Knowledge.

// Crea la instancia de activación liberada para un sticker. Opcionalmente
// re-aplica función/modelo/vendedor/lote (reescritura), y con `forzar` pisa un
// sticker que ya está activo o con dueño (reescritura maestra: anula la venta
// anterior, huérfana al comprador, borra el destino).
app.post('/api/admin/activaciones-liberadas', requireAdmin, async (req, res) => {
  const codigoPublico = String(req.body?.codigoPublico || '').trim().toLowerCase();
  const uidNfc = String(req.body?.uidNfc || '').trim();
  const motivo = String(req.body?.motivo || '').trim() || null;
  const expiraDias = Number(req.body?.expiraDias) || 0;
  const destinoTipo = String(req.body?.destinoTipo || '').trim() || null;
  const destinoValorRaw = String(req.body?.destinoValor || '').trim();
  const funcion = String(req.body?.funcion || '').trim();
  const modelo = String(req.body?.modelo || '').trim();
  const vendedorId = req.body?.vendedorId ? Number(req.body.vendedorId) : null;
  const loteId = req.body?.loteId ? Number(req.body.loteId) : null;
  const forzar = req.body?.forzar === true;
  // gratis = true (default): se activa sin pagar. false: "activación liberada"
  // a secas — se activa pagando por Mercado Pago, sin OTP.
  const gratis = req.body?.gratis !== false;

  if (!codigoPublico && !uidNfc) return res.status(400).json({ error: 'Indicá el código público o el UID del chip.' });
  if (funcion && !DESTINO_TIPOS.includes(funcion)) return res.status(400).json({ error: 'Función inválida.' });
  if (modelo && !MODELOS.includes(modelo)) return res.status(400).json({ error: 'Modelo inválido.' });
  if (destinoTipo && !DESTINO_TIPOS.includes(destinoTipo)) return res.status(400).json({ error: 'Tipo de destino inválido.' });

  const sticker = await get(
    `SELECT * FROM stickers WHERE ${codigoPublico ? 'codigo_publico = ?' : 'uid_nfc = ?'}`,
    [codigoPublico || uidNfc]
  );
  if (!sticker) return res.status(404).json({ error: 'No encontré ningún producto con ese código / UID.' });

  if (vendedorId) {
    const v = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
    if (!v) return res.status(404).json({ error: 'Vendedor no encontrado.' });
  }
  if (loteId) {
    const l = await get('SELECT id FROM lotes WHERE id = ?', [loteId]);
    if (!l) return res.status(404).json({ error: 'Lote no encontrado.' });
  }

  // Destino pre-cargado (opcional): si viene, se normaliza ya.
  let destinoValor = null;
  if (destinoValorRaw) {
    if (!destinoTipo) return res.status(400).json({ error: 'Elegí el tipo del destino pre-cargado.' });
    const norm = normalizarDestino(destinoTipo, destinoValorRaw);
    if (norm.error) return res.status(400).json({ error: norm.error });
    destinoValor = norm.valor;
  }

  const actual = await get('SELECT * FROM stickers_actual WHERE id = ?', [sticker.id]);
  let ventaAnuladaId = null;

  if (actual.estado !== 'en_stock') {
    if (!forzar) {
      return res.status(409).json({
        error: `Este producto está "${actual.estado}". Marcá "reescritura maestra" para forzar la liberación igual.`,
      });
    }

    const antes = await snapshotSticker(sticker.id);

    // Anular la venta confirmada vigente de este sticker (si la hay).
    const ventaVieja = await get(
      `SELECT v.* FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
        WHERE vi.sticker_id = ? AND v.estado_pago = 'confirmado' AND v.anulada_en IS NULL
        ORDER BY v.id DESC LIMIT 1`,
      [sticker.id]
    );
    if (ventaVieja) {
      // Si la comisión todavía estaba pendiente, además la sacamos del cálculo
      // (estado_pago -> 'anulado'). Si ya estaba liquidada, se deja 'confirmado':
      // la plata ya se transfirió, no se revierte.
      await run(
        `UPDATE ventas SET anulada_en = NOW(), anulada_motivo = 'reescritura_maestra'
         ${ventaVieja.comision_liquidada ? '' : ", estado_pago = 'anulado'"} WHERE id = ?`,
        [ventaVieja.id]
      );
      ventaAnuladaId = ventaVieja.id;
    }

    // Ventas pendientes (pago sin terminar) de este sticker: quedarían huérfanas.
    await run(
      `UPDATE ventas SET anulada_en = NOW(), anulada_motivo = 'reescritura_maestra', estado_pago = 'anulado'
        WHERE estado_pago = 'pendiente' AND anulada_en IS NULL
          AND id IN (SELECT venta_id FROM venta_items WHERE sticker_id = ?)`,
      [sticker.id]
    );

    await run('DELETE FROM destinos WHERE sticker_id = ?', [sticker.id]);
    await transicionarSticker(sticker.id, { estado: 'en_stock', comprador_id: null });
    await registrarEventoAdmin(sticker.id, 'reescritura_maestra', {
      antes,
      despues: await snapshotSticker(sticker.id),
      motivo: ventaAnuladaId ? `${motivo || ''} (venta #${ventaAnuladaId} anulada)`.trim() : motivo,
    });
  }

  // Reescritura opcional de función / modelo / vendedor / lote.
  if (funcion || modelo || vendedorId) {
    await transicionarSticker(sticker.id, {
      ...(modelo ? { modelo } : {}),
      ...(funcion ? { funcion } : {}),
      ...(vendedorId ? { vendedor_id: vendedorId } : {}),
    });
  }
  if (loteId && loteId !== sticker.lote_id) {
    await run('UPDATE stickers SET lote_id = ? WHERE id = ?', [loteId, sticker.id]);
    await run('UPDATE lotes SET cantidad = COALESCE(cantidad, 0) + 1 WHERE id = ?', [loteId]);
  }

  const vendedorLiberacion = vendedorId || (await vendedorEspecialId());
  const expiraEn = expiraDias > 0 ? new Date(Date.now() + expiraDias * 86_400_000).toISOString() : null;

  const r = await run(
    `INSERT INTO activaciones_liberadas (sticker_id, motivo, destino_tipo, destino_valor, vendedor_id, expira_en, gratis)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sticker.id, motivo, destinoTipo, destinoValor, vendedorLiberacion, expiraEn, gratis]
  );
  await registrarEventoAdmin(sticker.id, 'liberacion', {
    despues: { modo: gratis ? 'gratis' : 'con pago', motivo, destino: destinoValor ? `${destinoTipo}:${destinoValor}` : null, expiraEn, forzado: actual.estado !== 'en_stock' },
    motivo,
  });

  const claves = CHIP_MASTER_SECRET && sticker.uid_nfc && !esLoteEspecial(sticker.uid_nfc)
    ? { writePassword: deriveChipPassword(sticker.uid_nfc), writePack: deriveChipPack(sticker.uid_nfc) }
    : {};

  res.status(201).json({
    id: r.lastInsertRowid,
    codigoPublico: sticker.codigo_publico,
    url: `${PUBLIC_ROUTER_BASE}/v/${sticker.codigo_publico}`,
    activacionUrl: `${FRONTEND_URL}/activacion/${sticker.codigo_publico}`,
    forzado: actual.estado !== 'en_stock',
    ventaAnuladaId,
    gratis,
    ...claves,
  });
});

app.get('/api/admin/activaciones-liberadas', requireAdmin, async (req, res) => {
  const rows = await all(`
    SELECT a.*, s.codigo_publico, s.uid_nfc, sa.estado AS sticker_estado,
      v.nombre AS vendedor_nombre, c.email AS comprador_email
    FROM activaciones_liberadas a
    JOIN stickers s ON s.id = a.sticker_id
    LEFT JOIN stickers_actual sa ON sa.id = a.sticker_id
    LEFT JOIN vendedores v ON v.id = a.vendedor_id
    LEFT JOIN compradores c ON c.id = a.usada_por_comprador_id
    ORDER BY a.id DESC
  `);
  const ahora = Date.now();
  res.json(
    rows.map((r) => ({
      id: r.id,
      stickerId: r.sticker_id,
      codigoPublico: r.codigo_publico,
      stickerEstado: r.sticker_estado,
      motivo: r.motivo,
      gratis: r.gratis,
      destino: r.destino_valor ? { tipo: r.destino_tipo, valor: r.destino_valor } : null,
      vendedorNombre: r.vendedor_nombre,
      compradorEmail: r.comprador_email,
      creadaEn: r.creada_en,
      usadaEn: r.usada_en,
      revocadaEn: r.revocada_en,
      expiraEn: r.expira_en,
      estado: r.revocada_en
        ? 'revocada'
        : r.usada_en
          ? 'usada'
          : r.expira_en && new Date(r.expira_en).getTime() < ahora
            ? 'vencida'
            : 'vigente',
    }))
  );
});

app.delete('/api/admin/activaciones-liberadas/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const row = await get('SELECT * FROM activaciones_liberadas WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: 'Activación liberada no encontrada.' });
  if (row.usada_en) return res.status(409).json({ error: 'Esta activación liberada ya se usó — no se puede revocar.' });
  if (row.revocada_en) return res.status(409).json({ error: 'Ya estaba revocada.' });
  await run('UPDATE activaciones_liberadas SET revocada_en = NOW() WHERE id = ?', [id]);
  await registrarEventoAdmin(row.sticker_id, 'revocacion_liberacion', { motivo: row.motivo });
  res.status(204).end();
});

// Bitácora de acciones manuales del admin sobre un sticker.
app.get('/api/admin/stickers/:id/historial', requireAdmin, async (req, res) => {
  const stickerId = Number(req.params.id);
  const rows = await all(
    'SELECT tipo, antes, despues, motivo, creado_en FROM sticker_eventos_admin WHERE sticker_id = ? ORDER BY id DESC',
    [stickerId]
  );
  res.json(
    rows.map((r) => ({
      tipo: r.tipo,
      antes: r.antes,
      despues: r.despues,
      motivo: r.motivo,
      creadoEn: r.creado_en,
    }))
  );
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
      anulada: Boolean(r.anulada_en),
      anuladaMotivo: r.anulada_motivo || null,
      fecha: r.fecha,
    }))
  );
});

app.get('/api/admin/comisiones', requireAdmin, async (req, res) => {
  const rows = await all(`
    SELECT v.id, v.nombre, v.comision_pct, v.alias_mp,
      COALESCE(SUM(CASE WHEN ve.estado_pago = 'confirmado' THEN ve.monto ELSE 0 END), 0) AS ventas_totales,
      COALESCE(SUM(CASE WHEN ve.estado_pago = 'confirmado' AND ve.comision_liquidada = 0 THEN ve.monto ELSE 0 END), 0) AS base_pendiente,
      COALESCE(SUM(CASE WHEN ve.estado_pago = 'confirmado' AND ve.comision_liquidada = 1 THEN ve.monto ELSE 0 END), 0) AS base_liquidada,
      COUNT(CASE WHEN ve.estado_pago = 'confirmado' AND ve.comision_liquidada = 0 THEN 1 END) AS ventas_pendientes
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
      aliasMp: r.alias_mp,
      ventasTotales: r.ventas_totales,
      ventasPendientes: Number(r.ventas_pendientes),
      comisionPendiente: Math.round((r.base_pendiente * r.comision_pct) / 100),
      comisionLiquidada: Math.round((r.base_liquidada * r.comision_pct) / 100),
    }))
  );
});

// Liquidar de una toda la comisión pendiente de un vendedor: marca todas sus
// ventas confirmadas sin liquidar y les graba el número de operación de la
// transferencia + la fecha. El pago real se hace por fuera (transferencia
// manual en Mercado Pago); acá solo se registra.
app.post('/api/admin/comisiones/:vendedorId/liquidar', requireAdmin, async (req, res) => {
  const vendedorId = Number(req.params.vendedorId);
  const ref = String(req.body?.ref || '').trim();
  const vendedor = await get('SELECT id FROM vendedores WHERE id = ?', [vendedorId]);
  if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado.' });
  if (!ref) return res.status(400).json({ error: 'Falta el número de operación de la transferencia.' });

  const { rowsAffected } = await run(
    `UPDATE ventas SET comision_liquidada = 1, liquidacion_ref = ?, liquidada_en = NOW()
     WHERE vendedor_id = ? AND estado_pago = 'confirmado' AND comision_liquidada = 0`,
    [ref, vendedorId]
  );
  if (!rowsAffected) return res.status(400).json({ error: 'Este vendedor no tiene comisión pendiente.' });
  res.json({ ok: true, ventasLiquidadas: rowsAffected });
});

app.patch('/api/admin/ventas/:id/liquidar', requireAdmin, async (req, res) => {
  const ventaId = Number(req.params.id);
  const venta = await get('SELECT id FROM ventas WHERE id = ?', [ventaId]);
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada.' });
  await run('UPDATE ventas SET comision_liquidada = 1 WHERE id = ?', [ventaId]);
  res.json({ ok: true });
});

// Cancelar una venta que quedó en 'pendiente' (pago abandonado o webhook que
// nunca llegó): borra la venta y libera sus stickers de vuelta a 'en_stock'
// (misma lógica que la rama 'rejected' del webhook). Solo pendientes.
app.delete('/api/admin/ventas/:id', requireAdmin, async (req, res) => {
  const ventaId = Number(req.params.id);
  const venta = await get('SELECT * FROM ventas WHERE id = ?', [ventaId]);
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada.' });
  if (venta.estado_pago === 'confirmado') {
    return res.status(400).json({ error: 'No se puede cancelar una venta ya pagada.' });
  }
  const items = await all('SELECT * FROM venta_items WHERE venta_id = ?', [ventaId]);
  for (const item of items) {
    const actual = await get('SELECT estado FROM stickers_actual WHERE id = ?', [item.sticker_id]);
    if (actual && actual.estado !== 'activo') {
      await transicionarSticker(item.sticker_id, { comprador_id: null, estado: 'en_stock' });
    }
  }
  await run('DELETE FROM venta_items WHERE venta_id = ?', [ventaId]);
  await run('DELETE FROM ventas WHERE id = ?', [ventaId]);
  res.json({ ok: true, stickersLiberados: items.length });
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

// Pantalla de marca que se muestra un instante al tapear un sticker activado,
// antes de mandar al destino. Es la única superficie publicitaria de NextTap que
// ve quien tapea el sticker de otra persona (casi siempre un cliente potencial),
// así que vale ese ~1 s. HTML autónomo servido desde el backend: un request, sin
// bundle ni llamadas extra. Para quien repite el mismo sticker en <12 h se
// acorta a ~350 ms (el dueño no se come la intro cada vez). Sin JS, redirige ya.
function pantallaRedireccion(destino) {
  const jsUrl = JSON.stringify(String(destino))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const htmlUrl = String(destino)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>NextTap</title>
<noscript><meta http-equiv="refresh" content="0;url=${htmlUrl}"></noscript>
<style>
  :root{--ink:#14171A;--paper:#EDEFE9;--violet:#7B5CFF;--dur:1400ms}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{background:var(--ink);color:var(--paper);
    font-family:'Space Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;
    min-height:100svh;overflow:hidden;-webkit-font-smoothing:antialiased}
  .mark{display:flex;align-items:baseline;gap:.1em;font-weight:700;
    font-size:clamp(2.9rem,17vw,5.5rem);letter-spacing:-.03em;
    opacity:0;transform:translateY(10px) scale(.95);
    animation:rise .45s cubic-bezier(.2,.7,.2,1) forwards}
  .mark .tap{background:var(--violet);color:var(--ink);padding:.06em .26em .12em;
    border-radius:.16em;clip-path:inset(0 100% 0 0);
    animation:wipe .5s .14s cubic-bezier(.4,0,.1,1) forwards}
  .bar{width:min(150px,40vw);height:2px;border-radius:2px;background:rgba(237,239,233,.16);
    overflow:hidden;opacity:0;animation:rise .3s .25s forwards}
  .bar i{display:block;height:100%;background:var(--violet);
    transform:translateX(-100%);animation:fill var(--dur) .2s linear forwards}
  .cta{position:fixed;left:0;right:0;text-align:center;
    bottom:calc(env(safe-area-inset-bottom) + 22px);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;letter-spacing:.04em;
    color:rgba(237,239,233,.42);opacity:0;animation:rise .4s .5s forwards}
  @keyframes rise{to{opacity:1;transform:none}}
  @keyframes wipe{to{clip-path:inset(0 0 0 0)}}
  @keyframes fill{to{transform:translateX(0)}}
  @media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important}}
</style>
</head>
<body>
  <div class="mark">Next<span class="tap">Tap</span></div>
  <div class="bar"><i></i></div>
  <a class="cta" href="https://next-tap.tech">tu Instagram en un toque &middot; next-tap.tech</a>
  <script>
  (function(){
    var to=${jsUrl}, dur=1400;
    try{
      var k='nt:'+location.pathname, last=+localStorage.getItem(k)||0;
      if(Date.now()-last<432e5) dur=350;
      localStorage.setItem(k,String(Date.now()));
    }catch(e){}
    document.documentElement.style.setProperty('--dur',dur+'ms');
    var go=function(){location.replace(to)};
    var t=setTimeout(go,dur);
    addEventListener('pointerdown',function(){clearTimeout(t);go()},{once:true});
  })();
  </script>
</body>
</html>`;
}

// Pantalla para un chip que todavía no lleva a ningún lado: recién programado
// en el taller, o en stock de un vendedor sin vender. Estos son de venta
// presencial: NO se autoactivan (a diferencia del lote especial). Quien lo
// tapea solo ve que es real pero está sin activar — sin botones de acción,
// solo un link de texto a la marca. HTML autónomo, mismo criterio que
// pantallaRedireccion (un request, sin bundle).
function pantallaNoActivado(codigo) {
  const codigoHtml = String(codigo || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const codigoLinea = codigoHtml
    ? `<p class="codigo">C&oacute;digo del chip: <b>${codigoHtml}</b></p>`
    : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>NextTap — sticker sin activar</title>
<style>
  :root{--ink:#14171A;--paper:#EDEFE9;--violet:#7B5CFF}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{min-height:100%}
  body{background:var(--ink);color:var(--paper);
    font-family:'Space Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:22px;min-height:100svh;padding:32px 24px;text-align:center;-webkit-font-smoothing:antialiased}
  .mark{display:flex;align-items:baseline;gap:.1em;font-weight:700;font-size:clamp(2.2rem,12vw,3.4rem);letter-spacing:-.03em;margin-bottom:6px}
  .mark .tap{background:var(--violet);color:var(--ink);padding:.06em .26em .12em;border-radius:.16em}
  h1{font-size:clamp(1.3rem,6vw,1.8rem);font-weight:600;letter-spacing:-.02em;max-width:16ch}
  p{color:rgba(237,239,233,.62);max-width:32ch;line-height:1.5}
  p.codigo{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem;color:rgba(237,239,233,.5)}
  p.codigo b{color:var(--paper);letter-spacing:.06em}
  a.link{color:rgba(237,239,233,.5);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;letter-spacing:.03em;text-decoration:none;margin-top:6px}
</style>
</head>
<body>
  <div class="mark">Next<span class="tap">Tap</span></div>
  <h1>Este sticker todav&iacute;a no est&aacute; activado.</h1>
  <p>El chip funciona, pero todav&iacute;a no lleva a ning&uacute;n lado. Se activa cuando lo compr&aacute;s. Si ya te lo entregaron y sigue as&iacute;, avisale a quien te lo vendi&oacute;.</p>
  ${codigoLinea}
  <a class="link" href="https://next-tap.tech">next-tap.tech</a>
</body>
</html>`;
}

app.get('/v/:codigo', routerThrottle, async (req, res) => {
  const sticker = await get('SELECT * FROM stickers_actual WHERE codigo_publico = ?', [req.params.codigo]);

  if (sticker && sticker.estado === 'activo') {
    const destino = await get('SELECT * FROM destinos WHERE sticker_id = ?', [sticker.id]);
    if (destino) {
      // Los destinos nuevos ya se guardan como URL absoluta. Para filas viejas
      // (cargadas sin https://) lo forzamos acá antes de redirigir, si no el
      // browser lo toma como ruta relativa y tira 404.
      const valor = /^https?:\/\//i.test(destino.valor)
        ? destino.valor
        : aUrlAbsoluta(destino.valor) || destino.valor;
      // Solo interponemos la pantalla si el destino es una URL http(s) normal;
      // cualquier otra cosa (esquemas raros) se redirige directo, sin adornos.
      if (/^https?:\/\//i.test(valor)) {
        return res.type('html').send(pantallaRedireccion(valor));
      }
      return res.redirect(302, valor);
    }
  }

  // Todavía sin activar y activable sin vendedor (lote especial, o con una
  // activación liberada vigente): el tap lleva a la pantalla de activación.
  if (
    sticker &&
    sticker.estado !== 'activo' &&
    (esLoteEspecial(sticker.uid_nfc) || (await liberacionVigente(sticker.id)))
  ) {
    return res.redirect(302, `${FRONTEND_URL}/activacion/${sticker.codigo_publico}`);
  }

  // Chip real todavía sin activar (recién grabado en el taller, o en stock de
  // un vendedor sin vender), o un código que no reconocemos: pantalla "sin
  // activar" + invitación a comprar, en vez de tirar a la landing sin contexto.
  return res.type('html').send(pantallaNoActivado(sticker ? sticker.codigo_publico : req.params.codigo));
});

// --- Activación del lote especial: verificás tu email → pagás → editás ---
// Los llaveros vienen impresos sin candado y sin ID. El flujo es:
//   1. el que lo tiene en la mano verifica su email (ciclo OTP normal)
//   2. paga la activación por Mercado Pago (una sola vez)
//   3. el webhook de pago deja el sticker `activo` y ya lo edita desde Mi panel
// El pago reusa toda la maquinaria de `ventas` / `venta_items` / webhook.

app.get('/api/activacion/:codigo', routerThrottle, async (req, res) => {
  const sticker = await get('SELECT * FROM stickers_actual WHERE codigo_publico = ?', [req.params.codigo]);
  if (!sticker) {
    return res.status(404).json({ error: 'Este código no corresponde a un sticker activable.' });
  }
  const liberada = await liberacionVigente(sticker.id);
  // Servible si: es lote especial, tiene una liberación (vigente o ya usada, para
  // que la redirección post-activación siga funcionando), o ya está activo.
  const tuvoLiberacion =
    liberada || (await get('SELECT 1 FROM activaciones_liberadas WHERE sticker_id = ? LIMIT 1', [sticker.id]));
  if (!esLoteEspecial(sticker.uid_nfc) && !tuvoLiberacion && sticker.estado !== 'activo') {
    return res.status(404).json({ error: 'Este código no corresponde a un sticker activable.' });
  }
  const modelo = sticker.modelo || 'llavero';
  const precioRow = await get('SELECT precio FROM precios WHERE modelo = ?', [modelo]);
  const destino =
    sticker.estado === 'activo' ? await get('SELECT valor FROM destinos WHERE sticker_id = ?', [sticker.id]) : null;
  res.json({
    codigo: sticker.codigo_publico,
    modelo,
    funcion: sticker.funcion || null,
    // en_stock (activable) | vendido_pendiente (pago sin confirmar) | activo
    estado: sticker.estado,
    yaActivado: sticker.estado === 'activo',
    // Activación liberada GRATIS vigente → sin Mercado Pago. Una liberada con
    // pago (gratis = false) sigue el flujo normal de pago, así que acá va false.
    liberada: Boolean(liberada && liberada.gratis),
    precio: precioRow ? Number(precioRow.precio) : null,
    pagosHabilitados: MP_ENABLED,
    destino: destino ? destino.valor : null,
  });
});

// Sin verificación previa del email: para que la activación sea de un solo
// toque, el que tiene el llavero solo escribe su email y paga. La cuenta de
// comprador se crea SIN verificar — la verifica más tarde al entrar a Mi panel
// (login por código). Riesgo aceptado: alguien podría activar con un email
// ajeno, pero hace falta tener el llavero físico en la mano.
app.post('/api/activacion/:codigo', routerThrottle, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!ES_EMAIL(email)) return res.status(400).json({ error: 'Ingresá un email válido.' });

  const sticker = await get('SELECT * FROM stickers_actual WHERE codigo_publico = ?', [req.params.codigo]);
  const liberada = sticker ? await liberacionVigente(sticker.id) : null;
  if (!sticker || (!esLoteEspecial(sticker.uid_nfc) && !liberada)) {
    return res.status(404).json({ error: 'Este código no corresponde a un sticker activable.' });
  }
  if (sticker.estado === 'activo') {
    return res.status(409).json({ error: 'Este llavero ya está activado. Entrá a "Mi panel" para editarlo.' });
  }

  let comprador = await get('SELECT * FROM compradores WHERE LOWER(email) = ?', [email]);
  if (!comprador) {
    const r = await run('INSERT INTO compradores (email) VALUES (?)', [email]);
    comprador = await get('SELECT * FROM compradores WHERE id = ?', [r.lastInsertRowid]);
  }

  // --- Activación liberada GRATIS: sin Mercado Pago. Activa al instante. ---
  if (liberada && liberada.gratis) {
    const vendedorId = liberada.vendedor_id || (await vendedorEspecialId());
    const funcionFinal = liberada.destino_tipo || sticker.funcion || 'instagram';
    const ventaRes = await run(
      `INSERT INTO ventas (vendedor_id, comprador_id, monto, estado_pago) VALUES (?, ?, 0, 'confirmado')`,
      [vendedorId, comprador.id]
    );
    const ventaId = ventaRes.lastInsertRowid;
    await run(
      'INSERT INTO venta_items (venta_id, sticker_id, monto, destino_tipo, destino_valor) VALUES (?, ?, 0, ?, ?)',
      [ventaId, sticker.id, liberada.destino_tipo || null, liberada.destino_valor || null]
    );
    await transicionarSticker(sticker.id, {
      comprador_id: comprador.id,
      funcion: funcionFinal,
      estado: 'activo',
      ...(vendedorId ? { vendedor_id: vendedorId } : {}),
    });
    if (liberada.destino_tipo && liberada.destino_valor) {
      const norm = normalizarDestino(liberada.destino_tipo, liberada.destino_valor);
      await db.execute({
        sql: `INSERT INTO destinos (sticker_id, tipo, valor, actualizado_en) VALUES (?, ?, ?, NOW())
              ON CONFLICT(sticker_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, actualizado_en = NOW()`,
        args: [sticker.id, liberada.destino_tipo, norm.valor || liberada.destino_valor],
      });
    }
    await run(
      'UPDATE activaciones_liberadas SET usada_en = NOW(), usada_por_comprador_id = ?, venta_id = ? WHERE id = ?',
      [comprador.id, ventaId, liberada.id]
    );
    await registrarEventoAdmin(sticker.id, 'activacion_liberada_usada', {
      despues: { comprador: email, ventaId },
      motivo: liberada.motivo,
    });
    return res.status(201).json({ liberada: true, activado: true });
  }

  if (!MP_ENABLED) return res.status(503).json({ error: 'Los pagos todavía no están configurados.' });

  const modelo = sticker.modelo || 'llavero';
  const precioRow = await get('SELECT precio FROM precios WHERE modelo = ?', [modelo]);
  if (!precioRow) return res.status(409).json({ error: `No hay precio definido para ${modelo}.` });
  const precio = Number(precioRow.precio);
  // Liberada con pago: se atribuye al vendedor de la liberación si tiene uno.
  const vendedorId = (liberada && liberada.vendedor_id) || (await vendedorEspecialId());

  // Reusar la venta pendiente si ya había un pago sin terminar para este
  // sticker (aunque lo hubiera empezado otro email: posesión física manda).
  let venta = await get(
    `SELECT v.* FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
     WHERE vi.sticker_id = ? AND v.estado_pago = 'pendiente' ORDER BY v.id DESC LIMIT 1`,
    [sticker.id]
  );
  if (venta) {
    if (venta.comprador_id !== comprador.id) {
      await run('UPDATE ventas SET comprador_id = ? WHERE id = ?', [comprador.id, venta.id]);
    }
    await transicionarSticker(sticker.id, {
      comprador_id: comprador.id,
      funcion: sticker.funcion || 'instagram',
      estado: 'vendido_pendiente',
      ...(vendedorId ? { vendedor_id: vendedorId } : {}),
    });
  } else {
    await transicionarSticker(sticker.id, {
      comprador_id: comprador.id,
      funcion: sticker.funcion || 'instagram',
      estado: 'vendido_pendiente',
      ...(vendedorId ? { vendedor_id: vendedorId } : {}),
    });
    const r = await run(
      `INSERT INTO ventas (vendedor_id, comprador_id, monto, estado_pago) VALUES (?, ?, ?, 'pendiente')`,
      [vendedorId, comprador.id, precio]
    );
    venta = { id: r.lastInsertRowid };
    await run(
      'INSERT INTO venta_items (venta_id, sticker_id, monto, destino_tipo, destino_valor) VALUES (?, ?, ?, NULL, NULL)',
      [venta.id, sticker.id, precio]
    );
  }

  try {
    const preference = await new Preference(mpClient).create({
      body: {
        items: [
          { title: `Activación llavero NextTap`, quantity: 1, unit_price: precio, currency_id: 'ARS' },
        ],
        external_reference: String(venta.id),
        back_urls: {
          success: `${FRONTEND_URL}/activacion/${sticker.codigo_publico}?pago=exito`,
          failure: `${FRONTEND_URL}/activacion/${sticker.codigo_publico}?pago=error`,
          pending: `${FRONTEND_URL}/activacion/${sticker.codigo_publico}?pago=pendiente`,
        },
        auto_return: 'approved',
        notification_url: `${API_PUBLIC_URL}/api/pagos/webhook`,
      },
    });
    res.status(201).json({ ventaId: venta.id, initPoint: preference.init_point });
  } catch (err) {
    console.error('[Mercado Pago] error creando preferencia (activación):', err.message);
    res.status(502).json({ error: 'No se pudo iniciar el pago. Probá de nuevo.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API en http://localhost:${PORT}`);
});
