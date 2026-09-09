// Cola de entrega y botón de despacho — ver "Cola de entrega y botón de
// despacho" en el vault NextTap - Knowledge.
//
// Late binding: la unidad física se ata al pedido en la ENTREGA, no en el pago.
// Al confirmarse el pago (webhook), una venta presencial entra a la cola con un
// `codigo_retiro` de 4 dígitos. En la feria el vendedor abre el panel "Entrega"
// (Android, Web NFC en loop), tapea CUALQUIER llavero del combo, ve el #1 de la
// cola (mail + código + cuántos esperan), grita el código, y confirma la
// entrega. Ahí el `venta_item` se re-apunta a la unidad tapeada.
//
// Todo aislado acá para que el diff en index.js sea mínimo (mismo patrón que
// server/modo-activacion.js): index.js sólo inyecta helpers y monta el router.
//
// deps: { get, all, run, transicionarSticker, registrarEventoAdmin,
//   normalizarDestino, aUrlAbsoluta, isoInMinutes, RETIRO_TTL_MIN }

import express from 'express';

const comboKey = (modelo, funcion) => `${modelo || 'suelto'}__${funcion || ''}`;
const mismoCombo = (a, b) => (a.modelo || 'suelto') === (b.modelo || 'suelto') && (a.funcion || null) === (b.funcion || null);

// Orden FIFO dentro de un combo: primero las que nunca faltaron (por fecha de
// pago), después las reencoladas (por cuándo volvieron a la cola).
function ordenarCola(ventas) {
  const clave = (v) => [
    v.reencolada_en ? 1 : 0,
    +new Date(v.reencolada_en || v.fecha),
    v.id,
  ];
  return [...ventas].sort((a, b) => {
    const [a1, a2, a3] = clave(a);
    const [b1, b2, b3] = clave(b);
    return a1 - b1 || a2 - b2 || a3 - b3;
  });
}

// Marca como 'ausente' las ventas cuyo código de retiro venció sin que el
// comprador apareciera. Derivado, igual que la posición — se corre al leer.
async function barrerNoShows(deps, vendedorId) {
  await deps.run(
    `UPDATE ventas SET retiro_estado = 'ausente'
      WHERE vendedor_id = ? AND retiro_estado = 'pendiente'
        AND retiro_expira_en IS NOT NULL AND retiro_expira_en < NOW()`,
    [vendedorId]
  );
}

// Cola de entrega de un vendedor: una fila por venta pendiente, con sus combos
// (modelo+función de cada item) y cuántos items le faltan entregar.
async function colaDelVendedor(deps, vendedorId) {
  const ventas = await deps.all(
    `SELECT v.id, v.fecha, v.codigo_retiro, v.reencolada_en, v.retiro_expira_en,
            v.comprador_id, c.email AS comprador_email, c.whatsapp AS comprador_whatsapp
       FROM ventas v
       LEFT JOIN compradores c ON c.id = v.comprador_id
      WHERE v.vendedor_id = ? AND v.retiro_estado = 'pendiente'`,
    [vendedorId]
  );
  const out = [];
  for (const v of ventas) {
    const items = await deps.all(
      `SELECT vi.id, vi.entregado_en, s.modelo, s.funcion
         FROM venta_items vi
         JOIN stickers_actual s ON s.id = COALESCE(vi.sticker_reservado_id, vi.sticker_id)
        WHERE vi.venta_id = ?`,
      [v.id]
    );
    const pendientes = items.filter((it) => !it.entregado_en);
    if (!pendientes.length) continue; // todos entregados pero la venta no cerró — se cierra sola en /entregar
    const combos = [];
    for (const it of pendientes) {
      if (!combos.some((c) => mismoCombo(c, it))) combos.push({ modelo: it.modelo, funcion: it.funcion });
    }
    out.push({
      id: v.id,
      fecha: v.fecha,
      reencolada_en: v.reencolada_en,
      codigoRetiro: v.codigo_retiro,
      venceEn: v.retiro_expira_en,
      mail: v.comprador_email || v.comprador_whatsapp || null,
      restantesItems: pendientes.length,
      combos,
    });
  }
  return out;
}

// Cola de un combo puntual, ya ordenada.
async function colaDelCombo(deps, vendedorId, combo) {
  const todas = await colaDelVendedor(deps, vendedorId);
  return ordenarCola(todas.filter((v) => v.combos.some((c) => mismoCombo(c, combo))));
}

// Resuelve el chip tapeado: código público, UID del chip, UID físico vinculado,
// o una URL pegada (…/v/<cod>). Devuelve la fila de stickers_actual + uid_fisico.
async function resolverChip(deps, entrada) {
  let ident = String(entrada || '').trim();
  const urlMatch = ident.match(/(?:[?&]c=|\/(?:v|activacion)\/)([^/?#&\s]+)/i);
  if (urlMatch) ident = decodeURIComponent(urlMatch[1]).trim();
  if (!ident) return null;
  const identLower = ident.toLowerCase();
  return deps.get(
    `SELECT s.*, st.uid_fisico
       FROM stickers_actual s
       JOIN stickers st ON st.id = s.id
      WHERE s.codigo_publico = ? OR LOWER(s.uid_nfc) = ? OR LOWER(st.uid_fisico) = ?`,
    [identLower, identLower, identLower]
  );
}

// Aplica el destino guardado del item al sticker recién entregado (best-effort,
// igual criterio que el webhook: mejor un destino raro que ninguno).
async function aplicarDestino(deps, item) {
  if (!item.destino_valor) return;
  const norm = deps.normalizarDestino(item.destino_tipo, item.destino_valor);
  const valor = norm.valor || (deps.aUrlAbsoluta ? deps.aUrlAbsoluta(item.destino_valor) : null) || item.destino_valor;
  await deps.run(
    `INSERT INTO destinos (sticker_id, tipo, valor, actualizado_en) VALUES (?, ?, ?, NOW())
       ON CONFLICT(sticker_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, actualizado_en = NOW()`,
    [item.sticker_id, item.destino_tipo, valor]
  );
}

// Núcleo de la entrega — compartido por el endpoint y por el replay de la
// outbox offline. Idempotente: si el item ya se entregó, es un no-op.
export async function entregarUnidad(deps, { ventaId, stickerId }) {
  const venta = await deps.get('SELECT * FROM ventas WHERE id = ?', [ventaId]);
  if (!venta) return { status: 404, body: { error: 'Venta no encontrada.' } };
  if (venta.retiro_estado === 'entregado') {
    return { status: 200, body: { entregado: true, restantes: 0, yaEstaba: true } };
  }
  if (!['pendiente', 'ausente'].includes(venta.retiro_estado)) {
    return { status: 409, body: { error: 'Esta venta no está en la cola de entrega.' } };
  }

  const items = await deps.all(
    'SELECT * FROM venta_items WHERE venta_id = ? ORDER BY id',
    [ventaId]
  );
  const pendientes = items.filter((it) => !it.entregado_en);
  if (!pendientes.length) {
    await cerrarVentaSiCorresponde(deps, venta, items);
    return { status: 200, body: { entregado: true, restantes: 0, yaEstaba: true } };
  }

  const item = pendientes[0];
  const destinoTap = Number(stickerId) || item.sticker_id;

  // Re-apuntar el item a la unidad tapeada si es otra: la reservada en el pago
  // vuelve al stock, la tapeada pasa a ser del comprador.
  if (destinoTap !== item.sticker_id) {
    const reservada = await deps.get('SELECT estado FROM stickers_actual WHERE id = ?', [item.sticker_id]);
    if (reservada && reservada.estado === 'vendido_pendiente') {
      await deps.transicionarSticker(item.sticker_id, { comprador_id: null, estado: 'en_stock' });
    }
    if (!item.sticker_reservado_id) {
      await deps.run('UPDATE venta_items SET sticker_reservado_id = ? WHERE id = ?', [item.sticker_id, item.id]);
    }
    await deps.run('UPDATE venta_items SET sticker_id = ? WHERE id = ?', [destinoTap, item.id]);
    item.sticker_id = destinoTap;
  }

  await deps.transicionarSticker(item.sticker_id, {
    comprador_id: venta.comprador_id,
    estado: 'activo',
  });
  await aplicarDestino(deps, item);
  await deps.run('UPDATE venta_items SET entregado_en = NOW() WHERE id = ?', [item.id]);

  const restantes = pendientes.length - 1;
  await cerrarVentaSiCorresponde(deps, venta, items, { forzarSiSinPendientes: restantes === 0 });

  await deps.registrarEventoAdmin(item.sticker_id, 'entrega', {
    despues: { ventaId, restantes, comprador: venta.comprador_id },
  });

  return { status: 200, body: { entregado: true, restantes } };
}

async function cerrarVentaSiCorresponde(deps, venta, items, { forzarSiSinPendientes = true } = {}) {
  const frescos = await deps.all('SELECT entregado_en FROM venta_items WHERE venta_id = ?', [venta.id]);
  const quedanPendientes = frescos.some((it) => !it.entregado_en);
  if (quedanPendientes || !forzarSiSinPendientes) return;
  await deps.run(
    `UPDATE ventas SET retiro_estado = 'entregado', entregada_en = NOW(), entregada_por_vendedor_id = ?
      WHERE id = ? AND retiro_estado <> 'entregado'`,
    [venta.vendedor_id, venta.id]
  );
}

export function crearDespachoRouter(deps) {
  const router = express.Router();
  const admin = deps.requireAdmin;
  const vendedor = deps.requireVendedor;

  // Tap de un chip en blanco en el panel de despacho. Devuelve el #1 de la cola
  // de ese combo, o avisa si el chip ya está entregado.
  router.post('/admin/despacho/tap', admin, async (req, res) => {
    const chip = await resolverChip(deps, req.body?.codigo ?? req.body?.uid ?? req.body?.uidFisico);
    if (!chip) return res.status(404).json({ error: 'No reconozco ese chip.' });

    const sticker = { id: chip.id, codigoPublico: chip.codigo_publico };

    // Ya entregado / asignado: no re-asignar, mostrar a quién.
    if (chip.comprador_id && chip.estado !== 'en_stock') {
      const dueno = await deps.get(
        'SELECT email, whatsapp FROM compradores WHERE id = ?',
        [chip.comprador_id]
      );
      const item = await deps.get(
        `SELECT vi.entregado_en, v.id AS venta_id, v.fecha
           FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
          WHERE vi.sticker_id = ? ORDER BY vi.id DESC LIMIT 1`,
        [chip.id]
      );
      return res.json({
        yaEntregado: true,
        sticker,
        estado: chip.estado,
        a: {
          mail: dueno?.email || dueno?.whatsapp || null,
          cuando: item?.entregado_en || item?.fecha || null,
          ventaId: item?.venta_id || null,
        },
      });
    }

    if (chip.estado !== 'en_stock' || !chip.vendedor_id) {
      return res.json({ sinCola: true, sticker, estado: chip.estado });
    }

    await barrerNoShows(deps, chip.vendedor_id);
    const combo = { modelo: chip.modelo, funcion: chip.funcion };
    const cola = await colaDelCombo(deps, chip.vendedor_id, combo);
    const head = cola[0] || null;

    res.json({
      sticker,
      combo,
      esperando: cola.length,
      siguiente: head
        ? {
            ventaId: head.id,
            mail: head.mail,
            codigoRetiro: head.codigoRetiro,
            restantesItems: head.restantesItems,
            venceEn: head.venceEn,
          }
        : null,
    });
  });

  // Confirmar la entrega: ata el chip tapeado al pedido y lo saca de la cola.
  router.post('/admin/despacho/entregar', admin, async (req, res) => {
    const ventaId = Number(req.body?.ventaId);
    const stickerId = Number(req.body?.stickerId) || null;
    if (!ventaId) return res.status(400).json({ error: 'Falta ventaId.' });
    const { status, body } = await entregarUnidad(deps, { ventaId, stickerId });
    res.status(status).json(body);
  });

  // Saltear al #1 (no apareció): lo manda al fondo de la cola de su combo.
  router.post('/admin/despacho/siguiente', admin, async (req, res) => {
    const ventaId = Number(req.body?.ventaId);
    if (!ventaId) return res.status(400).json({ error: 'Falta ventaId.' });
    const venta = await deps.get(
      `SELECT * FROM ventas WHERE id = ? AND retiro_estado = 'pendiente'`,
      [ventaId]
    );
    if (!venta) return res.status(404).json({ error: 'No está en la cola.' });
    await deps.run(
      `UPDATE ventas SET reencolada_en = NOW(), retiro_expira_en = ? WHERE id = ?`,
      [deps.isoInMinutes(deps.RETIRO_TTL_MIN), ventaId]
    );
    const combo = await primerComboDeVenta(deps, ventaId);
    const cola = combo ? await colaDelCombo(deps, venta.vendedor_id, combo) : [];
    res.json({ ok: true, siguiente: cola[0] ? { ventaId: cola[0].id, mail: cola[0].mail, codigoRetiro: cola[0].codigoRetiro } : null });
  });

  // Devolver a la cola una venta marcada 'ausente' (volvió el comprador).
  router.post('/admin/despacho/devolver', admin, async (req, res) => {
    const ventaId = Number(req.body?.ventaId);
    if (!ventaId) return res.status(400).json({ error: 'Falta ventaId.' });
    const r = await deps.run(
      `UPDATE ventas SET retiro_estado = 'pendiente', reencolada_en = NOW(), retiro_expira_en = ?
        WHERE id = ? AND retiro_estado = 'ausente'`,
      [deps.isoInMinutes(deps.RETIRO_TTL_MIN), ventaId]
    );
    res.json({ ok: true });
  });

  // Cola agrupada por combo — para el panel de despacho y su cache offline.
  // Admin: todas las ventas pendientes (Mari es admin + vendedor). Cada grupo
  // trae también el vendedor, por si hay más de uno.
  const colaAgrupada = async (vendedorIds) => {
    const grupos = new Map();
    for (const vid of vendedorIds) {
      await barrerNoShows(deps, vid);
      const todas = ordenarCola(await colaDelVendedor(deps, vid));
      for (const v of todas) {
        for (const combo of v.combos) {
          const k = `${vid}::${comboKey(combo.modelo, combo.funcion)}`;
          if (!grupos.has(k)) {
            grupos.set(k, { vendedorId: vid, modelo: combo.modelo || 'suelto', funcion: combo.funcion, pedidos: [] });
          }
          grupos.get(k).pedidos.push({
            ventaId: v.id,
            mail: v.mail,
            codigoRetiro: v.codigoRetiro,
            restantesItems: v.restantesItems,
            venceEn: v.venceEn,
          });
        }
      }
    }
    return { generadoEn: new Date().toISOString(), combos: [...grupos.values()] };
  };

  router.get('/admin/despacho/cola', admin, async (req, res) => {
    const filtro = req.query.vendedorId ? [Number(req.query.vendedorId)] : null;
    const ids = filtro || (await deps.all(
      `SELECT DISTINCT vendedor_id FROM ventas WHERE retiro_estado IN ('pendiente', 'ausente') AND vendedor_id IS NOT NULL`
    )).map((r) => r.vendedor_id);
    res.json(await colaAgrupada(ids));
  });

  router.get('/vendedor/cola', vendedor, async (req, res) => {
    res.json(await colaAgrupada([req.vendedor.id]));
  });

  return router;
}

async function primerComboDeVenta(deps, ventaId) {
  const it = await deps.get(
    `SELECT s.modelo, s.funcion FROM venta_items vi
       JOIN stickers_actual s ON s.id = COALESCE(vi.sticker_reservado_id, vi.sticker_id)
      WHERE vi.venta_id = ? ORDER BY vi.id LIMIT 1`,
    [ventaId]
  );
  return it ? { modelo: it.modelo, funcion: it.funcion } : null;
}
