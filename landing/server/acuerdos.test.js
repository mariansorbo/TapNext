import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARAMS_DEFAULT, normalizarParams, armarContrato } from './acuerdos-texto.js';

const base = { valorReposicionStand: 30000, valorReposicionMuestra: 8000 };

test('normalizarParams: aplica defaults y exige valores de reposición', () => {
  assert.match(normalizarParams({}).error, /stand/);
  assert.match(normalizarParams({ valorReposicionStand: 1000 }).error, /muestra/);
  const { params } = normalizarParams(base);
  assert.equal(params.precioRendicion, 8000);
  assert.equal(params.anticipo, 50000);
  assert.equal(params.plazoDias, 60);
  assert.equal(params.unidIg + params.unidWpp, 20);
});

test('normalizarParams: sin muestras no pide su reposición; valida números', () => {
  assert.ok(normalizarParams({ valorReposicionStand: 1000, muestras: 0 }).params);
  assert.match(normalizarParams({ ...base, plazoDias: 'abc' }).error, /plazoDias/);
  assert.match(normalizarParams({ ...base, precioRendicion: 0 }).error, /precio/i);
});

test('armarContrato: usa los parámetros y el hash cambia con el texto', () => {
  const a = armarContrato(normalizarParams(base).params, { nombre: 'Kiosco Sur' });
  assert.match(a.texto, /\$8\.000/);
  assert.match(a.texto, /60 días/);
  assert.match(a.texto, /Kiosco Sur/);
  assert.equal(a.resumen.length, 6);
  const b = armarContrato(normalizarParams({ ...base, plazoDias: 45 }).params, { nombre: 'Kiosco Sur' });
  assert.match(b.texto, /45 días/);
  assert.notEqual(a.hash, b.hash);
});

test('armarContrato: la cláusula de anticipo respeta reembolsable sí/no', () => {
  const si = armarContrato(normalizarParams(base).params).texto;
  const no = armarContrato(normalizarParams({ ...base, anticipoReembolsable: false }).params).texto;
  assert.match(si, /NextTap lo devuelve/);
  assert.match(no, /no es reembolsable/);
});

test('defaults: coinciden con lo acordado', () => {
  assert.equal(PARAMS_DEFAULT.precioRendicion, 8000);
  assert.equal(PARAMS_DEFAULT.anticipo, 50000);
  assert.equal(PARAMS_DEFAULT.unidIg, 10);
  assert.equal(PARAMS_DEFAULT.unidWpp, 10);
  assert.equal(PARAMS_DEFAULT.tasaMoraMensual, 2);
});

test('cláusula 11: exclusividad, plazos y penalidad opcional', () => {
  const base2 = { valorReposicionStand: 30000, valorReposicionMuestra: 8000 };
  const a = armarContrato(normalizarParams(base2).params).texto;
  assert.match(a, /11\. Confidencialidad, no copia y exclusividad/);
  assert.match(a, /12 meses después/);
  assert.match(a, /24 meses después/);
  assert.match(a, /tampoco exhibirá ni venderá productos equivalentes/);
  assert.match(a, /indemnizar los daños/);
  assert.doesNotMatch(a, /penalidad de/);
  const b = armarContrato(normalizarParams({ ...base2, penalidad: 500000, exclusividadVenta: false, noCompetenciaMeses: 6 }).params).texto;
  assert.match(b, /penalidad de \$500\.000/);
  assert.match(b, /6 meses después/);
  assert.doesNotMatch(b, /tampoco exhibirá/);
});

import { normalizarWhatsapp, normalizarContacto } from './acuerdos.js';

test('normalizarWhatsapp: formatos argentinos comunes → E.164 sin +', () => {
  for (const raw of ['11 2263-6101', '011 2263 6101', '+54 9 11 2263 6101', '5491122636101', '54 11 2263 6101', '(11) 2263 6101'])
    assert.equal(normalizarWhatsapp(raw), '5491122636101', raw);
  assert.equal(normalizarWhatsapp('+1 415 555 2671'), '14155552671'); // otro país: se respeta
  assert.equal(normalizarWhatsapp('2263 6101'), null); // falta código de área
  assert.equal(normalizarWhatsapp('abc'), null);
});

test('normalizarContacto: arroba = mail, si no WhatsApp', () => {
  assert.deepEqual(normalizarContacto(' Juan@Comercio.com '), { canal: 'email', destino: 'juan@comercio.com' });
  assert.deepEqual(normalizarContacto('11 2263 6101'), { canal: 'whatsapp', destino: '5491122636101' });
  assert.match(normalizarContacto('juan@').error, /mail/);
  assert.match(normalizarContacto('123').error, /WhatsApp/);
});

test('armarContrato: el domicilio electrónico sigue al canal', () => {
  const p = normalizarParams({ valorReposicionStand: 1000, valorReposicionMuestra: 500 }).params;
  assert.match(armarContrato(p, { nombre: 'X', canal: 'whatsapp' }).texto, /número de WhatsApp verificado/);
  assert.match(armarContrato(p, { nombre: 'X' }).texto, /El mail verificado/);
});

test('cláusula 11: con penalidad deja asentado el reconocimiento del daño (y sin penalidad no)', () => {
  const b3 = { valorReposicionStand: 30000, valorReposicionMuestra: 8000 };
  const con = armarContrato(normalizarParams({ ...b3, penalidad: 10000000 }).params);
  assert.match(con.texto, /excede ampliamente el valor del lote/);
  assert.match(con.texto, /estimación razonable de ese perjuicio/);
  assert.equal(con.version, 4);
  assert.doesNotMatch(armarContrato(normalizarParams(b3).params).texto, /excede ampliamente/);
});

import { fechaLarga, sumarDias } from './acuerdos-texto.js';

test('fechas: suma de días y formato en español', () => {
  assert.equal(sumarDias('2026-12-01', 60), '2027-01-30');
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(fechaLarga('2027-01-30'), 'sábado 30 de enero de 2027');
});

test('fechaEntrega: se valida y fija el día de cobro en resumen, cláusula 6 y anexo', () => {
  const b4 = { valorReposicionStand: 30000, valorReposicionMuestra: 8000 };
  assert.match(normalizarParams({ ...b4, fechaEntrega: '2026-02-30' }).error, /fecha de entrega/);
  assert.match(normalizarParams({ ...b4, fechaEntrega: 'mañana' }).error, /fecha de entrega/);
  const c = armarContrato(normalizarParams({ ...b4, fechaEntrega: '2026-12-01' }).params, { nombre: 'X', domicilio: 'Av. Siempreviva 742' });
  assert.match(c.resumen[3], /sábado 30 de enero de 2027/);
  assert.match(c.texto, /el plazo vence el sábado 30 de enero de 2027: ese es el día de cobro/);
  assert.match(c.texto, /pasa por el local del Comercio \(Av\. Siempreviva 742\)/);
  assert.match(c.texto, /Día de cobro: sábado 30 de enero de 2027/);
  assert.equal(c.resumen.length, 6);
});

test('sin fechaEntrega: el día de cobro queda atado a la constancia de recepción', () => {
  const c = armarContrato(normalizarParams({ valorReposicionStand: 1, valorReposicionMuestra: 1 }).params, { nombre: 'X' });
  assert.match(c.resumen[3], /constancia de recepción/);
  assert.match(c.texto, /Día de cobro: entrega \+ 60 días/);
  assert.match(c.texto, /La mora es automática/);
  assert.match(c.texto, /13\. Disposiciones generales/);
  assert.match(c.texto, /14\. Jurisdicción/);
  assert.equal(c.version, 4);
});

import { unidadesTotales } from './acuerdos-texto.js';

test('lote con tres tipos: instagram, whatsapp y datos de transferencia', () => {
  const base5 = { valorReposicionStand: 30000, valorReposicionMuestra: 8000 };
  const { params } = normalizarParams({ ...base5, unidIg: 6, unidWpp: 5, unidAlias: 4 });
  assert.equal(unidadesTotales(params), 15);
  const c = armarContrato(params, { nombre: 'X' });
  assert.match(c.texto, /6 de Instagram, 5 de WhatsApp y 4 de Datos de transferencia/);
  assert.match(c.resumen[0], /Recibís 15 llaveros/);
  assert.match(c.texto, /valor máximo del lote al precio de rendición: \$120\.000/);
  // sin alias el texto queda como antes
  assert.match(armarContrato(normalizarParams(base5).params, { nombre: 'X' }).texto, /10 de Instagram y 10 de WhatsApp\)/);
  // acuerdos viejos (params congelados sin unidAlias) siguen funcionando
  assert.equal(unidadesTotales({ unidIg: 10, unidWpp: 10 }), 20);
  // solo alias también es un lote válido; vacío no
  assert.ok(normalizarParams({ ...base5, unidIg: 0, unidWpp: 0, unidAlias: 3 }).params);
  assert.match(normalizarParams({ ...base5, unidIg: 0, unidWpp: 0 }).error, /al menos una unidad/);
});
