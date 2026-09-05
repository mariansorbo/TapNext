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

test('whatsapp: número local AR de 10 dígitos -> wa.me con 549', () => {
  assert.equal(normalizarDestino('whatsapp', '11 2233 4455').valor, 'https://wa.me/5491122334455');
  assert.equal(normalizarDestino('whatsapp', '+54 9 11 2233 4455').valor, 'https://wa.me/5491122334455');
  assert.equal(normalizarDestino('whatsapp', 'wa.me/5491122334455').valor, 'https://wa.me/5491122334455');
  assert.ok(normalizarDestino('whatsapp', '123').error);
});

test('whatsapp: mete el 9 que falta y saca 0 / 15 (era el "solo abre la app")', () => {
  // Número con país pero SIN el 9 de celular -> antes quedaba wa.me/541122334455
  // y WhatsApp abría la app sin conversación.
  assert.equal(normalizarDestino('whatsapp', '+54 11 2233 4455').valor, 'https://wa.me/5491122334455');
  assert.equal(normalizarDestino('whatsapp', '541122334455').valor, 'https://wa.me/5491122334455');
  // Formato viejo con 0 y 15.
  assert.equal(normalizarDestino('whatsapp', '011 15 2233 4455').valor, 'https://wa.me/5491122334455');
  // Link wa.me ya bien formado no se rompe.
  assert.equal(normalizarDestino('whatsapp', 'https://wa.me/5491122334455?text=hola').valor, 'https://wa.me/5491122334455');
});

test('web/pago: agrega https:// si falta y valida el dominio', () => {
  assert.equal(normalizarDestino('web', 'tunegocio.com').valor, 'https://tunegocio.com/');
  assert.equal(normalizarDestino('pago', 'https://link.mercadopago.com.ar/x').valor, 'https://link.mercadopago.com.ar/x');
  assert.ok(normalizarDestino('web', 'no-es-un-dominio').error);
});

test('resolverDestino: siempre da un redirect a URL absoluta', () => {
  assert.deepEqual(resolverDestino('whatsapp', 'https://wa.me/5491122334455'), {
    modo: 'redirect',
    url: 'https://wa.me/5491122334455',
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
