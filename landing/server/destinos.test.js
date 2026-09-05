import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarDestino, resolverDestino, aUrlAbsoluta } from './destinos/index.js';

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

test('whatsapp: AR -> wa.me con 54 sin el 9 (el 9 hace que la app abra sin chat)', () => {
  assert.equal(normalizarDestino('whatsapp', '11 2233 4455').valor, 'https://wa.me/541122334455');
  assert.equal(normalizarDestino('whatsapp', '+54 9 11 2233 4455').valor, 'https://wa.me/541122334455');
  assert.equal(normalizarDestino('whatsapp', '+54 11 2233 4455').valor, 'https://wa.me/541122334455');
  assert.equal(normalizarDestino('whatsapp', 'wa.me/5491122334455').valor, 'https://wa.me/541122334455');
  assert.ok(normalizarDestino('whatsapp', '123').error);
});

test('whatsapp: saca 0 nacional y 15 viejo', () => {
  assert.equal(normalizarDestino('whatsapp', '011 15 2233 4455').valor, 'https://wa.me/541122334455');
  assert.equal(normalizarDestino('whatsapp', '9 11 2233 4455').valor, 'https://wa.me/541122334455');
  // Link wa.me ya formado (con o sin 9) se normaliza igual.
  assert.equal(normalizarDestino('whatsapp', 'https://wa.me/541122334455?text=hola').valor, 'https://wa.me/541122334455');
});

test('web/pago: agrega https:// si falta y valida el dominio', () => {
  assert.equal(normalizarDestino('web', 'tunegocio.com').valor, 'https://tunegocio.com/');
  assert.equal(normalizarDestino('pago', 'https://link.mercadopago.com.ar/x').valor, 'https://link.mercadopago.com.ar/x');
  assert.ok(normalizarDestino('web', 'no-es-un-dominio').error);
});

test('resolverDestino: siempre da un redirect a URL absoluta', () => {
  assert.deepEqual(resolverDestino('whatsapp', 'https://wa.me/541122334455'), {
    modo: 'redirect',
    url: 'https://wa.me/541122334455',
  });
  // Fila vieja guardada sin esquema -> el resolver la fuerza a absoluta.
  assert.equal(resolverDestino('instagram', 'instagram.com/x').url, 'https://instagram.com/x');
  assert.equal(resolverDestino('web', 'tunegocio.com/menu').url, 'https://tunegocio.com/menu');
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
