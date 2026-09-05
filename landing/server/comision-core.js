// Núcleo puro del motor de comisión variable — sin acceso a DB, testeable solo.
// La capa que junta datos reales vive en comision.js.
//
// Modelo: cada venta paga un % de su valor. El % depende del TRAMO en el que
// cae esa unidad según cuántas unidades vendió el vendedor ese día (escala
// marginal, tipo tramos de impuesto). Faltar manda la barra a negativo: las
// unidades de recuperación pagan el % (más bajo) de los tramos de deuda.

const TZ = 'America/Argentina/Buenos_Aires';
const FMT_AR = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// La jornada de venta arranca y termina a las 6 AM (hora Argentina): una venta a
// las 2 AM del martes cuenta para la jornada del lunes.
const JORNADA_INICIO_HORA = 6;

// 'YYYY-MM-DD' de la JORNADA a la que pertenece un Date / timestamp.
export function fechaAR(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return FMT_AR.format(new Date(dt.getTime() - JORNADA_INICIO_HORA * 3_600_000));
}

// Día de la semana (0 = domingo .. 6 = sábado) de un 'YYYY-MM-DD' civil.
export function diaSemana(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Lista de 'YYYY-MM-DD' entre desde y hasta, inclusive.
export function rangoDias(desdeIso, hastaIso) {
  const out = [];
  const [y, m, d] = desdeIso.split('-').map(Number);
  const [hy, hm, hd] = hastaIso.split('-').map(Number);
  const cur = Date.UTC(y, m - 1, d);
  const end = Date.UTC(hy, hm - 1, hd);
  for (let t = cur; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// Tramo que cubre la posición `pos` de la barra (unidad n° `pos+1` del día, o
// la deuda si `pos` es negativo). `tramos` no necesita venir ordenado.
export function tramoEn(pos, tramos) {
  const ord = [...tramos].sort((a, b) => a.orden - b.orden);
  for (const t of ord) {
    if (pos >= t.desde_u && pos < t.hasta_u) return t;
  }
  return pos < ord[0].desde_u ? ord[0] : ord[ord.length - 1];
}

// Un día. `prev` = resultado del día anterior del mismo vendedor (o null).
// `dia` = { esFinde, esSabado, items:[montoVenta...], justificada, enCurso }.
// `params` = { bonoFinde, deuda1d, deuda2d, deuda3d }.
export function simularDia(prev, dia, tramos, params) {
  const { esFinde, esSabado, justificada, enCurso } = dia;
  const items = dia.items || [];
  const unidades = items.length;
  const rachaIn = prev ? prev.rachaOut : 0;
  const deudaIn = prev ? prev.deudaOut : 0;

  // El día en curso todavía no terminó: no cuenta como falta si aún no vendió.
  if (enCurso && unidades === 0) {
    return neutro(rachaIn, deudaIn);
  }
  if (justificada) {
    // Día hábil con aviso: no suma, no es falta, no mueve racha ni deuda.
    return neutro(rachaIn, deudaIn);
  }

  const falta = !esFinde && unidades === 0;
  const rachaOut = esFinde ? rachaIn : unidades > 0 ? 0 : rachaIn + 1;

  const deudaUnidades = falta
    ? rachaOut >= 3
      ? params.deuda3d
      : rachaOut === 2
        ? params.deuda2d
        : params.deuda1d
    : 0;
  const objetivo = falta ? -deudaUnidades : 0;
  // k = dónde arranca la barra hoy (<= 0). Una falta nueva la profundiza.
  const k = falta ? Math.min(deudaIn, objetivo) : deudaIn;

  // Cada venta, en orden, paga el % del tramo de la posición donde cae.
  let comisionDia = 0;
  let pos = k;
  const detalle = [];
  for (const monto of items) {
    const t = tramoEn(pos, tramos);
    const linea = (Number(monto) || 0) * (t.pct / 100);
    comisionDia += linea;
    detalle.push({ monto: Number(monto) || 0, pos, pct: t.pct, comision: linea });
    pos += 1;
  }
  const deudaOut = Math.min(0, k + unidades);
  if (esSabado && unidades > 0) comisionDia *= 1 + params.bonoFinde;

  return {
    rachaOut,
    deudaOut,
    comisionDia,
    unidades,
    falta,
    justificada: false,
    deudaInicioDia: k,
    detalle,
  };
}

function neutro(rachaIn, deudaIn) {
  return {
    rachaOut: rachaIn,
    deudaOut: deudaIn,
    comisionDia: 0,
    unidades: 0,
    falta: false,
    justificada: true,
    deudaInicioDia: deudaIn,
    detalle: [],
  };
}

// Ganancia marginal de un día: cuánto MÁS se ganó por saturar tramos por encima
// de la Base, vs cobrar todo al % de la Base. Solo el lado positivo (las
// pérdidas por deuda no cuentan). 0 si no hay.
export function gananciaMarginalDia(dia, tramos) {
  const base = [...tramos].find((t) => t.etiqueta === 'Base');
  if (!base || !dia || !dia.detalle) return 0;
  let extra = 0;
  for (const l of dia.detalle) {
    if (l.pct > base.pct) extra += l.monto * ((l.pct - base.pct) / 100);
  }
  return Math.round(extra);
}

export function simularPeriodo(dias, tramos, params) {
  const tramosOrd = [...tramos].sort((a, b) => a.orden - b.orden);
  const porDia = [];
  let prev = null;
  let total = 0;
  for (const dia of dias) {
    const r = simularDia(prev, dia, tramosOrd, params);
    total += r.comisionDia;
    porDia.push({ fecha: dia.fecha, ...r });
    prev = r;
  }
  return { porDia, total, estado: prev || { rachaOut: 0, deudaOut: 0, deudaInicioDia: 0 } };
}
