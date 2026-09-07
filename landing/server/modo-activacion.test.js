import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modoDeLiberacion, crearModoActivacionRouter } from './modo-activacion.js';

test('modoDeLiberacion: sin liberación = bloqueada; con = gratis/liberada según flag', () => {
  assert.equal(modoDeLiberacion(null), 'bloqueada');
  assert.equal(modoDeLiberacion({ gratis: true }), 'gratis');
  assert.equal(modoDeLiberacion({ gratis: false }), 'liberada');
});

// --- Router POST /stickers/:id/modo con deps mockeadas ---------------------

function mockDeps(overrides = {}) {
  const state = {
    sticker: { id: 1, codigo_publico: 'abc123', uid_nfc: 'deadbeef', lote_id: 7 },
    actual: { id: 1, estado: 'en_stock', funcion: 'instagram', modelo: 'llavero' },
    vigente: null,
    inserts: [],
    revocadas: [],
    eventos: [],
  };
  const deps = {
    async get(sql) {
      if (/FROM stickers WHERE id/.test(sql)) return state.sticker;
      if (/stickers_actual/.test(sql)) return state.actual;
      return null;
    },
    async all() { return []; },
    async run(sql, args) {
      if (/UPDATE activaciones_liberadas SET revocada_en/.test(sql)) { state.revocadas.push(args[0]); return {}; }
      if (/INSERT INTO activaciones_liberadas/.test(sql)) { state.inserts.push(args); return { lastInsertRowid: 99 }; }
      return {};
    },
    async liberacionVigente() { return state.vigente; },
    async snapshotSticker() { return {}; },
    async transicionarSticker() {},
    async registrarEventoAdmin(id, tipo) { state.eventos.push(tipo); },
    async vendedorEspecialId() { return 3; },
    deriveChipPassword: () => 'PWD', deriveChipPack: () => 'PACK',
    esLoteEspecial: () => false,
    normalizarDestino: () => ({ valor: 'x' }),
    CHIP_MASTER_SECRET: 'sercret', PUBLIC_ROUTER_BASE: 'http://r', FRONTEND_URL: 'http://f',
    ...overrides,
  };
  return { deps, state };
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function callModo(deps, body) {
  const router = crearModoActivacionRouter(deps);
  const layer = router.stack.find((l) => l.route?.path === '/stickers/:id/modo' && l.route.methods.post);
  const res = fakeRes();
  await layer.route.stack[0].handle({ params: { id: '1' }, body }, res, () => {});
  return res;
}

test('en_stock → gratis: inserta liberación con gratis=true y devuelve claves', async () => {
  const { deps, state } = mockDeps();
  const res = await callModo(deps, { modo: 'gratis' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.modo, 'gratis');
  assert.equal(res.body.gratis, true);
  assert.equal(res.body.writePassword, 'PWD');
  assert.equal(state.inserts.length, 1);
  assert.equal(state.inserts[0].at(-1), true); // último arg = gratis
});

test('gratis → bloqueada: revoca la liberación vigente', async () => {
  const { deps, state } = mockDeps({ liberacionVigente: async () => ({ id: 42, gratis: true }) });
  const res = await callModo(deps, { modo: 'bloqueada' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cambiado, true);
  assert.deepEqual(state.revocadas, [42]);
});

test('ya en bloqueada (sin liberación) → bloqueada: no-op', async () => {
  const { deps, state } = mockDeps();
  const res = await callModo(deps, { modo: 'bloqueada' });
  assert.equal(res.body.cambiado, false);
  assert.equal(state.revocadas.length, 0);
});

test('activo → liberada sin forzar: 409 pide reescritura maestra', async () => {
  const { deps } = mockDeps({
    get: async (sql) => (/stickers_actual/.test(sql)
      ? { id: 1, estado: 'activo', funcion: 'instagram', modelo: 'llavero' }
      : { id: 1, codigo_publico: 'abc123', uid_nfc: 'deadbeef', lote_id: 7 }),
  });
  const res = await callModo(deps, { modo: 'liberada' });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /reescritura maestra/i);
});

test('activo → bloqueada: 409 (no se puede desactivar acá)', async () => {
  const { deps } = mockDeps({
    liberacionVigente: async () => ({ id: 5, gratis: false }),
    get: async (sql) => (/stickers_actual/.test(sql)
      ? { id: 1, estado: 'activo' }
      : { id: 1, codigo_publico: 'abc123', uid_nfc: 'deadbeef', lote_id: 7 }),
  });
  const res = await callModo(deps, { modo: 'bloqueada' });
  assert.equal(res.statusCode, 409);
});

test('modo inválido → 400', async () => {
  const { deps } = mockDeps();
  const res = await callModo(deps, { modo: 'cualquiera' });
  assert.equal(res.statusCode, 400);
});
