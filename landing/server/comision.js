// Capa de datos del motor de comisión variable. El núcleo puro (simularDia,
// simularPeriodo, ...) vive en comision-core.js y se testea sin DB.
//
// Mientras comision_modelo.activo = 0, calcularComisionVendedor devuelve
// { modeloActivo: false } y el resto de la app sigue con vendedores.comision_pct.

import { db } from './db.js';
import {
  fechaAR,
  diaSemana,
  rangoDias,
  simularPeriodo,
  tramoEn,
  gananciaMarginalDia,
} from './comision-core.js';

export { fechaAR, diaSemana, rangoDias } from './comision-core.js';

async function all(sql, args = []) {
  return (await db.execute({ sql, args })).rows;
}
async function get(sql, args = []) {
  return (await db.execute({ sql, args })).rows[0] || null;
}

// { activo: bool, activadoEn: 'YYYY-MM-DD' | null }
export async function estadoModelo() {
  const row = await get(
    'SELECT activo, activado_en::text AS activado_en FROM comision_modelo WHERE id = 1'
  );
  return {
    activo: !!row && Number(row.activo) === 1,
    activadoEn: row?.activado_en || null,
  };
}

export async function tramosDeVendedor(vendedorId) {
  return all(
    `SELECT orden, etiqueta, desde_u, hasta_u, pct
       FROM vendedor_comision_tramos WHERE vendedor_id = ? ORDER BY orden`,
    [vendedorId]
  );
}

export async function paramsDeVendedor(vendedorId) {
  const v = await get(
    `SELECT comision_bono_finde, comision_deuda_1d, comision_deuda_2d, comision_deuda_3d
       FROM vendedores WHERE id = ?`,
    [vendedorId]
  );
  if (!v) return null;
  return {
    bonoFinde: Number(v.comision_bono_finde),
    deuda1d: Number(v.comision_deuda_1d),
    deuda2d: Number(v.comision_deuda_2d),
    deuda3d: Number(v.comision_deuda_3d),
  };
}

// Cálculo completo para un vendedor. { modeloActivo: false } si el switch global
// está apagado.
export async function calcularComisionVendedor(vendedorId, opts = {}) {
  const modelo = await estadoModelo();
  if (!modelo.activo) return { modeloActivo: false };

  const hoyIso = fechaAR(new Date());
  const desdeIso = modelo.activadoEn && modelo.activadoEn <= hoyIso ? modelo.activadoEn : hoyIso;
  const hastaIso = opts.hasta || hoyIso;

  const params = await paramsDeVendedor(vendedorId);
  if (!params) return { modeloActivo: true, error: 'vendedor inexistente' };
  const tramos = await tramosDeVendedor(vendedorId);

  // Valor de cada venta confirmada, por día (fecha AR), en orden. Una unidad =
  // una fila en venta_items; `monto` = lo que pagó el comprador por ese ítem.
  const filas = await all(
    `SELECT ve.fecha, vi.id AS item_id, vi.monto
       FROM ventas ve JOIN venta_items vi ON vi.venta_id = ve.id
      WHERE ve.vendedor_id = ? AND ve.estado_pago = 'confirmado'
      ORDER BY ve.fecha, vi.id`,
    [vendedorId]
  );
  const itemsPorFecha = new Map();
  for (const f of filas) {
    const iso = fechaAR(f.fecha);
    if (!itemsPorFecha.has(iso)) itemsPorFecha.set(iso, []);
    itemsPorFecha.get(iso).push(Number(f.monto) || 0);
  }

  const ausencias = new Set(
    (await all('SELECT fecha::text AS fecha FROM vendedor_ausencias WHERE vendedor_id = ?', [vendedorId])).map(
      (r) => r.fecha
    )
  );

  const dias = rangoDias(desdeIso, hastaIso).map((iso) => {
    const dow = diaSemana(iso);
    const finde = dow === 0 || dow === 6;
    return {
      fecha: iso,
      esFinde: finde,
      esSabado: dow === 6,
      items: itemsPorFecha.get(iso) || [],
      justificada: ausencias.has(iso) && !finde,
      enCurso: iso === hoyIso,
    };
  });

  const { porDia, total, estado } = simularPeriodo(dias, tramos, params);

  const liquidado = Number(
    (
      await get(
        'SELECT COALESCE(SUM(monto), 0) AS s FROM vendedor_comision_liquidaciones WHERE vendedor_id = ?',
        [vendedorId]
      )
    )?.s || 0
  );

  const hoy = porDia[porDia.length - 1];
  const unidadesHoy = hoy ? hoy.unidades : 0;
  // Posición de la barra "ahora": negativa si hay deuda; si no, las unidades
  // libres de hoy (lo vendido por encima de lo que saldó deuda).
  const pos =
    estado.deudaOut < 0
      ? estado.deudaOut
      : hoy
        ? unidadesHoy - (hoy.deudaInicioDia < 0 ? -hoy.deudaInicioDia : 0)
        : 0;
  const tramosOrd = [...tramos].sort((a, b) => a.orden - b.orden);
  const tramoActual = tramoEn(pos, tramosOrd);
  const idx = tramosOrd.findIndex((t) => t.orden === tramoActual.orden);
  const proximo = tramosOrd[idx + 1] || null;

  const extraHoy = gananciaMarginalDia(hoy, tramosOrd);

  return {
    modeloActivo: true,
    desde: desdeIso,
    hasta: hastaIso,
    total: Math.round(total),
    liquidado: Math.round(liquidado),
    pendiente: Math.round(total - liquidado),
    unidadesHoy,
    deuda: estado.deudaOut < 0 ? -estado.deudaOut : 0,
    esSabadoHoy: diaSemana(hastaIso) === 6,
    extraMarginalHoy: extraHoy > 0 ? extraHoy : null,
    tramoActual: { etiqueta: tramoActual.etiqueta, pct: tramoActual.pct, posicion: pos },
    proximoTramo: proximo
      ? { etiqueta: proximo.etiqueta, pct: proximo.pct, faltanU: Math.max(0, proximo.desde_u - pos) }
      : null,
    tramos: tramosOrd,
    porDia,
  };
}
