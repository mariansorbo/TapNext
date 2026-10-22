// Solapa "Post Affiliate Pro" del panel admin: agencias (afiliados), ventas por
// transferencia cargadas a mano, aprobación de comisiones y pago mensual.
// Habla con la API v3 de PAP (docs: <cuenta>/api/v3, spec en api/v3/openapi.json)
// con PAP_API_KEY. Las ventas web NO pasan por acá: las manda server/pap.js
// desde el webhook de Mercado Pago.
//
// Admin (todo bajo /api/admin, con requireAdmin):
//   GET   /pap/estado                      → config + si hay clave de API
//   GET   /pap/afiliados                   → agencias de PAP + datos locales (agencia, alias)
//   POST  /pap/afiliados                   → { agencia, contacto, email, codigo, alias? }: alta aprobada
//   PATCH /pap/afiliados/:id               → { alias }: datos locales de pago
//   POST  /pap/ventas-transferencia        → { afiliadoId, empresa, combos, monto, pedido? }
//   GET   /pap/comisiones?mes=YYYY-MM      → ventas del mes agrupadas por agencia + si se pagó
//   PATCH /pap/transacciones/:id           → { status: approved|declined|pending }
//   POST  /pap/pagos                       → { afiliadoId, mes, monto }: marca el mes como pagado
//   DELETE /pap/pagos/:afiliadoId/:mes     → deshace la marca
//
// PAP no expone "pagado" por API, así que el pago mensual se registra acá
// (tabla pap_pagos). La agencia (nombre comercial) y su alias también son
// locales: en PAP el afiliado es la persona de contacto.

import express from 'express';
import { db } from './db.js';

const PAP_URL =
  process.env.PAP_URL === 'off'
    ? ''
    : (process.env.PAP_URL || 'https://next-tap.postaffiliatepro.com').replace(/\/+$/, '');
const PAP_API_KEY = process.env.PAP_API_KEY || '';
const COMISION_PCT = Number(process.env.PAP_COMISION_PCT || 20);
const PRECIO_COMBO = Number(process.env.PAP_PRECIO_COMBO || 30000);
const LANDING_URL = (process.env.FRONTEND_URL || 'https://next-tap.tech').replace(/\/+$/, '');
const UTM_AFILIADOS = 'utm_source=afiliados&utm_medium=referido&utm_campaign=afiliados';

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS pap_agencias (
    pap_id TEXT PRIMARY KEY,               -- id del afiliado en PAP
    agencia TEXT NOT NULL,
    alias TEXT,                            -- alias / CBU para transferirle
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS pap_pagos (
    pap_id TEXT NOT NULL,
    mes TEXT NOT NULL,                     -- YYYY-MM de las ventas que se pagaron
    monto REAL NOT NULL,
    pagado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pap_id, mes)
  );
`);

const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

export const linkDeAfiliado = (codigo) => `${LANDING_URL}/?a_aid=${encodeURIComponent(codigo)}&${UTM_AFILIADOS}`;

class PapError extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

async function pap(path, { method = 'GET', body, query } = {}) {
  if (!PAP_URL || !PAP_API_KEY) throw new PapError(503, 'Falta la clave de API de Post Affiliate Pro (PAP_API_KEY).');
  const url = new URL(`${PAP_URL}/api/v3${path}`);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${PAP_API_KEY}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  let data = null;
  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    /* PAP a veces responde HTML en errores de infraestructura */
  }
  if (!res.ok) {
    const detalle =
      data?.error?.code === 'insufficient_scope'
        ? 'la clave de API no tiene permiso para esto (revisá los Access scopes de la clave en PAP)'
        : data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : '') || texto.slice(0, 200);
    throw new PapError(res.status === 401 || res.status === 403 ? 502 : res.status >= 500 ? 502 : 400, `PAP: ${detalle}`);
  }
  return data;
}

// Lista completa con el cursor de PAP (last_id / last_value), de a 100.
async function papTodo(path, query = {}) {
  const filas = [];
  let cursor = {};
  for (let i = 0; i < 50; i++) {
    const r = await pap(path, { query: { ...query, per_page: 100, ...cursor } });
    filas.push(...(r?.data || []));
    const p = r?.pagination;
    if (!p?.last_id || (r?.data || []).length < 100) break;
    cursor = { last_id: p.last_id, last_value: p.last_value };
  }
  return filas;
}

let campaniaDefault = null;
async function idCampaniaDefault() {
  if (campaniaDefault) return campaniaDefault;
  const r = await pap('/campaigns', { query: { per_page: 100 } });
  const c = (r?.data || []).find((x) => x.is_default) || null;
  campaniaDefault = c?.id || null;
  return campaniaDefault;
}

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CODIGO_RE = /^[A-Z0-9]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rangoDelMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

function afiliadoPublico(a, local) {
  return {
    id: a.id,
    codigo: a.referral_id,
    contacto: [a.first_name, a.last_name].filter(Boolean).join(' '),
    email: a.username,
    estado: a.status,
    alta: a.created_at,
    agencia: local?.agencia || null,
    alias: local?.alias || null,
    link: linkDeAfiliado(a.referral_id),
  };
}

export function crearPapAdminRouter() {
  const r = express.Router();

  const manejar = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof PapError) return res.status(err.status).json({ error: err.message });
      console.error('[PAP admin]', err);
      res.status(500).json({ error: 'Error inesperado hablando con Post Affiliate Pro.' });
    }
  };

  r.get('/pap/estado', (req, res) => {
    res.json({
      configurado: Boolean(PAP_URL && PAP_API_KEY),
      cuentaUrl: PAP_URL,
      panelMerchant: PAP_URL ? `${PAP_URL}/merchants/` : null,
      panelAfiliados: PAP_URL ? `${PAP_URL}/affiliates/` : null,
      signupUrl: PAP_URL ? `${PAP_URL}/affiliates/signup.php` : null,
      landingUrl: LANDING_URL,
      comisionPct: COMISION_PCT,
      precioCombo: PRECIO_COMBO,
    });
  });

  r.get(
    '/pap/afiliados',
    manejar(async (req, res) => {
      const [remotos, locales] = await Promise.all([papTodo('/affiliates'), q('SELECT * FROM pap_agencias')]);
      const porId = new Map(locales.map((l) => [l.pap_id, l]));
      const afiliados = remotos
        .map((a) => afiliadoPublico(a, porId.get(a.id)))
        .sort((x, y) => String(y.alta || '').localeCompare(String(x.alta || '')));
      res.json({ afiliados });
    })
  );

  r.post(
    '/pap/afiliados',
    manejar(async (req, res) => {
      const agencia = String(req.body?.agencia || '').trim().slice(0, 120);
      const contacto = String(req.body?.contacto || '').trim().slice(0, 120);
      const email = String(req.body?.email || '').trim().toLowerCase();
      const codigo = String(req.body?.codigo || '').trim().toUpperCase();
      const alias = String(req.body?.alias || '').trim().slice(0, 120) || null;
      if (!agencia || !contacto) return res.status(400).json({ error: 'Completá la agencia y la persona de contacto.' });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'El mail no parece válido.' });
      if (!CODIGO_RE.test(codigo))
        return res.status(400).json({ error: 'El código va en mayúsculas, sin espacios ni acentos, de 3 a 20 letras o números (ej. LOPEZ).' });

      const creado = await pap('/affiliates', {
        method: 'POST',
        body: { username: email, full_name: contacto, referral_id: codigo, send_notification_email: false },
      });
      let afiliado = creado?.data || creado;
      if (afiliado?.status !== 'approved') {
        await pap(`/affiliates/${encodeURIComponent(afiliado.id)}`, { method: 'PATCH', body: { status: 'approved' } });
        afiliado = { ...afiliado, status: 'approved' };
      }
      await q(
        `INSERT INTO pap_agencias (pap_id, agencia, alias) VALUES (?, ?, ?)
         ON CONFLICT (pap_id) DO UPDATE SET agencia = excluded.agencia, alias = excluded.alias
         RETURNING pap_id`,
        [afiliado.id, agencia, alias]
      );
      res.status(201).json({ afiliado: afiliadoPublico(afiliado, { agencia, alias }) });
    })
  );

  r.patch(
    '/pap/afiliados/:id',
    manejar(async (req, res) => {
      const alias = String(req.body?.alias ?? '').trim().slice(0, 120) || null;
      const agencia = req.body?.agencia != null ? String(req.body.agencia).trim().slice(0, 120) : null;
      await q(
        `INSERT INTO pap_agencias (pap_id, agencia, alias) VALUES (?, ?, ?)
         ON CONFLICT (pap_id) DO UPDATE SET alias = excluded.alias,
           agencia = COALESCE(NULLIF(?, ''), pap_agencias.agencia)
         RETURNING pap_id`,
        [req.params.id, agencia || '—', alias, agencia || '']
      );
      res.json({ ok: true });
    })
  );

  r.post(
    '/pap/ventas-transferencia',
    manejar(async (req, res) => {
      const afiliadoId = String(req.body?.afiliadoId || '').trim();
      const empresa = String(req.body?.empresa || '').trim().slice(0, 120);
      const combos = Math.floor(Number(req.body?.combos));
      const monto = Number(req.body?.monto);
      const pedido = String(req.body?.pedido || '').trim().slice(0, 60) || `TRANSF-${Date.now()}`;
      if (!afiliadoId) return res.status(400).json({ error: 'Elegí la agencia.' });
      if (!empresa) return res.status(400).json({ error: 'Poné el nombre de la empresa que compró.' });
      if (!(combos >= 1)) return res.status(400).json({ error: 'La cantidad de combos tiene que ser 1 o más.' });
      if (!(monto > 0)) return res.status(400).json({ error: 'El monto tiene que ser mayor a 0 (sin envío).' });

      const campaignId = await idCampaniaDefault();
      const tx = await pap('/transactions', {
        method: 'POST',
        body: {
          affiliate_id: afiliadoId,
          type: 'sale',
          status: 'approved', // ya entró la plata: se carga cuando llega la transferencia
          total_cost: monto,
          commission: Math.round(monto * COMISION_PCT) / 100,
          order_id: pedido,
          product_id: 'combo',
          ...(campaignId ? { campaign_id: campaignId } : {}),
          data1: empresa,
          data2: `${combos} combo(s) — transferencia`,
          send_notification_email: false,
        },
      });
      res.status(201).json({ transaccion: tx?.data || tx });
    })
  );

  r.get(
    '/pap/comisiones',
    manejar(async (req, res) => {
      const mes = MES_RE.test(String(req.query.mes || '')) ? req.query.mes : new Date().toISOString().slice(0, 7);
      const { desde, hasta } = rangoDelMes(mes);
      const [txs, afiliados, locales, pagos] = await Promise.all([
        papTodo('/transactions', { q: `type:sale created_at:${desde}..${hasta}` }),
        papTodo('/affiliates'),
        q('SELECT * FROM pap_agencias'),
        q('SELECT * FROM pap_pagos WHERE mes = ?', [mes]),
      ]);
      const porLocal = new Map(locales.map((l) => [l.pap_id, l]));
      const porPago = new Map(pagos.map((p) => [p.pap_id, p]));
      const porAfiliado = new Map(afiliados.map((a) => [a.id, afiliadoPublico(a, porLocal.get(a.id))]));

      const grupos = new Map();
      for (const t of txs) {
        if (!grupos.has(t.affiliate_id)) {
          grupos.set(t.affiliate_id, {
            afiliado: porAfiliado.get(t.affiliate_id) || { id: t.affiliate_id, codigo: '?', contacto: 'Afiliado borrado' },
            ventas: [],
          });
        }
        grupos.get(t.affiliate_id).ventas.push({
          id: t.id,
          fecha: t.created_at,
          pedido: t.order_id,
          empresa: t.data1 || null,
          detalle: t.data2 || null,
          totalCost: Number(t.total_cost || 0),
          comision: Number(t.commission || 0),
          estado: t.status,
        });
      }
      const agencias = [...grupos.values()].map((g) => {
        const aprobadas = g.ventas.filter((v) => v.estado === 'approved');
        const pago = porPago.get(g.afiliado.id);
        return {
          ...g,
          aprobadas: aprobadas.length,
          aPagar: Math.round(aprobadas.reduce((s, v) => s + v.comision, 0) * 100) / 100,
          pendientes: g.ventas.filter((v) => v.estado === 'pending').length,
          pago: pago ? { monto: Number(pago.monto), pagadoEn: pago.pagado_en } : null,
        };
      });
      agencias.sort((a, b) => b.aPagar - a.aPagar);
      res.json({ mes, agencias });
    })
  );

  r.patch(
    '/pap/transacciones/:id',
    manejar(async (req, res) => {
      const status = String(req.body?.status || '');
      if (!['approved', 'declined', 'pending'].includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
      const nota = String(req.body?.nota || '').trim().slice(0, 200) || undefined;
      const r2 = await pap(`/transactions/${encodeURIComponent(req.params.id)}/status`, {
        method: 'PATCH',
        body: { status, ...(nota ? { note: nota } : {}), send_notification_email: false },
      });
      res.json({ ok: true, resultado: r2?.data || r2 });
    })
  );

  r.post(
    '/pap/pagos',
    manejar(async (req, res) => {
      const afiliadoId = String(req.body?.afiliadoId || '').trim();
      const mes = String(req.body?.mes || '');
      const monto = Number(req.body?.monto);
      if (!afiliadoId || !MES_RE.test(mes) || !(monto >= 0)) return res.status(400).json({ error: 'Datos de pago incompletos.' });
      await q(
        `INSERT INTO pap_pagos (pap_id, mes, monto) VALUES (?, ?, ?)
         ON CONFLICT (pap_id, mes) DO UPDATE SET monto = excluded.monto, pagado_en = NOW()
         RETURNING pap_id`,
        [afiliadoId, mes, monto]
      );
      res.json({ ok: true });
    })
  );

  r.delete(
    '/pap/pagos/:afiliadoId/:mes',
    manejar(async (req, res) => {
      await q('DELETE FROM pap_pagos WHERE pap_id = ? AND mes = ? RETURNING pap_id', [req.params.afiliadoId, req.params.mes]);
      res.json({ ok: true });
    })
  );

  return r;
}
