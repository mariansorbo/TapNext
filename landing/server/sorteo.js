// Sorteo de Instagram (disfraz del cubo QR y los que vengan). Config en
// src/sorteo-config.js.
//
// Público:  POST /api/sorteo/participar  { instagram, contacto, aceptaBases, visitanteId? }
// Admin:    GET   /api/admin/sorteo                  → participantes + chances
//           PATCH /api/admin/sorteo/:id              → { sigue, historia, posteo, descalificado }
//           POST  /api/admin/sorteo/marcar           → { campo, texto }: pega una lista de @ y los marca
//           POST  /api/admin/sorteo/sortear          → saca un ganador al azar, ponderado por chances
//
// Chances: 1 por participar + 1 si subió historia etiquetando la cuenta + 1 si
// hizo un posteo etiquetándola. Instagram no deja leer seguidores ni historias
// ajenas sin una app aprobada por Meta, así que eso se carga desde el admin:
// pegando los @ que aparecen en las notificaciones / DMs ("te mencionó en su
// historia") o en la lista de seguidores. Seguir la cuenta se verifica sobre
// el ganador: si no sigue, se lo descalifica y se vuelve a sortear.
//
// Sin obligación de compra (ley de lealtad comercial): solo se pide el @ y un
// contacto para avisarle al ganador.

import express from 'express';
import { randomInt } from 'node:crypto';
import { db } from './db.js';
import { datosDelCliente, esVisitanteId } from './tracking.js';
import { SORTEO, sorteoAbierto } from '../src/sorteo-config.js';

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS sorteo_participantes (
    id SERIAL PRIMARY KEY,
    sorteo TEXT NOT NULL,
    instagram TEXT NOT NULL,              -- sin @, en minúscula
    contacto TEXT NOT NULL,               -- whatsapp (solo dígitos) o mail
    contacto_tipo TEXT NOT NULL,          -- whatsapp | email
    historia BOOLEAN NOT NULL DEFAULT FALSE, -- subió historia etiquetando la cuenta (+1 chance), lo marca el admin
    descalificado BOOLEAN NOT NULL DEFAULT FALSE, -- ej. no sigue la cuenta
    ganador_en TIMESTAMPTZ,
    visitante_id TEXT,
    ip TEXT,
    user_agent TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sorteo, instagram)
  );
  ALTER TABLE sorteo_participantes ADD COLUMN IF NOT EXISTS posteo BOOLEAN NOT NULL DEFAULT FALSE; -- posteo etiquetando la cuenta (+1)
  ALTER TABLE sorteo_participantes ADD COLUMN IF NOT EXISTS sigue BOOLEAN;  -- NULL = sin verificar
`);

const CAMPOS_MARCABLES = ['sigue', 'historia', 'posteo', 'descalificado'];
export const chances = (p) => 1 + (p.historia ? 1 : 0) + (p.posteo ? 1 : 0);

// Todos los @ que aparezcan en un texto pegado (notificaciones, DMs, lista de
// seguidores copiada de la web). Con o sin @, uno por línea o mezclados.
export function extraerHandles(texto) {
  const out = new Set();
  const s = String(texto || '').toLowerCase();
  // Si el texto trae @, solo cuentan las palabras con @ (así "te mencionó en
  // su historia" no suma "historia" como usuario). Si no, una palabra = un @.
  const conArroba = s.includes('@');
  for (let token of s.split(/[\s,;]+/)) {
    token = token.replace(/^[("'“]+/, '');
    if (conArroba && !token.startsWith('@') && !token.includes('instagram.com/')) continue;
    const h = normalizarInstagram(token.replace(/[:!?¡¿()"'“”.]+$/g, ''));
    if (h) out.add(h);
  }
  return [...out];
}

// Acepta "@juan.perez", "juan.perez", "instagram.com/juan.perez/?hl=es".
export function normalizarInstagram(valor) {
  let s = String(valor || '').trim().toLowerCase();
  const url = s.match(/instagram\.com\/([^/?#\s]+)/);
  if (url) s = url[1];
  s = s.replace(/^@+/, '').replace(/\s+/g, '');
  return /^[a-z0-9._]{1,30}$/.test(s) && !/^\.|\.$/.test(s) ? s : null;
}

// WhatsApp argentino tal como lo escriba la gente (11 2345-6789, +54 9 11...,
// 15-2345-6789 con característica) o un mail.
export function normalizarContacto(valor) {
  const s = String(valor || '').trim();
  if (s.includes('@')) {
    const mail = s.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) && mail.length <= 120 ? { contacto: mail, tipo: 'email' } : null;
  }
  const digitos = s.replace(/\D/g, '');
  return digitos.length >= 8 && digitos.length <= 15 ? { contacto: digitos, tipo: 'whatsapp' } : null;
}

const INTENTOS_POR_HORA = 10;
const intentosPorIp = new Map(); // ip -> { count, resetAt }
function superaLimite(ip) {
  const now = Date.now();
  const e = intentosPorIp.get(ip);
  if (!e || e.resetAt < now) {
    intentosPorIp.set(ip, { count: 1, resetAt: now + 3_600_000 });
    if (intentosPorIp.size > 5000) for (const [k, v] of intentosPorIp) if (v.resetAt < now) intentosPorIp.delete(k);
    return false;
  }
  return ++e.count > INTENTOS_POR_HORA;
}

export function crearSorteoRouter() {
  const router = express.Router();

  router.post('/participar', async (req, res) => {
    if (!sorteoAbierto()) return res.status(410).json({ error: 'El sorteo ya cerró. ¡Gracias por pasar!' });
    const body = req.body || {};
    // Honeypot: campo invisible que solo completa un bot.
    if (body.web) return res.json({ ok: true });

    const instagram = normalizarInstagram(body.instagram);
    if (!instagram) return res.status(400).json({ error: 'Revisá tu usuario de Instagram.' });
    const contacto = normalizarContacto(body.contacto);
    if (!contacto) return res.status(400).json({ error: 'Dejanos un WhatsApp o un mail válido para avisarte si ganás.' });
    if (body.aceptaBases !== true) return res.status(400).json({ error: 'Tenés que aceptar las bases del sorteo.' });

    const cliente = datosDelCliente(req);
    if (superaLimite(cliente.ip || 'unknown')) {
      return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en un rato.' });
    }

    try {
      const { rows } = await db.execute({
        sql: `INSERT INTO sorteo_participantes
                (sorteo, instagram, contacto, contacto_tipo, visitante_id, ip, user_agent)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (sorteo, instagram) DO NOTHING
              RETURNING id`,
        args: [
          SORTEO.slug,
          instagram,
          contacto.contacto,
          contacto.tipo,
          esVisitanteId(body.visitanteId) ? body.visitanteId : null,
          cliente.ip,
          cliente.user_agent,
        ],
      });
      res.json({ ok: true, instagram, yaParticipaba: rows.length === 0 });
    } catch (err) {
      console.error('[sorteo] no se pudo registrar la participación:', err.message);
      res.status(500).json({ error: 'No pudimos anotarte. Probá de nuevo en un ratito.' });
    }
  });

  return router;
}

// Se monta detrás de requireAdmin en /api/admin.
export function crearSorteoAdminRouter() {
  const router = express.Router();

  router.get('/sorteo', async (req, res) => {
    const { rows } = await db.execute({
      sql: `SELECT id, instagram, contacto, contacto_tipo, sigue, historia, posteo, descalificado, ganador_en, creado_en
            FROM sorteo_participantes WHERE sorteo = ? ORDER BY creado_en DESC`,
      args: [SORTEO.slug],
    });
    res.json({
      sorteo: SORTEO,
      abierto: sorteoAbierto(),
      participantes: rows.map((p) => ({ ...p, chances: p.descalificado ? 0 : chances(p) })),
    });
  });

  router.patch('/sorteo/:id', async (req, res) => {
    const sets = [];
    const args = [];
    for (const campo of CAMPOS_MARCABLES) {
      const v = req.body?.[campo];
      if (typeof v === 'boolean' || (campo === 'sigue' && v === null)) {
        sets.push(`${campo} = ?`);
        args.push(v);
      }
    }
    // Descalificar a un ganador (ej. no sigue la cuenta) le saca el premio.
    if (req.body?.descalificado === true) sets.push('ganador_en = NULL');
    if (!sets.length) return res.status(400).json({ error: 'Nada para cambiar.' });
    await db.execute({
      sql: `UPDATE sorteo_participantes SET ${sets.join(', ')} WHERE id = ? AND sorteo = ?`,
      args: [...args, Number(req.params.id), SORTEO.slug],
    });
    res.status(204).end();
  });

  // Marca en bloque: el admin pega texto con @ y se marcan los que participan.
  // Devuelve también los @ que no están anotados (mencionaron pero no se anotaron).
  router.post('/sorteo/marcar', async (req, res) => {
    const campo = req.body?.campo;
    if (!['sigue', 'historia', 'posteo'].includes(campo)) return res.status(400).json({ error: 'Campo inválido.' });
    const handles = extraerHandles(req.body?.texto);
    if (!handles.length) return res.status(400).json({ error: 'No encontré ningún @ en el texto.' });
    const { rows } = await db.execute({
      sql: `UPDATE sorteo_participantes SET ${campo} = TRUE
            WHERE sorteo = ? AND instagram = ANY(?::text[]) RETURNING instagram`,
      args: [SORTEO.slug, handles],
    });
    const marcados = new Set(rows.map((r) => r.instagram));
    res.json({
      marcados: [...marcados],
      noAnotados: handles.filter((h) => !marcados.has(h) && h !== SORTEO.instagram),
    });
  });

  // Un ganador por llamada, entre los no descalificados que todavía no ganaron,
  // con tantos boletos como chances. randomInt usa el generador criptográfico.
  router.post('/sorteo/sortear', async (req, res) => {
    const { rows } = await db.execute({
      sql: `SELECT id, instagram, contacto, contacto_tipo, sigue, historia, posteo FROM sorteo_participantes
            WHERE sorteo = ? AND NOT descalificado AND ganador_en IS NULL AND sigue IS NOT FALSE`,
      args: [SORTEO.slug],
    });
    if (!rows.length) return res.status(400).json({ error: 'No quedan participantes para sortear.' });
    const boletos = rows.flatMap((p) => Array(chances(p)).fill(p));
    const ganador = boletos[randomInt(boletos.length)];
    await db.execute({
      sql: 'UPDATE sorteo_participantes SET ganador_en = NOW() WHERE id = ?',
      args: [ganador.id],
    });
    res.json({ ganador: { ...ganador, chances: chances(ganador) }, participantes: rows.length, boletos: boletos.length });
  });

  return router;
}
