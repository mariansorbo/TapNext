import express from 'express';
import cors from 'cors';
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

const app = express();
app.use(cors());
app.use(express.json());

function isoInMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
function isoInSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// --- Auth: WhatsApp + OTP, no passwords (RF-12/RF-13) ---

app.post('/api/auth/otp/request', (req, res) => {
  const whatsapp = String(req.body?.whatsapp || '').trim();
  if (!whatsapp) return res.status(400).json({ error: 'Falta el WhatsApp.' });

  const recent = db
    .prepare(
      `SELECT id FROM otp_sessions WHERE whatsapp = ? AND usado = 0 AND creado_en > datetime('now', ?) ORDER BY id DESC LIMIT 1`
    )
    .get(whatsapp, `-${OTP_THROTTLE_SECONDS} seconds`);
  if (recent) {
    return res.status(429).json({ error: 'Esperá unos segundos antes de pedir otro código.' });
  }

  const code = generateOtp();
  db.prepare('INSERT INTO otp_sessions (whatsapp, codigo_hash, expira) VALUES (?, ?, ?)').run(
    whatsapp,
    hashValue(code),
    isoInMinutes(OTP_TTL_MINUTES)
  );

  // No hay integración real con WhatsApp Business API todavía — simulamos el envío.
  console.log(`[OTP demo] Código para ${whatsapp}: ${code} (expira en ${OTP_TTL_MINUTES} min)`);

  // DEV ONLY: nunca devolver el código en la respuesta en producción — acá reemplaza
  // al envío real por WhatsApp mientras no haya esa integración conectada.
  res.json({ ok: true, debug_otp: code });
});

app.post('/api/auth/otp/verify', (req, res) => {
  const whatsapp = String(req.body?.whatsapp || '').trim();
  const code = String(req.body?.code || '').trim();
  if (!whatsapp || !code) return res.status(400).json({ error: 'Faltan datos.' });

  const otp = db
    .prepare(
      `SELECT * FROM otp_sessions WHERE whatsapp = ? AND usado = 0 AND expira > datetime('now') ORDER BY id DESC LIMIT 1`
    )
    .get(whatsapp);

  if (!otp || otp.codigo_hash !== hashValue(code)) {
    return res.status(401).json({ error: 'Código inválido o expirado.' });
  }

  db.prepare('UPDATE otp_sessions SET usado = 1 WHERE id = ?').run(otp.id);

  let comprador = db.prepare('SELECT * FROM compradores WHERE whatsapp = ?').get(whatsapp);
  if (!comprador) {
    const result = db.prepare('INSERT INTO compradores (whatsapp) VALUES (?)').run(whatsapp);
    comprador = db.prepare('SELECT * FROM compradores WHERE id = ?').get(Number(result.lastInsertRowid));
  }

  const token = generateToken();
  db.prepare('INSERT INTO sesiones (comprador_id, token_hash, expira) VALUES (?, ?, ?)').run(
    comprador.id,
    hashValue(token),
    isoInMinutes(SESSION_TTL_MINUTES)
  );

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

    // Si ya existe un comprador con ese google_id, es ese. Si no, pero hay uno
    // con el mismo mail (ej. cargado como mail de respaldo), lo vinculamos en
    // vez de crear una cuenta duplicada. Si tampoco, se crea uno nuevo.
    let comprador = db.prepare('SELECT * FROM compradores WHERE google_id = ?').get(profile.sub);
    if (!comprador && profile.email) {
      comprador = db.prepare('SELECT * FROM compradores WHERE email = ?').get(profile.email);
      if (comprador) {
        db.prepare('UPDATE compradores SET google_id = ? WHERE id = ?').run(profile.sub, comprador.id);
      }
    }
    if (!comprador) {
      const result = db
        .prepare('INSERT INTO compradores (google_id, email, nombre) VALUES (?, ?, ?)')
        .run(profile.sub, profile.email || null, profile.name || null);
      comprador = db.prepare('SELECT * FROM compradores WHERE id = ?').get(Number(result.lastInsertRowid));
    }

    const token = generateToken();
    db.prepare('INSERT INTO sesiones (comprador_id, token_hash, expira) VALUES (?, ?, ?)').run(
      comprador.id,
      hashValue(token),
      isoInMinutes(SESSION_TTL_MINUTES)
    );

    res.redirect(`${FRONTEND_URL}/mi-panel.html?token=${token}`);
  } catch (err) {
    console.error('[Google OAuth] error:', err.message);
    res.redirect(`${FRONTEND_URL}/mi-panel.html?google_error=server_error`);
  }
});

app.delete('/api/auth/session', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(hashValue(token));
  res.status(204).end();
});

// RF-15b: la sesión de edición expira tras inactividad corta — ventana deslizante.
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Falta autenticación.' });

  const tokenHash = hashValue(token);
  const sesion = db
    .prepare(`SELECT * FROM sesiones WHERE token_hash = ? AND expira > datetime('now')`)
    .get(tokenHash);
  if (!sesion) return res.status(401).json({ error: 'Sesión inválida o expirada.' });

  db.prepare('UPDATE sesiones SET expira = ? WHERE id = ?').run(isoInMinutes(SESSION_TTL_MINUTES), sesion.id);

  req.comprador = db.prepare('SELECT * FROM compradores WHERE id = ?').get(sesion.comprador_id);
  next();
}

// --- Panel del comprador (/mi-panel) ---

app.get('/api/me', requireAuth, (req, res) => {
  const { id, whatsapp, nombre, email } = req.comprador;
  res.json({ id, whatsapp, nombre, email });
});

// Mail de respaldo opcional — no se usa para loguearse, solo para avisos y recuperación
// si el número de WhatsApp deja de estar en manos de su dueño original.
app.patch('/api/me', requireAuth, (req, res) => {
  const email = String(req.body?.email ?? '').trim();
  if (email && !email.includes('@')) {
    return res.status(400).json({ error: 'Ese mail no parece válido.' });
  }
  db.prepare('UPDATE compradores SET email = ? WHERE id = ?').run(email || null, req.comprador.id);
  const actualizado = db.prepare('SELECT id, whatsapp, nombre, email FROM compradores WHERE id = ?').get(req.comprador.id);
  res.json(actualizado);
});

app.get('/api/me/stickers', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.codigo_publico, s.estado, s.modelo, d.tipo AS destino_tipo, d.valor AS destino_valor, d.actualizado_en AS destino_actualizado_en
       FROM stickers s
       LEFT JOIN destinos d ON d.sticker_id = s.id
       WHERE s.comprador_id = ?
       ORDER BY s.id`
    )
    .all(req.comprador.id);

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

app.patch('/api/stickers/:id/destino', requireAuth, (req, res) => {
  const stickerId = Number(req.params.id);
  const tipo = String(req.body?.tipo || '').trim();
  const valor = String(req.body?.valor || '').trim();

  if (!DESTINO_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de destino inválido.' });
  if (!valor) return res.status(400).json({ error: 'Falta el valor del destino.' });

  const sticker = db
    .prepare('SELECT * FROM stickers WHERE id = ? AND comprador_id = ?')
    .get(stickerId, req.comprador.id);
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado.' });
  if (sticker.estado !== 'activo') {
    return res.status(400).json({ error: 'Este sticker todavía no está activado.' });
  }

  const anterior = db.prepare('SELECT * FROM destinos WHERE sticker_id = ?').get(stickerId);

  db.prepare(
    `INSERT INTO destinos (sticker_id, tipo, valor, actualizado_en) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(sticker_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, actualizado_en = datetime('now')`
  ).run(stickerId, tipo, valor);

  db.prepare(
    `INSERT INTO historial_cambios (sticker_id, comprador_id, campo_modificado, valor_anterior, valor_nuevo)
     VALUES (?, ?, 'destino', ?, ?)`
  ).run(
    stickerId,
    req.comprador.id,
    anterior ? `${anterior.tipo}:${anterior.valor}` : null,
    `${tipo}:${valor}`
  );

  // No hay integración real de mail todavía — simulamos el aviso si el comprador cargó uno de respaldo.
  if (req.comprador.email) {
    console.log(
      `[Email demo] Aviso a ${req.comprador.email}: cambiaste el destino del sticker ${sticker.codigo_publico} a "${tipo}: ${valor}".`
    );
  }

  const actualizado = db.prepare('SELECT * FROM destinos WHERE sticker_id = ?').get(stickerId);
  res.json({ tipo: actualizado.tipo, valor: actualizado.valor, actualizadoEn: actualizado.actualizado_en });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API en http://localhost:${PORT}`);
});
