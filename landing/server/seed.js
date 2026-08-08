import { db } from './db.js';

const DEMO_WHATSAPP = '+5491122334455';

const existing = db.prepare('SELECT id FROM compradores WHERE whatsapp = ?').get(DEMO_WHATSAPP);

if (existing) {
  console.log(`Ya existe el comprador demo (id ${existing.id}, ${DEMO_WHATSAPP}) — nada para hacer.`);
} else {
  const insertComprador = db.prepare('INSERT INTO compradores (whatsapp, nombre) VALUES (?, ?)');
  const compradorId = Number(insertComprador.run(DEMO_WHATSAPP, 'María Test').lastInsertRowid);

  const insertSticker = db.prepare(`
    INSERT INTO stickers (codigo_publico, uid_nfc, comprador_id, estado, modelo)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertDestino = db.prepare(`
    INSERT INTO destinos (sticker_id, tipo, valor) VALUES (?, ?, ?)
  `);

  const stickerA = Number(
    insertSticker.run('k7f2m9', 'demo-uid-1', compradorId, 'activo', 'tarjeta').lastInsertRowid
  );
  insertDestino.run(stickerA, 'whatsapp', 'https://wa.me/5491122334455');

  const stickerB = Number(
    insertSticker.run('x3q8p1', 'demo-uid-2', compradorId, 'activo', 'placa').lastInsertRowid
  );
  insertDestino.run(stickerB, 'menu', 'https://cafemaria.com.ar/menu');

  // Vendido pero todavía no activado — sin destino configurado aún.
  insertSticker.run('r9t4w2', 'demo-uid-3', compradorId, 'vendido_pendiente', 'llavero');

  console.log(`Comprador demo creado (id ${compradorId}, ${DEMO_WHATSAPP}) con 3 stickers.`);
}
