// Modo de activación de un producto — 'bloqueada', 'liberada' o 'gratis'.
//
//   bloqueada (default)  el chip queda lockeado y necesita que un vendedor lo
//                        venda (pago + OTP) para activarse. Es el estado natural
//                        de un chip recién grabado, sin liberación.
//   liberada             se activa por posesión física PAGANDO (sin OTP), como
//                        un lote especial pero sobre un chip cualquiera. Sirve
//                        para venderle un lote a un local que lo revende.
//   gratis               se activa por posesión física SIN pagar (solo el mail).
//                        Para amigos.
//
// El modo REAL de cada sticker se deriva de si tiene una fila vigente en
// `activaciones_liberadas` (ver `modoDeLiberacion`). `lotes.modo_activacion`
// guarda la intención por defecto del lote y es el objetivo del cambio masivo.
//
// Toda la lógica vive acá para que server/index.js sólo tenga que inyectar sus
// helpers y montar el router — así el diff en index.js es mínimo y no choca con
// otros cambios en paralelo sobre el panel de admin.

import express from 'express';

export const MODOS_ACTIVACION = ['bloqueada', 'liberada', 'gratis'];

// Modo derivado de la liberación vigente de un sticker (o de su ausencia).
export function modoDeLiberacion(libVigente) {
  if (!libVigente) return 'bloqueada';
  return libVigente.gratis ? 'gratis' : 'liberada';
}

// Núcleo compartido con POST /api/admin/activaciones-liberadas: crea la fila de
// activación liberada para `sticker`, con reescritura maestra opcional (`forzar`)
// sobre un producto que ya está vendido / activo. El caller resuelve el sticker
// y pasa los valores de función/modelo ya con su default aplicado.
//
// deps: { get, run, snapshotSticker, transicionarSticker, registrarEventoAdmin,
//   vendedorEspecialId, deriveChipPassword, deriveChipPack, esLoteEspecial,
//   normalizarDestino, CHIP_MASTER_SECRET, PUBLIC_ROUTER_BASE, FRONTEND_URL }
//
// Devuelve { status, body } — el caller hace res.status(status).json(body).
export async function crearLiberacion(deps, params) {
  const {
    get, run, snapshotSticker, transicionarSticker, registrarEventoAdmin,
    vendedorEspecialId, deriveChipPassword, deriveChipPack, esLoteEspecial,
    normalizarDestino, CHIP_MASTER_SECRET, PUBLIC_ROUTER_BASE, FRONTEND_URL,
  } = deps;
  const {
    sticker, gratis, motivo = null, funcion = '', modelo = '', vendedorId = null,
    destinoTipo = null, destinoValorRaw = '', expiraDias = 0, forzar = false,
  } = params;

  // Destino pre-cargado (opcional): se normaliza ya.
  let destinoValor = null;
  if (destinoValorRaw) {
    if (!destinoTipo) return { status: 400, body: { error: 'Elegí el tipo del destino pre-cargado.' } };
    const norm = normalizarDestino(destinoTipo, destinoValorRaw);
    if (norm.error) return { status: 400, body: { error: norm.error } };
    destinoValor = norm.valor;
  }

  const actual = await get('SELECT * FROM stickers_actual WHERE id = ?', [sticker.id]);
  let ventaAnuladaId = null;

  if (actual.estado !== 'en_stock') {
    if (!forzar) {
      return {
        status: 409,
        body: { error: `Este producto está "${actual.estado}". Marcá "reescritura maestra" para forzar la liberación igual.` },
      };
    }

    const antes = await snapshotSticker(sticker.id);

    // Anular la venta confirmada vigente de este sticker (si la hay).
    const ventaVieja = await get(
      `SELECT v.* FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
        WHERE vi.sticker_id = ? AND v.estado_pago = 'confirmado' AND v.anulada_en IS NULL
        ORDER BY v.id DESC LIMIT 1`,
      [sticker.id]
    );
    if (ventaVieja) {
      // Si la comisión seguía pendiente, la sacamos del cálculo (estado_pago ->
      // 'anulado'). Si ya estaba liquidada, se deja 'confirmado': la plata ya se
      // transfirió, no se revierte.
      await run(
        `UPDATE ventas SET anulada_en = NOW(), anulada_motivo = 'reescritura_maestra'
         ${ventaVieja.comision_liquidada ? '' : ", estado_pago = 'anulado'"} WHERE id = ?`,
        [ventaVieja.id]
      );
      ventaAnuladaId = ventaVieja.id;
    }

    // Ventas pendientes (pago sin terminar) de este sticker: quedarían huérfanas.
    await run(
      `UPDATE ventas SET anulada_en = NOW(), anulada_motivo = 'reescritura_maestra', estado_pago = 'anulado'
        WHERE estado_pago = 'pendiente' AND anulada_en IS NULL
          AND id IN (SELECT venta_id FROM venta_items WHERE sticker_id = ?)`,
      [sticker.id]
    );

    await run('DELETE FROM destinos WHERE sticker_id = ?', [sticker.id]);
    await transicionarSticker(sticker.id, { estado: 'en_stock', comprador_id: null });
    await registrarEventoAdmin(sticker.id, 'reescritura_maestra', {
      antes,
      despues: await snapshotSticker(sticker.id),
      motivo: ventaAnuladaId ? `${motivo || ''} (venta #${ventaAnuladaId} anulada)`.trim() : motivo,
    });
  }

  // Reescritura opcional de función / modelo / vendedor.
  if (funcion || modelo || vendedorId) {
    await transicionarSticker(sticker.id, {
      ...(modelo ? { modelo } : {}),
      ...(funcion ? { funcion } : {}),
      ...(vendedorId ? { vendedor_id: vendedorId } : {}),
    });
  }

  const vendedorLiberacion = vendedorId || (await vendedorEspecialId());
  const expiraEn = expiraDias > 0 ? new Date(Date.now() + expiraDias * 86_400_000).toISOString() : null;

  const r = await run(
    `INSERT INTO activaciones_liberadas (sticker_id, motivo, destino_tipo, destino_valor, vendedor_id, expira_en, gratis)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sticker.id, motivo, destinoTipo, destinoValor, vendedorLiberacion, expiraEn, gratis]
  );
  await registrarEventoAdmin(sticker.id, 'liberacion', {
    despues: {
      modo: gratis ? 'gratis' : 'con pago',
      motivo,
      destino: destinoValor ? `${destinoTipo}:${destinoValor}` : null,
      expiraEn,
      forzado: actual.estado !== 'en_stock',
    },
    motivo,
  });

  const claves = CHIP_MASTER_SECRET && sticker.uid_nfc && !esLoteEspecial(sticker.uid_nfc)
    ? { writePassword: deriveChipPassword(sticker.uid_nfc), writePack: deriveChipPack(sticker.uid_nfc) }
    : {};

  return {
    status: 201,
    body: {
      id: r.lastInsertRowid,
      liberacionId: r.lastInsertRowid,
      codigoPublico: sticker.codigo_publico,
      url: `${PUBLIC_ROUTER_BASE}/v/${sticker.codigo_publico}`,
      activacionUrl: `${FRONTEND_URL}/activacion/${sticker.codigo_publico}`,
      forzado: actual.estado !== 'en_stock',
      ventaAnuladaId,
      gratis,
      ...claves,
    },
  };
}

// Revoca la liberación vigente de un sticker (lo deja en modo 'bloqueada').
async function revocarVigente(deps, stickerId, motivo) {
  const { run, liberacionVigente, registrarEventoAdmin } = deps;
  const vigente = await liberacionVigente(stickerId);
  if (!vigente) return false;
  await run('UPDATE activaciones_liberadas SET revocada_en = NOW() WHERE id = ?', [vigente.id]);
  await registrarEventoAdmin(stickerId, 'revocacion_liberacion', { motivo });
  return true;
}

// Lleva UN sticker al modo pedido. Devuelve { status, body }.
async function cambiarModoSticker(deps, sticker, modo, req, { motivoBase } = {}) {
  const { get, liberacionVigente } = deps;
  const actual = await get('SELECT * FROM stickers_actual WHERE id = ?', [sticker.id]);
  const vigente = await liberacionVigente(sticker.id);

  if (modo === 'bloqueada') {
    if (!vigente) return { status: 200, body: { modo, cambiado: false } };
    if (actual?.estado === 'activo') {
      return {
        status: 409,
        body: { error: 'El producto ya está activo — para volver a bloqueada hay que desactivarlo primero.' },
      };
    }
    await revocarVigente(deps, sticker.id, motivoBase || 'Cambio a modo bloqueada');
    return { status: 200, body: { modo, cambiado: true } };
  }

  // liberada | gratis
  const gratis = modo === 'gratis';
  if (vigente && Boolean(vigente.gratis) === gratis) {
    return { status: 200, body: { modo, cambiado: false } };
  }
  const forzar = req.body?.forzar === true;
  if (actual.estado !== 'en_stock' && !forzar) {
    return {
      status: 409,
      body: { error: `Este producto está "${actual.estado}". Marcá "reescritura maestra" para forzar el cambio de modo.` },
    };
  }
  // Cambio de sub-modo (gratis <-> liberada): revocar la vigente del otro signo.
  if (vigente) await revocarVigente(deps, sticker.id, `${motivoBase || 'Cambio de modo'} (era ${vigente.gratis ? 'gratis' : 'liberada'})`);

  const motivo = String(req.body?.motivo || '').trim()
    || motivoBase
    || `Lote #${sticker.lote_id ?? '—'} — activación ${gratis ? 'gratis' : 'liberada'}`;

  return crearLiberacion(deps, {
    sticker,
    gratis,
    motivo,
    funcion: String(req.body?.funcion || '').trim() || actual?.funcion || '',
    modelo: String(req.body?.modelo || '').trim() || actual?.modelo || '',
    vendedorId: req.body?.vendedorId ? Number(req.body.vendedorId) : null,
    destinoTipo: String(req.body?.destinoTipo || '').trim() || null,
    destinoValorRaw: String(req.body?.destinoValor || '').trim(),
    expiraDias: Number(req.body?.expiraDias) || 0,
    forzar,
  });
}

// Router de los endpoints de modo de activación. Se monta bajo /api/admin con
// requireAdmin ya aplicado por el caller.
export function crearModoActivacionRouter(deps) {
  const { get, run, all } = deps;
  const router = express.Router();

  // Cambiar el modo de un producto puntual.
  router.post('/stickers/:id/modo', async (req, res) => {
    const stickerId = Number(req.params.id);
    const modo = String(req.body?.modo || '').trim();
    if (!MODOS_ACTIVACION.includes(modo)) {
      return res.status(400).json({ error: `Modo inválido — usá ${MODOS_ACTIVACION.join(' / ')}.` });
    }
    const sticker = await get('SELECT * FROM stickers WHERE id = ?', [stickerId]);
    if (!sticker) return res.status(404).json({ error: 'Producto no encontrado.' });

    const { status, body } = await cambiarModoSticker(deps, sticker, modo, req);
    return res.status(status).json({ modo, ...body });
  });

  // Cambiar el modo por defecto de un lote y aplicarlo a todos sus productos.
  router.post('/lotes/:id/modo', async (req, res) => {
    const loteId = Number(req.params.id);
    const modo = String(req.body?.modo || '').trim();
    if (!MODOS_ACTIVACION.includes(modo)) {
      return res.status(400).json({ error: `Modo inválido — usá ${MODOS_ACTIVACION.join(' / ')}.` });
    }
    const lote = await get('SELECT id FROM lotes WHERE id = ?', [loteId]);
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado.' });

    await run('UPDATE lotes SET modo_activacion = ? WHERE id = ?', [modo, loteId]);

    const stickers = await all(
      'SELECT id, codigo_publico FROM stickers_actual WHERE lote_id = ? ORDER BY id',
      [loteId]
    );
    const motivoBase = `Lote #${loteId} — activación ${modo}`;
    let aplicados = 0;
    const saltados = [];
    for (const s of stickers) {
      const full = await get('SELECT * FROM stickers WHERE id = ?', [s.id]);
      try {
        const { status, body } = await cambiarModoSticker(deps, full, modo, req, { motivoBase });
        if (status >= 400) saltados.push({ codigo: s.codigo_publico, motivo: body.error || `error ${status}` });
        else if (body.cambiado === false) { /* ya estaba en ese modo */ }
        else aplicados += 1;
      } catch (err) {
        saltados.push({ codigo: s.codigo_publico, motivo: err.message });
      }
    }
    return res.json({ modo, aplicados, saltados, total: stickers.length });
  });

  return router;
}
