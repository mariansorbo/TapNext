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
//   POST  /pap/ventas-transferencia        → { afiliadoId, empresa, combos, precioCombo, sueltas,
//                                              precioSuelta, sueltasConComision, nota?, pedido? }
//   GET   /pap/comisiones?mes=YYYY-MM      → ventas del mes agrupadas por agencia + si se pagó
//   PATCH /pap/transacciones/:id           → { status: approved|declined|pending }
//   POST  /pap/pagos                       → { afiliadoId, mes, monto }: marca el mes como pagado
//   DELETE /pap/pagos/:afiliadoId/:mes     → deshace la marca
//   PUT   /pap/plantillas/:clave           → { asunto, cuerpo }: guarda la plantilla editada
//   DELETE /pap/plantillas/:clave          → vuelve a la original (src/pap-plantillas.js)
//     clave: bienvenida | primer_toque
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
  CREATE TABLE IF NOT EXISTS pap_plantillas (
    clave TEXT PRIMARY KEY,                -- 'bienvenida' | 'primer_toque'
    asunto TEXT NOT NULL,
    cuerpo TEXT NOT NULL,
    editada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

// PAP limita los listados ("grid requests") a 1 por segundo por usuario: todas
// las llamadas pasan en fila, separadas por al menos 1,1 s. Un 429 se reintenta
// una vez.
const ESPACIO_MS = 1100;
let fila = Promise.resolve();
let ultima = 0;
function enFila(fn) {
  const turno = fila.then(async () => {
    const espera = ultima + ESPACIO_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    try {
      return await fn();
    } finally {
      ultima = Date.now();
    }
  });
  fila = turno.catch(() => {});
  return turno;
}

async function pap(path, opciones = {}) {
  try {
    return await enFila(() => papDirecto(path, opciones));
  } catch (err) {
    if (err.reintentar) return enFila(() => papDirecto(path, opciones));
    throw err;
  }
}

async function papDirecto(path, { method = 'GET', body, query } = {}) {
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
    const err = new PapError(res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500 ? 502 : 400, `PAP: ${detalle}`);
    err.reintentar = res.status === 429;
    throw err;
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

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const pesosTxt = (n) => `$${Math.round(n).toLocaleString('es-AR')}`;

// Venta por transferencia: combos + unidades sueltas, cada uno con su precio.
// Las sueltas suman comisión solo si sueltasConComision (la decisión es del
// admin en cada venta). Todo sin envío. Exportada para los tests.
export function calcularVentaTransferencia(body, pct = COMISION_PCT) {
  const combos = Math.max(0, Math.floor(Number(body.combos) || 0));
  const sueltas = Math.max(0, Math.floor(Number(body.sueltas) || 0));
  const precioCombo = Number(body.precioCombo);
  const precioSuelta = Number(body.precioSuelta);
  const sueltasConComision = body.sueltasConComision !== false;
  if (!combos && !sueltas) return { error: 'Cargá al menos un combo o una unidad suelta.' };
  if (combos && !(precioCombo > 0)) return { error: 'Falta el precio del combo.' };
  if (sueltas && !(precioSuelta > 0)) return { error: 'Falta el precio de la unidad suelta.' };

  const subCombos = combos * (precioCombo || 0);
  const subSueltas = sueltas * (precioSuelta || 0);
  const total = subCombos + subSueltas;
  const base = subCombos + (sueltasConComision ? subSueltas : 0);
  if (!(base > 0)) return { error: 'No queda nada sobre qué calcular la comisión.' };
  const comision = Math.round(base * pct) / 100;

  const partes = [combos && plural(combos, 'combo', 'combos'), sueltas && plural(sueltas, 'suelta', 'sueltas')].filter(Boolean);
  const descripcion = partes.join(' + ');
  const baseTexto =
    sueltas && !sueltasConComision
      ? `${pct}% sobre ${plural(combos, 'combo', 'combos')} (${pesosTxt(subCombos)}); las sueltas no suman comisión`
      : `${pct}% sobre ${pesosTxt(base)} (${descripcion}) — transferencia`;
  return { combos, sueltas, subCombos, subSueltas, total, base, comision, descripcion, baseTexto };
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

// Público (sin admin): GET /afiliados/codigo/:codigo → { valido, codigo } (codigo tal como está en PAP).
// Lo usa /mail/afiliados.html para armar el mail solo con códigos de agencias
// aprobadas en PAP. La lista se guarda 5 minutos para no consultar PAP en cada
// visita; dar de alta una agencia la invalida al toque.
const CACHE_CODIGOS_MS = 5 * 60 * 1000;
let cacheCodigos = { hasta: 0, codigos: null };
const olvidarCodigosAfiliados = () => {
  cacheCodigos = { hasta: 0, codigos: null };
};
async function codigosAprobados() {
  if (cacheCodigos.codigos && Date.now() < cacheCodigos.hasta) return cacheCodigos.codigos;
  const afiliados = await papTodo('/affiliates');
  // En mayúsculas → tal como está en PAP (el a_aid del link usa el original).
  const codigos = new Map(
    afiliados
      .filter((a) => a.status === 'approved' && a.referral_id)
      .map((a) => [String(a.referral_id).toUpperCase(), String(a.referral_id)])
  );
  cacheCodigos = { hasta: Date.now() + CACHE_CODIGOS_MS, codigos };
  return codigos;
}

export function crearAfiliadosPublicoRouter() {
  const r = express.Router();
  r.get('/afiliados/codigo/:codigo', async (req, res) => {
    const codigo = String(req.params.codigo || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,40}$/.test(codigo)) return res.json({ valido: false });
    if (!PAP_URL || !PAP_API_KEY) return res.status(503).json({ error: 'Post Affiliate Pro no está configurado.' });
    try {
      const original = (await codigosAprobados()).get(codigo);
      res.json(original ? { valido: true, codigo: original } : { valido: false });
    } catch (err) {
      console.error('[PAP código]', err);
      res.status(502).json({ error: 'No se pudo consultar Post Affiliate Pro.' });
    }
  });
  return r;
}

// clave en la base → nombre en /pap/estado.
const CLAVES_PLANTILLA = { bienvenida: 'bienvenida', primer_toque: 'primerToque' };
async function plantillasGuardadas() {
  const filas = await q('SELECT clave, asunto, cuerpo, editada_en FROM pap_plantillas');
  const out = Object.fromEntries(Object.values(CLAVES_PLANTILLA).map((n) => [n, null]));
  for (const f of filas) if (CLAVES_PLANTILLA[f.clave]) out[CLAVES_PLANTILLA[f.clave]] = { asunto: f.asunto, cuerpo: f.cuerpo, editada_en: f.editada_en };
  return out;
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

  r.get('/pap/estado', async (req, res) => {
    // Precio de la unidad suelta = el del llavero en la tabla de precios del admin.
    const fila = (await q("SELECT precio FROM precios WHERE modelo = 'llavero'"))[0];
    res.json({
      configurado: Boolean(PAP_URL && PAP_API_KEY),
      cuentaUrl: PAP_URL,
      panelMerchant: PAP_URL ? `${PAP_URL}/merchants/` : null,
      panelAfiliados: PAP_URL ? `${PAP_URL}/affiliates/` : null,
      signupUrl: PAP_URL ? `${PAP_URL}/affiliates/signup.php` : null,
      landingUrl: LANDING_URL,
      comisionPct: COMISION_PCT,
      precioCombo: PRECIO_COMBO,
      precioSuelta: fila ? Number(fila.precio) : null,
      // Plantillas editadas en el admin; null = la original de src/pap-plantillas.js.
      ...(await plantillasGuardadas()),
    });
  });

  r.put('/pap/plantillas/:clave', async (req, res) => {
    if (!CLAVES_PLANTILLA[req.params.clave]) return res.status(404).json({ error: 'Plantilla desconocida.' });
    const asunto = String(req.body?.asunto || '').trim().slice(0, 200);
    const cuerpo = String(req.body?.cuerpo || '').replace(/\r\n/g, '\n').trim().slice(0, 10000);
    if (!asunto || !cuerpo) return res.status(400).json({ error: 'Completá el asunto y el texto.' });
    const [fila] = await q(
      `INSERT INTO pap_plantillas (clave, asunto, cuerpo) VALUES (?, ?, ?)
       ON CONFLICT (clave) DO UPDATE SET asunto = excluded.asunto, cuerpo = excluded.cuerpo, editada_en = NOW()
       RETURNING asunto, cuerpo, editada_en`,
      [req.params.clave, asunto, cuerpo]
    );
    res.json({ plantilla: fila });
  });

  r.delete('/pap/plantillas/:clave', async (req, res) => {
    if (!CLAVES_PLANTILLA[req.params.clave]) return res.status(404).json({ error: 'Plantilla desconocida.' });
    await q('DELETE FROM pap_plantillas WHERE clave = ? RETURNING clave', [req.params.clave]);
    res.json({ plantilla: null });
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
      olvidarCodigosAfiliados(); // que su código ya sirva en /mail/afiliados.html
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
      const nota = String(req.body?.nota || '').trim().slice(0, 200);
      const v = calcularVentaTransferencia(req.body || {});
      const pedido = String(req.body?.pedido || '').trim().slice(0, 60) || `TRANSF-${Date.now()}`;
      if (!afiliadoId) return res.status(400).json({ error: 'Elegí la agencia.' });
      if (!empresa) return res.status(400).json({ error: 'Poné el nombre de la empresa que compró.' });
      if (v.error) return res.status(400).json({ error: v.error });

      // Lo que ve la agencia en su panel de PAP: Product ID = qué se llevó,
      // total = la venta entera sin envío, comisión = lo que le toca (con o sin
      // sueltas). data1/2/3 quedan en el detalle de la comisión.
      const campaignId = await idCampaniaDefault();
      const tx = await pap('/transactions', {
        method: 'POST',
        body: {
          affiliate_id: afiliadoId,
          type: 'sale',
          status: 'approved', // ya entró la plata: se carga cuando llega la transferencia
          total_cost: v.total,
          commission: v.comision,
          order_id: pedido,
          product_id: v.descripcion,
          ...(campaignId ? { campaign_id: campaignId } : {}),
          data1: empresa,
          data2: v.baseTexto,
          data3: nota || undefined,
          send_notification_email: false,
        },
      });
      res.status(201).json({ transaccion: tx?.data || tx, ...v });
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
          productos: t.product_id || null,
          detalle: t.data2 || null,
          nota: t.data3 || null,
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
