import { db } from './db.js';

const DEMO_WHATSAPP = '+5491122334455';
const DEMO_VENDOR_REF = 'nacho';

async function run(sql, args = []) {
  return db.execute({ sql, args });
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

  const stickerA = Number(
    (
      await run(
        'INSERT INTO stickers (codigo_publico, uid_nfc, comprador_id, vendedor_id, estado, modelo) VALUES (?, ?, ?, ?, ?, ?)',
        ['k7f2m9', 'demo-uid-1', compradorId, vendedor.id, 'activo', 'tarjeta']
      )
    ).lastInsertRowid
  );
  await run('INSERT INTO destinos (sticker_id, tipo, valor) VALUES (?, ?, ?)', [
    stickerA,
    'whatsapp',
    'https://wa.me/5491122334455',
  ]);
  await run(
    'INSERT INTO ventas (sticker_id, vendedor_id, comprador_id, monto, payment_id, estado_pago) VALUES (?, ?, ?, ?, ?, ?)',
    [stickerA, vendedor.id, compradorId, 8500, 'demo-payment-1', 'confirmado']
  );

  const stickerB = Number(
    (
      await run(
        'INSERT INTO stickers (codigo_publico, uid_nfc, comprador_id, vendedor_id, estado, modelo) VALUES (?, ?, ?, ?, ?, ?)',
        ['x3q8p1', 'demo-uid-2', compradorId, vendedor.id, 'activo', 'placa']
      )
    ).lastInsertRowid
  );
  await run('INSERT INTO destinos (sticker_id, tipo, valor) VALUES (?, ?, ?)', [
    stickerB,
    'menu',
    'https://cafemaria.com.ar/menu',
  ]);
  await run(
    'INSERT INTO ventas (sticker_id, vendedor_id, comprador_id, monto, payment_id, estado_pago) VALUES (?, ?, ?, ?, ?, ?)',
    [stickerB, vendedor.id, compradorId, 11000, 'demo-payment-2', 'confirmado']
  );

  // Vendido pero todavía no activado — sin destino configurado aún.
  await run(
    'INSERT INTO stickers (codigo_publico, uid_nfc, comprador_id, vendedor_id, estado, modelo) VALUES (?, ?, ?, ?, ?, ?)',
    ['r9t4w2', 'demo-uid-3', compradorId, vendedor.id, 'vendido_pendiente', 'llavero']
  );

  // Stock sin vender, para ver inventario en el panel Admin.
  await run('INSERT INTO stickers (codigo_publico, uid_nfc, vendedor_id, estado, modelo) VALUES (?, ?, ?, ?, ?)', [
    'p5j8k1',
    'demo-uid-4',
    vendedor.id,
    'en_stock',
    'tarjeta',
  ]);

  console.log(`Comprador demo creado (id ${compradorId}, ${DEMO_WHATSAPP}) con 4 stickers y 2 ventas.`);
}
