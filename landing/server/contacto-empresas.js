// Formulario de contacto de empresas.html ("Contanos de tu equipo").
//
// Público: POST /api/contacto-empresas  { nombre, empresa, email, combos?, mensaje?, web?, ms? }
//
// Guarda la consulta (así no se pierde si falla el mail) y la manda por mail a
// CONTACTO_EMPRESAS_TO (por defecto ventas@next-tap.tech) con reply-to al mail
// de quien escribió: respondés directo desde la bandeja. Sale por Resend, igual
// que el resto de los mails (server/correo.js).
//
// Anti-spam: honeypot (`web`, invisible, solo lo completa un bot), tiempo
// mínimo entre que se abrió la página y se envió (`ms`) y tope por IP.

import express from 'express';
import { db } from './db.js';
import { enviarCorreo } from './correo.js';
import { datosDelCliente } from './tracking.js';

const DESTINO = process.env.CONTACTO_EMPRESAS_TO || 'ventas@next-tap.tech';
const MS_MINIMO = 3000; // un humano no completa 3 campos en menos de 3 s
const ENVIOS_POR_HORA = 5;

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS contactos_empresas (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    empresa TEXT NOT NULL,
    email TEXT NOT NULL,
    combos INTEGER,
    mensaje TEXT,
    mail_enviado BOOLEAN NOT NULL DEFAULT FALSE,
    ip TEXT,
    user_agent TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

const enviosPorIp = new Map(); // ip -> { count, resetAt }
function superaLimite(ip) {
  const now = Date.now();
  const e = enviosPorIp.get(ip);
  if (!e || e.resetAt < now) {
    enviosPorIp.set(ip, { count: 1, resetAt: now + 3_600_000 });
    if (enviosPorIp.size > 5000) for (const [k, v] of enviosPorIp) if (v.resetAt < now) enviosPorIp.delete(k);
    return false;
  }
  return ++e.count > ENVIOS_POR_HORA;
}

const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const esMail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 120;

export function crearContactoEmpresasRouter() {
  const router = express.Router();

  router.post('/contacto-empresas', async (req, res) => {
    const body = req.body || {};
    // Bot: le decimos que salió bien y no hacemos nada.
    if (body.web || Number(body.ms) < MS_MINIMO) return res.json({ ok: true });

    const nombre = texto(body.nombre, 100);
    const empresa = texto(body.empresa, 120);
    const email = texto(body.email, 120).toLowerCase();
    const mensaje = texto(body.mensaje, 2000);
    const combosNum = parseInt(String(body.combos ?? '').replace(/\D/g, ''), 10);
    const combos = Number.isFinite(combosNum) && combosNum > 0 ? Math.min(combosNum, 100000) : null;

    if (!nombre) return res.status(400).json({ error: 'Contanos tu nombre.' });
    if (!empresa) return res.status(400).json({ error: 'Contanos de qué empresa sos.' });
    if (!esMail(email)) return res.status(400).json({ error: 'Revisá tu mail: así te respondemos.' });

    const cliente = datosDelCliente(req);
    if (superaLimite(cliente.ip || 'unknown')) {
      return res.status(429).json({ error: 'Ya recibimos tus mensajes. Si querés, escribinos por WhatsApp.' });
    }

    let id;
    try {
      const { rows } = await db.execute({
        sql: `INSERT INTO contactos_empresas (nombre, empresa, email, combos, mensaje, ip, user_agent)
              VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: [nombre, empresa, email, combos, mensaje || null, cliente.ip, cliente.user_agent],
      });
      id = rows[0]?.id;
    } catch (err) {
      console.error('[contacto-empresas] no se pudo guardar:', err.message);
      return res.status(500).json({ error: 'No pudimos enviar tu mensaje. Probá de nuevo o escribinos por WhatsApp.' });
    }

    const enviado = await enviarCorreo({
      to: DESTINO,
      replyTo: email,
      subject: `Empresas: ${empresa}${combos ? ` — ${combos} combos` : ''}`,
      text: [
        'Nueva consulta desde next-tap.tech/empresas',
        '',
        `Nombre:  ${nombre}`,
        `Empresa: ${empresa}`,
        `Mail:    ${email}`,
        `Combos:  ${combos ?? '(no dijo)'}`,
        '',
        mensaje || '(sin mensaje)',
        '',
        'Respondé este mail para contestarle directo.',
      ].join('\n'),
    });
    if (enviado && id) {
      await db.execute({ sql: 'UPDATE contactos_empresas SET mail_enviado = TRUE WHERE id = ?', args: [id] }).catch(() => {});
    }
    res.json({ ok: true });
  });

  return router;
}
