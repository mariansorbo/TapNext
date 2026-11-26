// Acuerdos con minoristas: el admin genera un link único por comercio; el
// comercio lo abre, verifica su mail con un código, completa sus datos y firma
// aceptando el texto (consignación de llaveros + kit en comodato + anticipo).
// Ver el texto y los parámetros en server/acuerdos-texto.js.
//
// Admin (montado bajo /api/admin con requireAdmin):
//   GET    /acuerdos/defaults             → parámetros por defecto
//   GET    /acuerdos                      → listado con estado y link
//   POST   /acuerdos                      → { comercio, email, telefono?, params?, diasValidez? }: crea y devuelve el link
//   GET    /acuerdos/:id                  → detalle (+ firma y texto firmado)
//   POST   /acuerdos/:id/anticipo-pagado  → { via }: marca el anticipo como acreditado (firmado → pagado)
//   POST   /acuerdos/:id/anular           → anula (el link deja de andar)
//
// Público (montado en /api/acuerdos, sin sesión; el token del link es el secreto):
//   GET    /:token                        → resumen + cláusulas + estado (mail enmascarado)
//   POST   /:token/codigo                 → manda el código de 6 dígitos al mail del acuerdo
//   POST   /:token/verificar              → { codigo } → { sesion } (30 min)
//   POST   /:token/firmar                 → { sesion, nombre, documento, domicilio, local, firmaNombre, acepta* }
//
// Estados: enviado → firmado → pagado (o anulado). "vencido" se deriva: enviado
// con el link pasado de fecha. La firma guarda el texto exacto, su hash, el mail
// verificado, IP y dispositivo. Lo firmado no se edita: un cambio es un acuerdo nuevo.

import express from 'express';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { PARAMS_DEFAULT, normalizarParams, armarContrato, pesos } from './acuerdos-texto.js';
import { canalWhatsapp } from './verificacion/canales/whatsapp.js';

const OTP_TTL_MIN = 10;
const OTP_THROTTLE_SEG = 60;
const OTP_MAX_INTENTOS = 5;
const SESION_TTL_MIN = 30;
const DIAS_VALIDEZ_DEFAULT = 7;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const enMinutos = (m) => new Date(Date.now() + m * 60000).toISOString();
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const sinAcentos = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const normNombre = (s) => sinAcentos(s).toLowerCase().replace(/\s+/g, ' ').trim();

// WhatsApp en formato internacional sin "+" (lo que pide la Cloud API). Acepta cómo lo
// escribe uno en Argentina: 11 2263-6101, 011 2263 6101, +54 9 11 2263 6101, 5411...
// Un número con "+" de otro país se respeta tal cual. Devuelve null si no se entiende.
export function normalizarWhatsapp(raw) {
  const texto = String(raw || '').trim();
  let d = texto.replace(/\D/g, '');
  if (texto.startsWith('+') && !texto.startsWith('+54')) return d.length >= 8 && d.length <= 15 ? d : null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) d = d.slice(2);
  d = d.replace(/^0/, '');
  if (d.length === 10) return `549${d}`; // área + número, sin 9
  if (d.length === 11 && d.startsWith('9')) return `54${d}`; // ya trae el 9
  return null;
}

// Mail o WhatsApp: si tiene arroba es mail, si no, WhatsApp. { canal, destino } o { error }.
export function normalizarContacto(raw) {
  const t = String(raw || '').trim();
  if (t.includes('@')) {
    const email = t.toLowerCase();
    return emailValido(email) ? { canal: 'email', destino: email } : { error: 'El mail no es válido.' };
  }
  const wa = normalizarWhatsapp(t);
  return wa
    ? { canal: 'whatsapp', destino: wa }
    : { error: 'No entiendo ese WhatsApp. Ponelo con código de área, sin 0 ni 15 (ej. 11 2263 6101).' };
}

function enmascarar(destino, canal = 'email') {
  if (canal === 'whatsapp') return `WhatsApp terminado en ${String(destino).slice(-4)}`;
  const [u, d] = String(destino).split('@');
  return `${u.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}`;
}

export async function inicializarAcuerdos(db) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS acuerdos (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      comercio TEXT NOT NULL,
      email TEXT NOT NULL,                  -- mail o WhatsApp del comercio, según el campo canal
      telefono TEXT,
      params_json TEXT NOT NULL,            -- parámetros congelados al crear el link
      estado TEXT NOT NULL DEFAULT 'enviado', -- enviado | firmado | pagado | anulado
      expira TIMESTAMPTZ NOT NULL,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      firmado_en TIMESTAMPTZ,
      anticipo_pagado_en TIMESTAMPTZ,
      anticipo_via TEXT,
      anulado_en TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS acuerdo_firmas (
      id SERIAL PRIMARY KEY,
      acuerdo_id INTEGER NOT NULL UNIQUE REFERENCES acuerdos(id),
      nombre TEXT NOT NULL,
      documento TEXT NOT NULL,
      domicilio TEXT NOT NULL,
      local_nombre TEXT,
      firma_nombre TEXT NOT NULL,
      texto_version INTEGER NOT NULL,
      texto_hash TEXT NOT NULL,
      texto_firmado TEXT NOT NULL,          -- el contrato exacto que vio y aceptó
      email_verificado TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      firmado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE acuerdos ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'email'; -- email | whatsapp
    ALTER TABLE acuerdo_firmas ADD COLUMN IF NOT EXISTS mail_copia TEXT; -- adónde se mandó la copia
    CREATE TABLE IF NOT EXISTS acuerdo_otp (
      id SERIAL PRIMARY KEY,
      acuerdo_id INTEGER NOT NULL REFERENCES acuerdos(id),
      codigo_hash TEXT NOT NULL,
      intentos INTEGER NOT NULL DEFAULT 0,
      usado INTEGER NOT NULL DEFAULT 0,
      expira TIMESTAMPTZ NOT NULL,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS acuerdo_sesiones (
      id SERIAL PRIMARY KEY,
      acuerdo_id INTEGER NOT NULL REFERENCES acuerdos(id),
      token_hash TEXT NOT NULL,
      expira TIMESTAMPTZ NOT NULL
    );
  `);
}

// deps: { db, enviarCorreo, avisarAdmin, frontendUrl }
function helpers(deps) {
  const { db, frontendUrl } = deps;
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0] || null;
  const link = (token) => `${String(frontendUrl).replace(/\/+$/, '')}/acuerdo/${token}`;
  const estadoVisible = (a) =>
    a.estado === 'enviado' && new Date(a.expira) < new Date() ? 'vencido' : a.estado;
  return { q, one, link, estadoVisible };
}

export function crearAcuerdosAdminRouter(deps) {
  const router = express.Router();
  const { db } = deps;
  const { q, one, link, estadoVisible } = helpers(deps);

  router.get('/acuerdos/defaults', (_req, res) => res.json({ defaults: PARAMS_DEFAULT }));

  router.get('/acuerdos', async (_req, res) => {
    const filas = await q(`SELECT * FROM acuerdos ORDER BY id DESC LIMIT 200`);
    res.json({
      acuerdos: filas.map((a) => {
        const p = JSON.parse(a.params_json);
        return {
          id: a.id,
          comercio: a.comercio,
          contacto: a.email,
          canal: a.canal,
          estado: estadoVisible(a),
          link: a.estado === 'enviado' ? link(a.token) : null,
          unidades: p.unidIg + p.unidWpp,
          anticipo: p.anticipo,
          creadoEn: a.creado_en,
          expira: a.expira,
          firmadoEn: a.firmado_en,
          anticipoPagadoEn: a.anticipo_pagado_en,
        };
      }),
    });
  });

  router.post('/acuerdos', async (req, res) => {
    const comercio = String(req.body?.comercio || '').trim();
    const telefono = String(req.body?.telefono || '').trim() || null;
    if (comercio.length < 2) return res.status(400).json({ error: 'Poné el nombre del comercio.' });
    const contacto = normalizarContacto(req.body?.contacto ?? req.body?.email);
    if (contacto.error) return res.status(400).json({ error: contacto.error });
    const norm = normalizarParams(req.body?.params || {});
    if (norm.error) return res.status(400).json({ error: norm.error });
    const dias = Math.min(60, Math.max(1, Number(req.body?.diasValidez) || DIAS_VALIDEZ_DEFAULT));
    const token = randomBytes(12).toString('hex');
    const [fila] = await q(
      `INSERT INTO acuerdos (token, comercio, email, canal, telefono, params_json, expira) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [token, comercio, contacto.destino, contacto.canal, telefono, JSON.stringify(norm.params), enMinutos(dias * 1440)]
    );
    const url = link(token);
    const p = norm.params;
    res.status(201).json({
      id: fila.id,
      link: url,
      // Texto listo para pegar en WhatsApp: el envío lo hace el admin a mano.
      mensaje:
        `Hola! Te paso el acuerdo para el kit exhibidor y los ${p.unidIg + p.unidWpp} llaveros NextTap. ` +
        `Lo firmás en 2 minutos desde acá: ${url} ` +
        `(te va a llegar un código de verificación por ${contacto.canal === 'whatsapp' ? 'WhatsApp' : 'mail'}).`,
    });
  });

  router.get('/acuerdos/:id', async (req, res) => {
    const a = await one(`SELECT * FROM acuerdos WHERE id = ?`, [Number(req.params.id)]);
    if (!a) return res.status(404).json({ error: 'Acuerdo no encontrado.' });
    const firma = await one(`SELECT * FROM acuerdo_firmas WHERE acuerdo_id = ?`, [a.id]);
    res.json({
      acuerdo: { ...a, estado: estadoVisible(a), params: JSON.parse(a.params_json), params_json: undefined, token: undefined },
      link: a.estado === 'enviado' ? link(a.token) : null,
      firma,
    });
  });

  router.post('/acuerdos/:id/anticipo-pagado', async (req, res) => {
    const via = ['transferencia', 'mercadopago', 'efectivo'].includes(req.body?.via) ? req.body.via : 'transferencia';
    const r = await db.execute({
      sql: `UPDATE acuerdos SET estado = 'pagado', anticipo_pagado_en = NOW(), anticipo_via = ? WHERE id = ? AND estado = 'firmado'`,
      args: [via, Number(req.params.id)],
    });
    if (!r.rowsAffected) return res.status(409).json({ error: 'Solo se puede marcar el anticipo en un acuerdo firmado.' });
    res.json({ ok: true });
  });

  router.post('/acuerdos/:id/anular', async (req, res) => {
    const r = await db.execute({
      sql: `UPDATE acuerdos SET estado = 'anulado', anulado_en = NOW() WHERE id = ? AND estado IN ('enviado','firmado')`,
      args: [Number(req.params.id)],
    });
    if (!r.rowsAffected) return res.status(409).json({ error: 'No se puede anular en este estado (ya está pagado o anulado).' });
    res.json({ ok: true });
  });

  return router;
}

export function crearAcuerdosPublicoRouter(deps) {
  const router = express.Router();
  const { db, enviarCorreo, avisarAdmin, correoDisponible = false } = deps;
  const canal = deps.canalWhatsapp || canalWhatsapp; // inyectable para pruebas
  const { q, one, estadoVisible } = helpers(deps);

  // Todas las rutas con token pasan por acá: link inexistente, vencido o anulado = mismo 404 genérico.
  async function cargar(req, res, next) {
    const a = await one(`SELECT * FROM acuerdos WHERE token = ?`, [String(req.params.token || '')]);
    if (!a || a.estado === 'anulado') return res.status(404).json({ error: 'Este link no existe o ya no está disponible.' });
    req.acuerdo = a;
    req.params_ = JSON.parse(a.params_json);
    next();
  }

  router.get('/:token', cargar, async (req, res) => {
    const a = req.acuerdo;
    const c = armarContrato(req.params_, { nombre: a.comercio, canal: a.canal });
    const firmable = estadoVisible(a) === 'enviado';
    res.json({
      comercio: a.comercio,
      estado: estadoVisible(a),
      canal: a.canal,
      contactoEnmascarado: enmascarar(a.email, a.canal),
      resumen: c.resumen,
      clausulas: c.clausulas,
      unidades: req.params_.unidIg + req.params_.unidWpp,
      precioRendicionTexto: pesos(req.params_.precioRendicion),
      anticipoTexto: pesos(req.params_.anticipo),
      firmable,
    });
  });

  router.post('/:token/codigo', cargar, async (req, res) => {
    const a = req.acuerdo;
    if (estadoVisible(a) !== 'enviado') return res.status(409).json({ error: 'Este acuerdo ya no se puede firmar.' });
    const corte = new Date(Date.now() - OTP_THROTTLE_SEG * 1000).toISOString();
    const reciente = await one(`SELECT id FROM acuerdo_otp WHERE acuerdo_id = ? AND creado_en > ? LIMIT 1`, [a.id, corte]);
    if (reciente) return res.status(429).json({ error: 'Esperá un minuto antes de pedir otro código.' });
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await q(`INSERT INTO acuerdo_otp (acuerdo_id, codigo_hash, expira) VALUES (?, ?, ?)`, [a.id, sha(codigo), enMinutos(OTP_TTL_MIN)]);
    if (a.canal === 'whatsapp') {
      if (canal.disponible) {
        try {
          await canal.enviarCodigo(a.email, codigo);
        } catch (err) {
          console.error('[acuerdos] falló el envío por WhatsApp:', err.message);
          return res.status(502).json({ error: 'No pudimos mandarte el código por WhatsApp. Avisale a NextTap.' });
        }
      } else {
        // Sin credenciales de WhatsApp (local/demo): mismo patrón que el resto del server.
        console.log(`[acuerdos demo] Código para WhatsApp ${a.email}: ${codigo}`);
      }
    } else {
      const ok = await enviarCorreo({
        to: a.email,
        subject: `Tu código para firmar el acuerdo NextTap: ${codigo}`,
        text: `Tu código de verificación es ${codigo}. Vence en ${OTP_TTL_MIN} minutos.\n\nSi no lo pediste, ignorá este mail.`,
      });
      // Sin Resend configurado enviarCorreo ya dejó el código en consola (demo); con Resend y fallo, avisamos.
      if (!ok && correoDisponible) return res.status(502).json({ error: 'No pudimos mandarte el código por mail. Avisale a NextTap.' });
    }
    res.json({ ok: true, canal: a.canal, contactoEnmascarado: enmascarar(a.email, a.canal) });
  });

  router.post('/:token/verificar', cargar, async (req, res) => {
    const a = req.acuerdo;
    const codigo = String(req.body?.codigo || '').replace(/\D/g, '');
    const otp = await one(
      `SELECT * FROM acuerdo_otp WHERE acuerdo_id = ? AND usado = 0 AND expira > NOW() ORDER BY id DESC LIMIT 1`,
      [a.id]
    );
    if (!otp) return res.status(400).json({ error: 'Pedí un código nuevo: este venció o ya se usó.' });
    if (otp.codigo_hash !== sha(codigo)) {
      const intentos = otp.intentos + 1;
      await q(`UPDATE acuerdo_otp SET intentos = ?, usado = ? WHERE id = ?`, [intentos, intentos >= OTP_MAX_INTENTOS ? 1 : 0, otp.id]);
      return res.status(400).json({
        error: intentos >= OTP_MAX_INTENTOS ? 'Demasiados intentos. Pedí un código nuevo.' : 'El código no es correcto.',
      });
    }
    await q(`UPDATE acuerdo_otp SET usado = 1 WHERE id = ?`, [otp.id]);
    const sesion = randomBytes(24).toString('hex');
    await q(`INSERT INTO acuerdo_sesiones (acuerdo_id, token_hash, expira) VALUES (?, ?, ?)`, [a.id, sha(sesion), enMinutos(SESION_TTL_MIN)]);
    res.json({ sesion });
  });

  router.post('/:token/firmar', cargar, async (req, res) => {
    const a = req.acuerdo;
    const b = req.body || {};
    if (estadoVisible(a) !== 'enviado') return res.status(409).json({ error: 'Este acuerdo ya no se puede firmar.' });
    const ses = await one(
      `SELECT id FROM acuerdo_sesiones WHERE acuerdo_id = ? AND token_hash = ? AND expira > NOW()`,
      [a.id, sha(String(b.sesion || ''))]
    );
    if (!ses) return res.status(401).json({ error: 'Verificá tu contacto de nuevo para firmar.' });

    const nombre = String(b.nombre || '').trim().replace(/\s+/g, ' ');
    const documento = String(b.documento || '').replace(/\D/g, '');
    const domicilio = String(b.domicilio || '').trim();
    const local = String(b.local || '').trim().slice(0, 120) || a.comercio;
    if (nombre.length < 5 || !nombre.includes(' ')) return res.status(400).json({ error: 'Escribí tu nombre y apellido completos.' });
    if (documento.length < 7 || documento.length > 11) return res.status(400).json({ error: 'Revisá el DNI o CUIT.' });
    if (domicilio.length < 5) return res.status(400).json({ error: 'Completá el domicilio del local.' });
    if (!(b.aceptaContrato === true && b.aceptaStock === true && b.aceptaFirma === true))
      return res.status(400).json({ error: 'Tenés que tildar las tres casillas.' });
    if (normNombre(b.firmaNombre || '') !== normNombre(nombre))
      return res.status(400).json({ error: 'La firma tiene que ser tu nombre completo, igual al de arriba.' });

    // Si verificó por WhatsApp no tenemos su mail: lo pedimos para mandarle la copia.
    const mailCopia = a.canal === 'whatsapp' ? String(b.mailCopia || '').trim().toLowerCase() : a.email;
    if (!emailValido(mailCopia)) return res.status(400).json({ error: 'Poné un mail válido para mandarte la copia del acuerdo.' });
    const contrato = armarContrato(req.params_, { nombre, documento, domicilio, local, canal: a.canal });
    // Primero cambia el estado (UPDATE condicional): dos firmas simultáneas no pasan las dos.
    const r = await db.execute({
      sql: `UPDATE acuerdos SET estado = 'firmado', firmado_en = NOW() WHERE id = ? AND estado = 'enviado'`,
      args: [a.id],
    });
    if (!r.rowsAffected) return res.status(409).json({ error: 'Este acuerdo ya fue firmado.' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    await q(
      `INSERT INTO acuerdo_firmas (acuerdo_id, nombre, documento, domicilio, local_nombre, firma_nombre, texto_version, texto_hash, texto_firmado, email_verificado, mail_copia, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, nombre, documento, domicilio, local, String(b.firmaNombre).trim(), contrato.version, contrato.hash, contrato.texto, a.email, mailCopia, ip, String(req.headers['user-agent'] || '').slice(0, 300)]
    );
    await q(`DELETE FROM acuerdo_sesiones WHERE acuerdo_id = ?`, [a.id]);

    const p = req.params_;
    // Copia por mail al comercio (con el texto completo firmado) y aviso al admin. Best-effort.
    enviarCorreo({
      to: mailCopia,
      subject: 'Tu acuerdo NextTap firmado',
      text: `Hola ${nombre},\n\nRecibimos tu firma del acuerdo. Te dejamos una copia.\n\nPróximo paso: el anticipo de ${pesos(p.anticipo)}. Te escribimos para coordinarlo y la entrega del kit.\n\n————\n\n${contrato.texto}\n\nFirmado electrónicamente por ${nombre} (DNI/CUIT ${documento}) con ${a.canal === 'whatsapp' ? 'el WhatsApp verificado' : 'el mail verificado'} ${a.email}.\nHuella del texto: ${contrato.hash}`,
    }).catch(() => {});
    avisarAdmin({
      asunto: `✍️ Acuerdo firmado — ${a.comercio}`,
      lineas: [`${nombre} (DNI/CUIT ${documento}) firmó el acuerdo de ${a.comercio}.`, `Lote: ${p.unidIg + p.unidWpp} llaveros. Anticipo pendiente: ${pesos(p.anticipo)}.`, 'Cuando te llegue el anticipo, marcalo como pagado en la solapa Acuerdos.'],
    }).catch(() => {});

    res.json({ ok: true, anticipoTexto: pesos(p.anticipo) });
  });

  return router;
}
