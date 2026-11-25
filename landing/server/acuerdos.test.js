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
