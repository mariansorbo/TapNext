// Tests del núcleo del motor de comisión (modelo: % de la venta por tramo).
// Correr con:  npm test   (node --test, no necesita DB).

import test from 'node:test';
import assert from 'node:assert/strict';
import { simularPeriodo, simularDia, gananciaMarginalDia, tramoEn, fechaAR } from './comision-core.js';

const TRAMOS = [
  { orden: 1, etiqueta: '-2', desde_u: -10, hasta_u: -5, pct: 30 },
  { orden: 2, etiqueta: '-1', desde_u: -5, hasta_u: 0, pct: 40 },
  { orden: 3, etiqueta: 'Base', desde_u: 0, hasta_u: 20, pct: 50 },
  { orden: 4, etiqueta: '2', desde_u: 20, hasta_u: 30, pct: 60 },
  { orden: 5, etiqueta: '3', desde_u: 30, hasta_u: 40, pct: 70 },
  { orden: 6, etiqueta: '4', desde_u: 40, hasta_u: 999, pct: 80 },
];
const PARAMS = { bonoFinde: 0.1, deuda1d: 5, deuda2d: 10, deuda3d: 15 };
const dia = (over) => ({ esFinde: false, esSabado: false, justificada: false, items: [], ...over });
const N = (n, monto = 20000) => Array.from({ length: n }, () => monto);

test('escala marginal por %: 25 ventas de $20.000', () => {
  // 20 a 50% ($10k) + 5 a 60% ($12k) = 200.000 + 60.000
  const { total } = simularPeriodo([dia({ items: N(25) })], TRAMOS, PARAMS);
  assert.equal(Math.round(total), 260_000);
});

test('el % es igual para cualquier precio de modelo', () => {
  // 10 ventas: 5 de $10.000 + 5 de $30.000, todas en Base (50%)
  const items = [...N(5, 10000), ...N(5, 30000)];
  const { total } = simularPeriodo([dia({ items })], TRAMOS, PARAMS);
  assert.equal(Math.round(total), 0.5 * (5 * 10000 + 5 * 30000)); // 100.000
});

test('deuda: falta 1 día, vuelve y recupera al 40%', () => {
  const dias = [dia({ items: [] }), dia({ items: N(8) })];
  const { total, estado } = simularPeriodo(dias, TRAMOS, PARAMS);
  // arranca en -5: 5 ventas a 40% ($8k) + 3 a 50% ($10k) = 40.000 + 30.000
  assert.equal(Math.round(total), 70_000);
  assert.equal(estado.deudaOut, 0);
});

test('sábado: +10% sobre la comisión del día', () => {
  const { total } = simularPeriodo([dia({ esFinde: true, esSabado: true, items: N(10) })], TRAMOS, PARAMS);
  assert.equal(Math.round(total), Math.round(10 * 20000 * 0.5 * 1.1)); // 110.000
});

test('día en curso sin ventas no genera falta', () => {
  const dias = [dia({ items: N(12) }), dia({ items: [], enCurso: true })];
  const { estado } = simularPeriodo(dias, TRAMOS, PARAMS);
  assert.equal(estado.deudaOut, 0);
  assert.equal(estado.rachaOut, 0);
});

test('día justificado: no suma, no es falta', () => {
  const dias = [dia({ items: [], justificada: true }), dia({ items: N(10) })];
  const { total, estado } = simularPeriodo(dias, TRAMOS, PARAMS);
  assert.equal(estado.deudaOut, 0);
  assert.equal(Math.round(total), 100_000);
});

test('ganancia marginal del día: solo el lado positivo', () => {
  const r = simularDia(null, dia({ items: N(25) }), TRAMOS, PARAMS);
  // 5 ventas a +10 puntos sobre Base × $20.000 = 10.000
  assert.equal(gananciaMarginalDia(r, TRAMOS), 10_000);
  // sin ventas por encima de Base → 0
  const r2 = simularDia(null, dia({ items: N(10) }), TRAMOS, PARAMS);
  assert.equal(gananciaMarginalDia(r2, TRAMOS), 0);
});

test('la jornada arranca 6 AM ART: una venta de madrugada cuenta al día anterior', () => {
  // 2026-09-03 02:00 ART = 2026-09-03 05:00Z → jornada del 2026-09-02
  assert.equal(fechaAR('2026-09-03T05:00:00Z'), '2026-09-02');
  // 2026-09-03 10:00 ART = 2026-09-03 13:00Z → jornada del 2026-09-03
  assert.equal(fechaAR('2026-09-03T13:00:00Z'), '2026-09-03');
});

test('tramoEn ubica la posición', () => {
  assert.equal(tramoEn(0, TRAMOS).etiqueta, 'Base');
  assert.equal(tramoEn(25, TRAMOS).etiqueta, '2');
  assert.equal(tramoEn(-3, TRAMOS).etiqueta, '-1');
});
