import { db } from './db.js';

const DEMO_WHATSAPP = '+5491122334455';
const DEMO_VENDOR_REF = 'nacho';

async function run(sql, args = []) {
  const res = await db.execute({ sql, args });
  return { ...res, lastInsertRowid: res.rows[0]?.id ?? null };
}

let vendedor = (await run('SELECT id FROM vendedores WHERE codigo_ref = ?', [DEMO_VENDOR_REF])).rows[0];
if (!vendedor) {
  const result = await run('INSERT INTO vendedores (nombre, codigo_ref, comision_pct) VALUES (?, ?, ?)', [
    'Nacho',
    DEMO_VENDOR_REF,
    50,
  ]);
  vendedor = { id: Number(result.lastInsertRowid) };
  console.log(`Vendedor demo creado (id ${vendedor.id}, ref=${DEMO_VENDOR_REF}).`);
} else {
  console.log(`Ya existe el vendedor demo (id ${vendedor.id}, ref=${DEMO_VENDOR_REF}).`);
}

const existingComprador = (await run('SELECT id FROM compradores WHERE whatsapp = ?', [DEMO_WHATSAPP])).rows[0];

if (existingComprador) {
  console.log(`Ya existe el comprador demo (id ${existingComprador.id}, ${DEMO_WHATSAPP}) — nada para hacer.`);
} else {
  const compradorResult = await run('INSERT INTO compradores (whatsapp, nombre) VALUES (?, ?)', [
    DEMO_WHATSAPP,
    'María Test',
  ]);
  const compradorId = Number(compradorResult.lastInsertRowid);

  async function altaSticker(codigoPublico, uidNfc, { modelo, vendedorId, compradorId, estado }) {
    const stickerId = Number(
      (await run('INSERT INTO stickers (codigo_publico, uid_nfc) VALUES (?, ?)', [codigoPublico, uidNfc]))
        .lastInsertRowid
    );
    const etapa = compradorId ? 'vendido' : vendedorId ? 'en_vendedor' : modelo ? 'con_modelo' : 'en_lote';
    await run(
      `INSERT INTO sticker_estados (sticker_id, etapa, modelo, vendedor_id, comprador_id, estado)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [stickerId, etapa, modelo || null, vendedorId || null, compradorId || null, estado]
    );
    return stickerId;
  }

  const stickerA = await altaSticker('k7f2m9', 'demo-uid-1', {
    modelo: 'tarjeta',
    vendedorId: vendedor.id,
    compradorId,
    estado: 'activo',
  });
  await run('INSERT INTO destinos (sticker_id, tipo, valor) VALUES (?, ?, ?)', [
    stickerA,
    'whatsapp',
    'https://wa.me/5491122334455',
  ]);

  const stickerB = await altaSticker('x3q8p1', 'demo-uid-2', {
    modelo: 'placa',
    vendedorId: vendedor.id,
    compradorId,
    estado: 'activo',
  });
  await run('INSERT INTO destinos (sticker_id, tipo, valor) VALUES (?, ?, ?)', [
    stickerB,
    'menu',
    'https://cafemaria.com.ar/menu',
  ]);

  // Una sola venta (un pago) con dos stickers adentro — demuestra que una
  // compra puede cubrir más de un producto a la vez.
  const ventaResult = await run(
    'INSERT INTO ventas (vendedor_id, comprador_id, monto, payment_id, estado_pago) VALUES (?, ?, ?, ?, ?)',
    [vendedor.id, compradorId, 8500 + 11000, 'demo-payment-1', 'confirmado']
  );
  const ventaId = Number(ventaResult.lastInsertRowid);
  await run('INSERT INTO venta_items (venta_id, sticker_id, monto, destino_tipo, destino_valor) VALUES (?, ?, ?, ?, ?)', [
    ventaId,
    stickerA,
    8500,
    'whatsapp',
    'https://wa.me/5491122334455',
  ]);
  await run('INSERT INTO venta_items (venta_id, sticker_id, monto, destino_tipo, destino_valor) VALUES (?, ?, ?, ?, ?)', [
    ventaId,
    stickerB,
    11000,
    'menu',
    'https://cafemaria.com.ar/menu',
  ]);

  // Vendido pero todavía no activado — sin destino configurado aún.
  await altaSticker('r9t4w2', 'demo-uid-3', {
    modelo: 'llavero',
    vendedorId: vendedor.id,
    compradorId,
    estado: 'vendido_pendiente',
  });

  // Stock sin vender, para ver inventario en el panel Admin.
  await altaSticker('p5j8k1', 'demo-uid-4', { modelo: 'tarjeta', vendedorId: vendedor.id, estado: 'en_stock' });

  console.log(`Comprador demo creado (id ${compradorId}, ${DEMO_WHATSAPP}) con 4 stickers y 2 ventas.`);
}
