import { test } from 'node:test';
import assert from 'node:assert/strict';
import { efemerideDe } from './efemerides.js';

// Mediodía en Argentina (UTC-3) de una fecha civil.
const dia = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 15));

test('fechas fijas', () => {
  assert.match(efemerideDe(dia(2026, 5, 25)).texto, /Revolución de Mayo/);
  assert.match(efemerideDe(dia(2026, 7, 9)).texto, /Independencia/);
  assert.match(efemerideDe(dia(2026, 10, 31)).texto, /Halloween/);
});

test('día común → null', () => {
  assert.equal(efemerideDe(dia(2026, 10, 30)), null);
});

test('móviles: madre, padre, infancias, black friday', () => {
  assert.match(efemerideDe(dia(2026, 10, 18)).texto, /Madre/); // 3.er domingo
  assert.equal(efemerideDe(dia(2026, 10, 11)), null);
  assert.match(efemerideDe(dia(2026, 6, 21)).texto, /Padre/);
  assert.match(efemerideDe(dia(2026, 8, 16)).texto, /Infancias/);
  assert.match(efemerideDe(dia(2026, 11, 27)).texto, /Black Friday/);
});

test('Pascua y Carnaval 2026 (Pascua = 5 de abril)', () => {
  assert.match(efemerideDe(dia(2026, 4, 5)).texto, /Pascuas/);
  assert.match(efemerideDe(dia(2026, 4, 3)).texto, /Viernes Santo/);
  assert.match(efemerideDe(dia(2026, 2, 16)).texto, /Carnaval/);
  assert.match(efemerideDe(dia(2026, 2, 17)).texto, /Carnaval/);
});

test('usa la hora de Argentina, no UTC', () => {
  // 25/5 02:00 UTC = 24/5 23:00 en Argentina → todavía no es 25 de Mayo
  assert.equal(efemerideDe(new Date(Date.UTC(2026, 4, 25, 2))), null);
  // 26/5 01:00 UTC = 25/5 22:00 en Argentina → todavía es 25 de Mayo
  assert.match(efemerideDe(new Date(Date.UTC(2026, 4, 26, 1))).texto, /Mayo/);
});
