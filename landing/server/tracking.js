// Registro anónimo de visitas: toques de sticker (/v/:codigo), páginas vistas
// de la landing (POST /api/visitas) y evidencia de aceptación de TyC.
//
// Solo se guarda lo que el navegador manda solo en cada request (IP,
// user-agent, idioma, referer) más un id random del navegador — nunca nombre
// ni contacto. Ver "Protección de datos (Ley 25326)" en el vault.
//
// Nada de esto puede romper el flujo principal: los inserts van en segundo
// plano y un error solo se loguea.

import express from 'express';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';

const COOKIE_VISITANTE = 'nt_vid';
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60_000; // tope que aceptan los navegadores
const ES_VISITANTE_ID = /^[A-Za-z0-9_-]{8,64}$/;

// Previsualizaciones de link (WhatsApp, Facebook, Telegram...) y scrapers: se
// guardan igual, marcadas, para poder excluirlas de las métricas.
const RE_BOT =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebookcatalog|WhatsApp\/|TelegramBot|Slackbot|Discordbot|Twitterbot|LinkedInBot|SkypeUriPreview|Google-|Bingbot|Applebot|preview|HeadlessChrome|curl\/|wget\/|python-requests|node-fetch|axios\/|Go-http-client|okhttp/i;

// Navegador interno de una app: el user-agent lo delata. El orden importa
// (Messenger antes que Facebook; Threads se identifica como "Barcelona").
const APPS = [
  ['instagram', /Instagram/i],
  ['threads', /Barcelona/],
  ['messenger', /FBAN\/Messenger|MessengerForiOS|MessengerLite/i],
  ['facebook', /FBAN|FBAV|FB_IAB|FBIOS/],
  ['tiktok', /musical_ly|TikTok|BytedanceWebview|trill_/i],
  ['linkedin', /LinkedInApp/i],
  ['snapchat', /Snapchat/i],
  ['telegram', /Telegram/i],
  ['google', /GSA\//],
];

const recortar = (valor, max) => {
  const s = String(valor ?? '').trim();
  return s ? s.slice(0, max) : null;
};

function header(req, nombre) {
  const v = req.headers[nombre];
  if (!v) return null;
  try {
    return decodeURIComponent(Array.isArray(v) ? v[0] : v);
  } catch {
    return String(v);
  }
}

// Solo origen + path: el query string de otro sitio puede traer tokens o
// datos personales que no queremos guardar.
function limpiarReferer(ref) {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    return recortar(`${u.origin}${u.pathname}`, 300);
  } catch {
    return null;
  }
}

function dispositivo(ua) {
  if (!ua) return null;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Mac OS X|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'otro';
}

function appOrigen(ua) {
  if (!ua) return null;
  for (const [nombre, re] of APPS) if (re.test(ua)) return nombre;
  return null;
}

// Todo lo que se puede saber del request sin preguntar nada. La geo sale de
// los headers que agrega el edge cuando existen: Vercel en los taps (el /v/
// pasa por el rewrite de next-tap.tech) y Cloudflare si algún día se pone
// adelante. Si no hay headers, queda solo la IP (se puede geolocalizar después).
export function datosDelCliente(req) {
  const ua = recortar(req.headers['user-agent'], 500);
  const ip =
    recortar(String(header(req, 'x-vercel-forwarded-for') || '').split(',')[0], 64) ||
    recortar(req.ip, 64);
  return {
    ip,
    pais: recortar(header(req, 'x-vercel-ip-country') || header(req, 'cf-ipcountry'), 8),
    region: recortar(header(req, 'x-vercel-ip-country-region') || header(req, 'cf-region'), 64),
    ciudad: recortar(header(req, 'x-vercel-ip-city') || header(req, 'cf-ipcity'), 100),
    user_agent: ua,
    dispositivo: dispositivo(ua),
    app_origen: appOrigen(ua),
    idioma: recortar(String(req.headers['accept-language'] || '').split(',')[0], 20),
    es_bot: Boolean(ua && RE_BOT.test(ua)) || !ua,
  };
}

function leerCookie(req, nombre) {
  const raw = req.headers.cookie || '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const nuevoVisitanteId = () => randomBytes(12).toString('base64url');

export const esVisitanteId = (v) => typeof v === 'string' && ES_VISITANTE_ID.test(v);

// Id del visitante desde la cookie nt_vid; si no tiene, se le crea una. La
// setea siempre el SERVIDOR en next-tap.tech (el /v/ y el /t/* pasan por el
// rewrite de Vercel), así es de primera parte y Safari no la recorta a 7 días
// como haría con una cookie creada por JS. Los bots no reciben cookie.
function visitanteDeCookie(req, res, esBot) {
  const actual = leerCookie(req, COOKIE_VISITANTE);
  if (esVisitanteId(actual)) return { id: actual, nuevo: false };
  if (esBot) return { id: null, nuevo: null };
  const id = nuevoVisitanteId();
  res.cookie(COOKIE_VISITANTE, id, {
    maxAge: COOKIE_MAX_AGE_MS,
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
  });
  return { id, nuevo: true };
}

function enSegundoPlano(promesa, que) {
  promesa.catch((err) => console.error(`[tracking] no se pudo registrar ${que}:`, err.message));
}

// --- Toques de sticker ---

// Se llama justo ANTES de mandar la respuesta de /v/:codigo (tiene que poder
// setear la cookie). El insert corre en segundo plano: el tap nunca espera a
// la base. primera_vez = este navegador nunca había tocado este código.
export function registrarTap(req, res, { stickerId = null, resultado, destinoTipo = null }) {
  try {
    const cliente = datosDelCliente(req);
    const { id: visitanteId } = visitanteDeCookie(req, res, cliente.es_bot);
    const codigo = recortar(req.params?.codigo, 64) || '';
    enSegundoPlano(
      db.execute({
        sql: `INSERT INTO taps
                (sticker_id, codigo, resultado, destino_tipo, visitante_id, primera_vez,
                 ip, pais, region, ciudad, user_agent, dispositivo, app_origen, idioma, referer, es_bot)
              VALUES (?, ?, ?, ?, ?,
                      CASE WHEN ?::text IS NULL THEN NULL
                           ELSE NOT EXISTS (SELECT 1 FROM taps WHERE visitante_id = ? AND codigo = ?) END,
                      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          stickerId, codigo, resultado, destinoTipo, visitanteId,
          visitanteId, visitanteId, codigo,
          cliente.ip, cliente.pais, cliente.region, cliente.ciudad, cliente.user_agent,
          cliente.dispositivo, cliente.app_origen, cliente.idioma,
          limpiarReferer(req.headers.referer), cliente.es_bot,
        ],
      }),
      'el tap'
    );
  } catch (err) {
    console.error('[tracking] error armando el tap:', err.message);
  }
}

// --- Páginas vistas de la landing ---

// Límite propio por IP: el endpoint es público y no queremos que alguien llene
// las tablas. Pasado el límite se descarta en silencio.
const VISITAS_POR_MINUTO = 60; // páginas vistas + eventos
const visitasPorIp = new Map(); // ip -> { count, resetAt }
function superaLimite(ip) {
  const now = Date.now();
  const entry = visitasPorIp.get(ip);
  if (!entry || entry.resetAt < now) {
    visitasPorIp.set(ip, { count: 1, resetAt: now + 60_000 });
    if (visitasPorIp.size > 5000) {
      for (const [k, v] of visitasPorIp) if (v.resetAt < now) visitasPorIp.delete(k);
    }
    return false;
  }
  return ++entry.count > VISITAS_POR_MINUTO;
}

const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const bool = (v) => (typeof v === 'boolean' ? v : null);

function leerBody(req) {
  let body = req.body;
  if (typeof body === 'string') body = JSON.parse(body);
  return body && typeof body === 'object' ? body : null;
}

// Nombres de evento aceptados — todo lo demás se descarta.
const EVENTOS = new Set([
  'wizard_abierto',
  'wizard_paso',
  'wizard_cerrado',
  'contacto_verificado',
  'pago_iniciado',
  'volvio_de_pago',
]);

// Las dos rutas las llama src/visita.js a través del rewrite de Vercel
// (next-tap.tech/t/visita y /t/evento → /api/visitas y /api/eventos). Pasar
// por el mismo dominio de la landing es lo que permite setear y leer la cookie
// nt_vid como cookie propia. Content-Type text/plain = sin preflight de CORS.
export function crearVisitasRouter() {
  const router = express.Router();
  const texto = express.text({ type: 'text/plain', limit: '4kb' });

  // Página vista. Responde el id del visitante para que el front lo mande en
  // POST /api/ventas (esa llamada va directo a Render y no ve la cookie).
  router.post('/visitas', texto, (req, res) => {
    let body;
    try {
      body = leerBody(req);
    } catch {
      body = null;
    }
    const cliente = datosDelCliente(req);
    const pagina = recortar(body?.pagina, 200);
    if (!body || !pagina || !pagina.startsWith('/') || superaLimite(cliente.ip || 'unknown')) {
      return res.status(204).end();
    }
    const { id: visitanteId, nuevo } = visitanteDeCookie(req, res, cliente.es_bot);
    res.json({ visitanteId });

    const s = body.senales || {};
    enSegundoPlano(
      db.execute({
        sql: `INSERT INTO visitas
                (visitante_id, primera_vez, sesion_id, pagina, utm_source, utm_medium, utm_campaign,
                 utm_content, utm_term, vendedor_token, referer, ip, pais, region, ciudad, user_agent,
                 dispositivo, app_origen, idioma, pantalla, zona_horaria, pixel_ratio, modo_oscuro,
                 tactil, nucleos, memoria_gb, conexion, ahorro_datos, huella, es_bot)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          visitanteId,
          nuevo,
          esVisitanteId(body.sesionId) ? body.sesionId : null,
          pagina,
          recortar(body.utm?.source, 100),
          recortar(body.utm?.medium, 100),
          recortar(body.utm?.campaign, 150),
          recortar(body.utm?.content, 150),
          recortar(body.utm?.term, 150),
          recortar(body.vendedorToken, 64),
          limpiarReferer(body.referer),
          cliente.ip, cliente.pais, cliente.region, cliente.ciudad, cliente.user_agent,
          cliente.dispositivo, cliente.app_origen,
          recortar(s.idioma, 20) || cliente.idioma,
          recortar(s.pantalla, 20),
          recortar(s.zonaHoraria, 64),
          num(s.pixelRatio, 0.5, 5),
          bool(s.modoOscuro),
          bool(s.tactil),
          num(s.nucleos, 1, 256),
          num(s.memoriaGb, 0.1, 64),
          recortar(s.conexion, 16),
          bool(s.ahorroDatos),
          /^[0-9a-f]{16,64}$/.test(String(body.huella || '')) ? body.huella : null,
          cliente.es_bot,
        ],
      }),
      'la visita'
    );
  });

  // Evento del recorrido (paso del wizard, abandono, pago iniciado...).
  router.post('/eventos', texto, (req, res) => {
    res.status(204).end();
    try {
      const body = leerBody(req);
      const nombre = String(body?.nombre || '');
      if (!EVENTOS.has(nombre)) return;
      const cliente = datosDelCliente(req);
      if (cliente.es_bot || superaLimite(cliente.ip || 'unknown')) return;
      // Cookie primero; el id del body cubre el caso en que el navegador no la mandó.
      const cookie = leerCookie(req, COOKIE_VISITANTE);
      const visitanteId = esVisitanteId(cookie) ? cookie : esVisitanteId(body.visitanteId) ? body.visitanteId : null;
      let datos = null;
      if (body.datos && typeof body.datos === 'object') {
        const json = JSON.stringify(body.datos);
        if (json.length <= 1000) datos = json;
      }
      enSegundoPlano(
        db.execute({
          sql: 'INSERT INTO eventos (visitante_id, sesion_id, nombre, pagina, datos) VALUES (?, ?, ?, ?, ?::jsonb)',
          args: [
            visitanteId,
            esVisitanteId(body.sesionId) ? body.sesionId : null,
            nombre,
            recortar(body.pagina, 200),
            datos,
          ],
        }),
        'el evento'
      );
    } catch {
      // body inválido: se ignora
    }
  });

  return router;
}

// --- Aceptación de TyC ---

// Versión vigente de los TyC de compra. Subirla cada vez que cambie el texto
// de terminos.html / el modal del wizard (y la fecha que muestran).
export const TYC_VERSION = '1 (2026-09-05)';

export async function registrarAceptacionTyc(req, { ventaId, compradorId, stickerId = null, contexto }) {
  const cliente = datosDelCliente(req);
  await db.execute({
    sql: `INSERT INTO aceptaciones_tyc (sticker_id, comprador_id, venta_id, version_tyc, ip, user_agent, contexto)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [stickerId, compradorId, ventaId, TYC_VERSION, cliente.ip, cliente.user_agent, contexto],
  });
}
