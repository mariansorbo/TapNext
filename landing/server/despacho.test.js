import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entregarUnidad } from './despacho.js';

// Store en memoria mínimo para ejercitar entregarUnidad (el núcleo compartido
// por el endpoint y el replay de la outbox offline).
function makeStore() {
  const store = {
    ventas: new Map(),
    items: [],
    stickers: new Map(),
    eventos: [],
    destinos: [],
  };

  const deps = {
    async get(sql, args) {
      if (/FROM ventas WHERE id = \?/.test(sql)) return store.ventas.get(args[0]) || null;
      if (/estado FROM stickers_actual WHERE id = \?/.test(sql)) {
        const s = store.stickers.get(args[0]);
        return s ? { estado: s.estado } : null;
      }
      return null;
    },
    async all(sql, args) {
      if (/FROM venta_items WHERE venta_id = \? ORDER BY id/.test(sql)) {
        return store.items.filter((it) => it.venta_id === args[0]).sort((a, b) => a.id - b.id);
      }
      if (/entregado_en FROM venta_items WHERE venta_id = \?/.test(sql)) {
        return store.items.filter((it) => it.venta_id === args[0]).map((it) => ({ entregado_en: it.entregado_en }));
      }
      return [];
    },
    async run(sql, args) {
      if (/UPDATE venta_items SET sticker_reservado_id = \? WHERE id = \?/.test(sql)) {
        find(args[1]).sticker_reservado_id = args[0];
      } else if (/UPDATE venta_items SET sticker_id = \? WHERE id = \?/.test(sql)) {
        find(args[1]).sticker_id = args[0];
      } else if (/UPDATE venta_items SET entregado_en = NOW\(\) WHERE id = \?/.test(sql)) {
        find(args[0]).entregado_en = new Date().toISOString();
      } else if (/UPDATE ventas SET retiro_estado = 'entregado'/.test(sql)) {
        const v = store.ventas.get(args[1]);
        if (v && v.retiro_estado !== 'entregado') {
          v.retiro_estado = 'entregado';
          v.entregada_por_vendedor_id = args[0];
        }
      } else if (/INSERT INTO destinos/.test(sql)) {
        store.destinos.push(args);
      }
      return {};
    },
    async transicionarSticker(id, patch) {
      const s = store.stickers.get(id) || { id, estado: 'en_stock', comprador_id: null };
      Object.assign(s, patch);
      store.stickers.set(id, s);
    },
    async registrarEventoAdmin(id, tipo, extra) {
      store.eventos.push({ id, tipo, extra });
    },
    normalizarDestino: (tipo, valor) => ({ valor }),
    aUrlAbsoluta: (v) => v,
  };

  const find = (id) => store.items.find((it) => it.id === id);
  return { store, deps };
}

function seedVenta(store, { id = 1, items, vendedor = 9, comprador = 5 }) {
  store.ventas.set(id, {
    id, vendedor_id: vendedor, comprador_id: comprador, retiro_estado: 'pendiente',
  });
  items.forEach((it, i) => {
    const stickerId = it.reservado;
    store.stickers.set(stickerId, { id: stickerId, estado: 'vendido_pendiente', comprador_id: comprador });
    if (it.tapeado && it.tapeado !== stickerId) {
      store.stickers.set(it.tapeado, { id: it.tapeado, estado: 'en_stock', comprador_id: null });
    }
    store.items.push({
      id: id * 100 + i, venta_id: id, sticker_id: stickerId, sticker_reservado_id: null,
      entregado_en: null, destino_tipo: it.destinoTipo || null, destino_valor: it.destinoValor || null,
    });
  });
}

test('entrega re-apuntando a otra unidad: libera la reservada, activa la tapeada, cierra la venta', async () => {
  const { store, deps } = makeStore();
  seedVenta(store, { items: [{ reservado: 10, tapeado: 20 }] });

  const r = await entregarUnidad(deps, { ventaId: 1, stickerId: 20 });

  assert.equal(r.status, 200);
  assert.equal(r.body.restantes, 0);
  assert.equal(store.stickers.get(10).estado, 'en_stock');
  assert.equal(store.stickers.get(10).comprador_id, null);
  assert.equal(store.stickers.get(20).estado, 'activo');
  assert.equal(store.stickers.get(20).comprador_id, 5);
  assert.equal(store.items[0].sticker_id, 20);
  assert.equal(store.items[0].sticker_reservado_id, 10);
  assert.equal(store.ventas.get(1).retiro_estado, 'entregado');
  assert.equal(store.eventos.at(-1).tipo, 'entrega');
});

test('entrega con la misma unidad reservada (sin tap distinto): sólo la activa', async () => {
  const { store, deps } = makeStore();
  seedVenta(store, { items: [{ reservado: 10 }] });

  const r = await entregarUnidad(deps, { ventaId: 1, stickerId: 10 });

  assert.equal(r.body.restantes, 0);
  assert.equal(store.stickers.get(10).estado, 'activo');
  assert.equal(store.items[0].sticker_reservado_id, null);
});

test('venta de 2 items: la primera entrega deja restantes=1 y la venta pendiente; la segunda la cierra', async () => {
  const { store, deps } = makeStore();
  seedVenta(store, { items: [{ reservado: 10 }, { reservado: 11 }] });

  const r1 = await entregarUnidad(deps, { ventaId: 1, stickerId: 30 });
  assert.equal(r1.body.restantes, 1);
  assert.equal(store.ventas.get(1).retiro_estado, 'pendiente');

  const r2 = await entregarUnidad(deps, { ventaId: 1, stickerId: 31 });
  assert.equal(r2.body.restantes, 0);
  assert.equal(store.ventas.get(1).retiro_estado, 'entregado');
});

test('idempotencia: entregar una venta ya entregada es un no-op', async () => {
  const { store, deps } = makeStore();
  seedVenta(store, { items: [{ reservado: 10 }] });
  await entregarUnidad(deps, { ventaId: 1, stickerId: 10 });

  const again = await entregarUnidad(deps, { ventaId: 1, stickerId: 10 });
  assert.equal(again.status, 200);
  assert.equal(again.body.yaEstaba, true);
  assert.equal(store.eventos.length, 1); // no registró un segundo evento
});

test('aplica el destino guardado del item al entregar', async () => {
  const { store, deps } = makeStore();
  seedVenta(store, { items: [{ reservado: 10, destinoTipo: 'instagram', destinoValor: 'juan' }] });

  await entregarUnidad(deps, { ventaId: 1, stickerId: 10 });
  assert.equal(store.destinos.length, 1);
  assert.deepEqual(store.destinos[0], [10, 'instagram', 'juan']);
});

test('venta inexistente → 404', async () => {
  const { deps } = makeStore();
  const r = await entregarUnidad(deps, { ventaId: 999, stickerId: 1 });
  assert.equal(r.status, 404);
});
