import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarPurchase, esGaClientId, esGaSessionId } from './ga4.js';

test('agrupa unidades iguales y suma envío', () => {
  const body = armarPurchase({
    transactionId: 42,
    value: 25500,
    shipping: 8500,
    items: [
      { modelo: 'llavero', destinoTipo: 'whatsapp', precio: 8500 },
      { modelo: 'llavero', destinoTipo: 'whatsapp', precio: 8500 },
    ],
    clientId: '468694491.1792372955',
    sessionId: '1792372954',
  });
  assert.equal(body.client_id, '468694491.1792372955');
  const p = body.events[0].params;
  assert.equal(body.events[0].name, 'purchase');
  assert.equal(p.transaction_id, '42');
  assert.equal(p.session_id, '1792372954');
  assert.equal(p.shipping, 8500);
  assert.deepEqual(p.items, [
    { item_id: 'llavero__whatsapp', item_name: 'llavero · whatsapp', item_category: 'llavero', item_variant: 'whatsapp', price: 8500, quantity: 2 },
  ]);
});

test('precios distintos (promo) quedan como ítems separados', () => {
  const p = armarPurchase({
    transactionId: 1,
    value: 13000,
    items: [
      { modelo: 'llavero', destinoTipo: 'instagram', precio: 8500 },
      { modelo: 'llavero', destinoTipo: 'instagram', precio: 4500 },
    ],
  }).events[0].params;
  assert.equal(p.items.length, 2);
});

test('sin ids de GA usa un client_id propio y no manda session_id', () => {
  const body = armarPurchase({ transactionId: 7, value: 8500, items: [] });
  assert.equal(body.client_id, 'nt.7');
  assert.equal('session_id' in body.events[0].params, false);
});

test('valida los ids que manda el front', () => {
  assert.ok(esGaClientId('468694491.1792372955'));
  assert.ok(!esGaClientId('GA1.1.468694491.1792372955'));
  assert.ok(!esGaClientId(null));
  assert.ok(esGaSessionId('1792372954'));
  assert.ok(!esGaSessionId('abc'));
});
