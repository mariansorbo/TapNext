// Texto del acuerdo con minoristas (consignación de llaveros + kit exhibidor en
// comodato + anticipo a cuenta). Función pura: dado un set de parámetros y los
// datos del comercio devuelve el texto exacto que se firma.
//
// Los parámetros se congelan en la fila del acuerdo cuando el admin genera el
// link (acuerdos.params_json); cambiar los DEFAULTS después NO toca acuerdos ya
// creados. Si cambia el texto de las cláusulas, subir ACUERDO_TEXTO_VERSION: la
// firma guarda la versión, el texto completo renderizado y su hash.

import { createHash } from 'node:crypto';

// v2: cláusula 11 (confidencialidad, no copia y exclusividad).
// v3: con penalidad, la cláusula 11 deja asentado el reconocimiento del daño.
export const ACUERDO_TEXTO_VERSION = 3;

// Valores por defecto — todo lo que el admin puede cambiar por comercio.
// Los valores de reposición no tienen default a propósito (no hay dato): el
// admin tiene que cargarlos antes de generar el link.
export const PARAMS_DEFAULT = {
  precioRendicion: 8000,
  precioSugeridoDesde: 20000,
  precioSugeridoHasta: 25000,
  plazoDias: 60,
  unidIg: 10,
  unidWpp: 10,
  muestras: 3,
  muestrasDetalle: '',
  anticipo: 50000,
  anticipoReembolsable: true,
  tasaMoraMensual: 2,
  diasReclamoFabrica: 7,
  preavisoDias: 15,
  valorReposicionStand: null,
  valorReposicionMuestra: null,
  jurisdiccion: 'CABA',
  confidencialidadMeses: 24,
  noCompetenciaMeses: 12,
  penalidad: null, // monto fijo opcional; sin dato no se menciona
  exclusividadVenta: true,
};

const NUM = ['precioRendicion', 'precioSugeridoDesde', 'precioSugeridoHasta', 'plazoDias', 'unidIg', 'unidWpp',
  'muestras', 'anticipo', 'tasaMoraMensual', 'diasReclamoFabrica', 'preavisoDias', 'valorReposicionStand',
  'valorReposicionMuestra', 'confidencialidadMeses', 'noCompetenciaMeses', 'penalidad'];

// Mezcla lo que mandó el admin con los defaults y valida. Devuelve { params } o { error }.
export function normalizarParams(entrada = {}) {
  const p = { ...PARAMS_DEFAULT };
  for (const k of Object.keys(PARAMS_DEFAULT)) {
    if (entrada[k] === undefined || entrada[k] === null || entrada[k] === '') continue;
    p[k] = entrada[k];
  }
  for (const k of NUM) {
    if (p[k] === null) continue;
    const n = Number(p[k]);
    if (!Number.isFinite(n) || n < 0) return { error: `El valor de "${k}" no es un número válido.` };
    p[k] = n;
  }
  p.anticipoReembolsable = p.anticipoReembolsable === true || p.anticipoReembolsable === 'true' || p.anticipoReembolsable === 1;
  p.exclusividadVenta = !(p.exclusividadVenta === false || p.exclusividadVenta === 'false' || p.exclusividadVenta === 0);
  if (p.penalidad === 0) p.penalidad = null;
  p.muestrasDetalle = String(p.muestrasDetalle || '').trim().slice(0, 300);
  p.jurisdiccion = String(p.jurisdiccion || '').trim().slice(0, 80) || PARAMS_DEFAULT.jurisdiccion;
  if (!(p.precioRendicion > 0)) return { error: 'El precio de rendición tiene que ser mayor a 0.' };
  if (!(p.plazoDias >= 1)) return { error: 'El plazo de rendición tiene que ser de al menos 1 día.' };
  if (p.unidIg + p.unidWpp < 1) return { error: 'El lote tiene que tener al menos una unidad.' };
  if (p.valorReposicionStand === null || !(p.valorReposicionStand > 0))
    return { error: 'Cargá el valor de reposición del stand.' };
  if (p.muestras > 0 && (p.valorReposicionMuestra === null || !(p.valorReposicionMuestra > 0)))
    return { error: 'Cargá el valor de reposición de cada muestra.' };
  return { params: p };
}

export const pesos = (n) => `$${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

const unidadesTotales = (p) => p.unidIg + p.unidWpp;

// Texto completo. `comercio`: { nombre, documento, domicilio, local } (los dos
// últimos pueden venir vacíos en la vista previa, antes de que los complete).
export function armarContrato(params, comercio = {}) {
  const p = params;
  const total = unidadesTotales(p);
  const maxLote = total * p.precioRendicion;
  const detalleLote = [
    p.unidIg ? `${p.unidIg} de Instagram` : null,
    p.unidWpp ? `${p.unidWpp} de WhatsApp` : null,
  ].filter(Boolean).join(' y ');
  const muestras = p.muestras > 0
    ? `${p.muestras} llaveros de muestra${p.muestrasDetalle ? ` (${p.muestrasDetalle})` : ''}`
    : 'sin llaveros de muestra';
  const medio = comercio.canal === 'whatsapp' ? 'El número de WhatsApp verificado' : 'El mail verificado';
  const quien = comercio.nombre
    ? `${comercio.nombre}${comercio.documento ? `, DNI/CUIT ${comercio.documento}` : ''}${comercio.domicilio ? `, con domicilio en ${comercio.domicilio}` : ''}`
    : '[nombre, DNI/CUIT y domicilio del Comercio]';

  const resumen = [
    `Recibís ${total} llaveros en consignación (${detalleLote}), un stand exhibidor y ${muestras}.`,
    `Por cada llavero que vendas le debés a NextTap ${pesos(p.precioRendicion)}. El precio al público lo ponés vos (sugerido ${pesos(p.precioSugeridoDesde)} a ${pesos(p.precioSugeridoHasta)}).`,
    `Pagás un anticipo de ${pesos(p.anticipo)} ahora; se descuenta de lo que debas al rendir.`,
    `Tenés ${p.plazoDias} días desde la entrega para rendir: pagás lo vendido y devolvés lo no vendido y el kit.`,
    `Los llaveros que no devuelvas, devuelvas activados o devuelvas dañados se pagan como vendidos (${pesos(p.precioRendicion)} c/u).`,
    `NextTap es un desarrollo propio: no podés copiarlo ni desarrollar o participar en un producto equivalente durante el acuerdo y ${p.noCompetenciaMeses} meses después (cláusula 11).`,
  ];

  const clausulas = [
    {
      titulo: '1. Partes y notificaciones',
      texto: `NextTap, representada por su titular, y ${quien} (en adelante, "el Comercio"). ${medio} por el Comercio al firmar es su domicilio electrónico: todas las notificaciones se consideran válidas enviadas allí.`,
    },
    {
      titulo: '2. Objeto',
      texto: `NextTap entrega al Comercio, según el Anexo, un lote de llaveros NFC en consignación y un kit exhibidor en comodato. El Comercio actúa por cuenta propia e independiente: no hay relación laboral ni sociedad entre las partes. La exclusividad se rige por la cláusula 11.`,
    },
    {
      titulo: '3. Anticipo a cuenta',
      texto: `El Comercio paga ${pesos(p.anticipo)} como anticipo a cuenta de lo que deba por llaveros vendidos. El acuerdo entra en vigencia y se entrega el lote cuando el pago se acredita. En cada rendición el anticipo se descuenta de lo adeudado. ${
        p.anticipoReembolsable
          ? 'Si al terminar la relación queda saldo a favor del Comercio, NextTap lo devuelve, previo descuento de cualquier monto que el Comercio deba (llaveros no devueltos, kit, intereses).'
          : 'El anticipo no es reembolsable: si al terminar la relación queda saldo a favor, NextTap lo conserva como compensación por la reserva del lote.'
      }`,
    },
    {
      titulo: '4. Llaveros en consignación',
      texto: `El lote es de ${total} llaveros (${detalleLote}). Siguen siendo propiedad de NextTap hasta que el Comercio los vende a un cliente final. El Comercio fija libremente el precio de venta; NextTap solo sugiere entre ${pesos(p.precioSugeridoDesde)} y ${pesos(p.precioSugeridoHasta)}. Por cada llavero vendido el Comercio debe a NextTap ${pesos(p.precioRendicion)}. El Comercio no puede prestar, regalar, empeñar ni vender los llaveros a otros comercios o revendedores. Al recibirlos, el Comercio reconoce que están completos, nuevos, sin activar y en perfecto estado, y responde por su robo, pérdida o rotura desde la entrega.`,
    },
    {
      titulo: '5. Llaveros que se consideran vendidos',
      texto: `Al rendir se consideran vendidos, y se deben a ${pesos(p.precioRendicion)} cada uno, todos los llaveros que (a) no se devuelvan, (b) se devuelvan con el chip activado o desbloqueado, o (c) se devuelvan dañados, rotos o con defectos.${
        p.diasReclamoFabrica > 0
          ? ` Queda exceptuado el defecto de fábrica comunicado a NextTap dentro de los ${p.diasReclamoFabrica} días de la entrega: en ese caso NextTap cambia la unidad.`
          : ''
      }`,
    },
    {
      titulo: '6. Rendición',
      texto: `El plazo de rendición es de ${p.plazoDias} días corridos desde la entrega. Al vencerlo, el Comercio paga lo vendido (menos el anticipo) y devuelve lo no vendido. Puede pagar antes o en partes. Para recibir un nuevo lote debe haber rendido el anterior. El pago es por transferencia o Mercado Pago a las cuentas que indique NextTap. Desde el día siguiente al vencimiento corre sobre el saldo impago un interés simple de ${p.tasaMoraMensual}% mensual.`,
    },
    {
      titulo: '7. Control de activación',
      texto: `NextTap puede mantener bloqueados los chips hasta su venta o pago, y desactivar los de llaveros no rendidos una vez vencido el plazo.`,
    },
    {
      titulo: '8. Kit exhibidor (comodato gratuito)',
      texto: `El kit incluye un stand exhibidor (valor de reposición ${pesos(p.valorReposicionStand)}) y ${muestras}${p.muestras > 0 ? ` (valor de reposición ${pesos(p.valorReposicionMuestra)} cada una)` : ''}. Es propiedad de NextTap y se presta sin costo. El Comercio lo usa solo para exhibir en su local y lo devuelve completo y en las mismas condiciones, salvo el desgaste normal por uso. Si no lo devuelve, o lo devuelve roto o incompleto, paga el valor de reposición de lo faltante o dañado, que NextTap puede descontar del anticipo. Las muestras son de exhibición: no se venden ni se activan.`,
    },
    {
      titulo: '9. Marca y postventa',
      texto: `El Comercio puede usar la marca NextTap solo para exhibir y vender. No puede modificar el producto ni prometer funciones que no tiene. Los reclamos de postventa los atiende NextTap por el canal que informe.`,
    },
    {
      titulo: '10. Datos personales',
      texto: `El Comercio consiente que NextTap trate sus datos solo para gestionar este acuerdo, según la política de privacidad vigente (Ley 25.326).`,
    },
    {
      titulo: '11. Confidencialidad, no copia y exclusividad',
      texto: `a) El Comercio reconoce que el producto NextTap (llaveros NFC cuyo destino se configura desde la plataforma, su diseño, el stand exhibidor, la marca y el software) es un desarrollo propio de NextTap. Por eso se obliga a no desarrollar, fabricar ni hacer fabricar, ni participar en el desarrollo, la fabricación o la comercialización de un producto igual o equivalente (llaveros, tarjetas u objetos con tecnología NFC que abran un destino configurable), por sí o por interpósita persona, ya sea solo, en sociedad o como colaborador de un tercero, durante la vigencia del acuerdo y ${p.noCompetenciaMeses} meses después de su terminación.${
        p.exclusividadVenta
          ? ' Durante la vigencia, el Comercio tampoco exhibirá ni venderá productos equivalentes de otras marcas junto con los de NextTap.'
          : ''
      } b) El Comercio mantendrá en reserva la información que reciba de NextTap (proveedores, costos, precios de rendición, diseños, funcionamiento de la plataforma y toda información no pública) durante la vigencia y ${p.confidencialidadMeses} meses después. c) El Comercio no copiará ni hará copiar el diseño del stand, de los llaveros o de sus pantallas, ni los desarmará ni analizará para replicarlos. d) El Comercio declara que entiende el alcance de esta cláusula y que la acepta como condición para recibir el kit y los llaveros.${
        p.penalidad
          ? ` e) Si incumple esta cláusula, el Comercio abona a NextTap una penalidad de ${pesos(p.penalidad)}, sin perjuicio de reclamar mayores daños y de pedir que cese la conducta. El Comercio reconoce que el perjuicio que le causaría a NextTap la copia o la competencia con su producto (pérdida de mercado, de inversión en desarrollo y de diferenciación) excede ampliamente el valor del lote y del kit entregados, y que esa penalidad es una estimación razonable de ese perjuicio y no una sanción desproporcionada.`
          : ' e) El incumplimiento de esta cláusula obliga al Comercio a indemnizar los daños causados y habilita a NextTap a pedir que cese la conducta.'
      } Si algún tribunal considerara excesivo el alcance de alguna parte de esta cláusula, se aplica en la medida máxima que ese tribunal admita y el resto sigue vigente.`,
    },
    {
      titulo: '12. Vigencia y terminación',
      texto: `El acuerdo es por tiempo indeterminado. Cualquiera de las partes puede terminarlo con ${p.preavisoDias} días de aviso. Ante un incumplimiento, NextTap puede exigir la devolución inmediata del kit y de los llaveros no vendidos.`,
    },
    {
      titulo: '13. Jurisdicción',
      texto: `Rige la ley argentina. Las partes intentarán una mediación previa y, de no resolverse, se someten a los tribunales ordinarios de ${p.jurisdiccion}.`,
    },
    {
      titulo: 'Anexo — Lote y kit',
      texto: `Llaveros en consignación: ${total} (${detalleLote}); valor máximo del lote al precio de rendición: ${pesos(maxLote)}. Kit: 1 stand exhibidor, ${muestras}. Anticipo: ${pesos(p.anticipo)}. Plazo de rendición: ${p.plazoDias} días desde la entrega. La recepción física se confirma con el código de retiro al momento de la entrega.`,
    },
  ];

  const texto = [`ACUERDO DE CONSIGNACIÓN Y COMODATO — NextTap (v${ACUERDO_TEXTO_VERSION})`, '']
    .concat(clausulas.flatMap((c) => [c.titulo, c.texto, '']))
    .join('\n')
    .trim();
  return { version: ACUERDO_TEXTO_VERSION, resumen, clausulas, texto, hash: hashTexto(texto) };
}

export const hashTexto = (texto) => createHash('sha256').update(texto).digest('hex');
