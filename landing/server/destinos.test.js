import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarDestino, aUrlAbsoluta } from './destinos.js';

test('instagram: acepta handle pelado, @handle y URL de perfil', () => {
  assert.equal(normalizarDestino('instagram', 'tunegocio').valor, 'https://instagram.com/tunegocio');
  assert.equal(normalizarDestino('instagram', '@tunegocio').valor, 'https://instagram.com/tunegocio');
  assert.equal(normalizarDestino('instagram', 'instagram.com/tunegocio').valor, 'https://instagram.com/tunegocio');
  assert.equal(
    normalizarDestino('instagram', 'https://www.instagram.com/tunegocio/').valor,
    'https://instagram.com/tunegocio'
  );
});

test('instagram: "instagram.com" sin usuario es error (era el bug)', () => {
  assert.ok(normalizarDestino('instagram', 'instagram.com').error);
});

test('whatsapp: número local AR de 10 dígitos -> wa.me con 549', () => {
  assert.equal(normalizarDestino('whatsapp', '11 2233 4455').valor, 'https://wa.me/5491122334455');
  assert.equal(normalizarDestino('whatsapp', '+54 9 11 2233 4455').valor, 'https://wa.me/5491122334455');
  assert.equal(normalizarDestino('whatsapp', 'wa.me/5491122334455').valor, 'https://wa.me/5491122334455');
  assert.ok(normalizarDestino('whatsapp', '123').error);
});

test('web/pago: agrega https:// si falta y valida el dominio', () => {
  assert.equal(normalizarDestino('web', 'tunegocio.com').valor, 'https://tunegocio.com/');
  assert.equal(normalizarDestino('pago', 'https://link.mercadopago.com.ar/x').valor, 'https://link.mercadopago.com.ar/x');
  assert.ok(normalizarDestino('web', 'no-es-un-dominio').error);
});

test('aUrlAbsoluta: no toca URLs ya absolutas, completa las relativas', () => {
  assert.equal(aUrlAbsoluta('https://instagram.com/x'), 'https://instagram.com/x');
  assert.equal(aUrlAbsoluta('instagram.com/x'), 'https://instagram.com/x');
  assert.equal(aUrlAbsoluta(''), null);
});

test('tipo inválido / valor vacío', () => {
  assert.ok(normalizarDestino('no-existe', 'x').error);
  assert.ok(normalizarDestino('instagram', '   ').error);
});
