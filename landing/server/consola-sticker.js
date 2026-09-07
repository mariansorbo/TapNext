// Consola de stickers — modo de edición en tanda para el admin.
//
// Un solo modal donde se escribe (o escanea) un código, se ve el estado
// vigente del chip (la fila SCD2 actual de sticker_estados) y se corrigen
// vendedor / función / modelo sin pasar por los <select> repartidos del panel.
// Pensado para cuando tenés un pedazo de stock en la mano: cargás, tocás,
// ves qué cambió, y el foco vuelve al código sin apretar "siguiente".
//
// No toca esquema ni helpers nuevos: reusa transicionarSticker (que ya versiona
// en sticker_estados) y registrarEventoAdmin (la bitácora del "porqué", que es
// el SC2 que sticker_estados no guarda). Montado desde index.js con una línea,
// para no chocar con otros cambios en marcha sobre ese archivo.

const MODELOS = ['llavero', 'tarjeta', 'placa'];

// Acepta código público, UID de chip, UID físico vinculado, o una URL pegada
// (…/v/<cod>, …/activacion/<cod>, …?c=<cod>) — mismo criterio que activaciones
// liberadas.
function identDesde(crudo) {
  let ident = String(crudo || '').trim();
  const m = ident.match(/(?:[?&]c=|\/(?:v|activacion)\/)([^/?#&\s]+)/i);
  if (m) ident = decodeURIComponent(m[1]).trim();
  return ident;
}

export function montarConsolaSticker(app, deps) {
  const { get, run, requireAdmin, transicionarSticker, registrarEventoAdmin, esLoteEspecial, DESTINO_TIPOS } = deps;

  async function resolverSticker(identCrudo) {
    const ident = identDesde(identCrudo);
    if (!ident) return { error: 'Escribí o escaneá un código.' };
    const low = ident.toLowerCase();
    const st = await get(
      'SELECT * FROM stickers WHERE codigo_publico = ? OR LOWER(uid_nfc) = ? OR LOWER(uid_fisico) = ?',
      [low, low, low]
    );
    if (!st) return { error: `No encontré ningún producto con "${ident}".` };
    return { sticker: st };
  }

  async function nombreVendedor(id) {
    if (!id) return null;
    const v = await get('SELECT id, nombre, codigo_ref FROM vendedores WHERE id = ?', [id]);
    return v ? { id: v.id, nombre: v.nombre, codigoRef: v.codigo_ref } : { id, nombre: `#${id}`, codigoRef: null };
  }

  async function snapshot(stickerId) {
    const r = await get(
      `SELECT s.id, s.codigo_publico, s.uid_nfc, s.protegido_en, s.estado, s.etapa,
              s.modelo, s.funcion, s.vendedor_id, s.comprador_id, s.lote_id,
              l.nombre AS lote_nombre,
              c.nombre AS comprador_nombre, c.whatsapp AS comprador_whatsapp
         FROM stickers_actual s
         LEFT JOIN lotes l ON l.id = s.lote_id
         LEFT JOIN compradores c ON c.id = s.comprador_id
        WHERE s.id = ?`,
      [stickerId]
    );
    if (!r) return null;
    const loteEspecial = esLoteEspecial(r.uid_nfc);
    const bloqueos = [];
    if (r.estado !== 'en_stock') bloqueos.push('El chip ya fue vendido — solo se edita stock sin vender.');
    if (loteEspecial) bloqueos.push('Lote especial: función y modelo quedaron fijados al crear el lote.');
    return {
      id: r.id,
      codigoPublico: r.codigo_publico,
      uidNfc: r.uid_nfc,
      loteEspecial,
      estado: r.estado,
      etapa: r.etapa,
      modelo: r.modelo,
      funcion: r.funcion,
      vendedor: await nombreVendedor(r.vendedor_id),
      comprador: r.comprador_whatsapp
        ? { nombre: r.comprador_nombre, whatsapp: r.comprador_whatsapp }
        : null,
      protegidoEn: r.protegido_en,
      loteId: r.lote_id,
      loteNombre: r.lote_nombre || null,
      editable: r.estado === 'en_stock',
      camposFijos: loteEspecial ? ['funcion', 'modelo'] : [],
      bloqueos,
    };
  }

  // Cargar: resuelve el identificador y devuelve el estado vigente del chip.
  app.get('/api/admin/consola/sticker', requireAdmin, async (req, res) => {
    const { sticker, error } = await resolverSticker(req.query.q);
    if (error) return res.status(404).json({ error });
    res.json(await snapshot(sticker.id));
  });

  // Guardar: aplica en una sola transición los campos que vengan en `cambios`.
  // `cambios` solo trae las claves que el admin tocó; null / '' = dejar sin
  // asignar. Si nada cambia de verdad, no abre fila nueva ni pide motivo.
  app.patch('/api/admin/consola/sticker/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Sticker no encontrado.' });
    const cambios = req.body?.cambios || {};
    const motivo = String(req.body?.motivo || '').trim();

    const actual = await snapshot(id);
    if (!actual) return res.status(404).json({ error: 'Sticker no encontrado.' });
    if (!actual.editable) {
      return res.status(400).json({ error: 'Solo se puede editar stock que todavía no fue vendido.' });
    }

    const patch = {};
    const norm = (v) => (v === null || v === undefined || v === '' ? null : v);

    if ('vendedorId' in cambios) {
      const vId = norm(cambios.vendedorId) === null ? null : Number(cambios.vendedorId);
      if (vId) {
        const v = await get('SELECT id FROM vendedores WHERE id = ?', [vId]);
        if (!v) return res.status(404).json({ error: 'Vendedor no encontrado.' });
      }
      patch.vendedor_id = vId;
    }
    if ('funcion' in cambios) {
      if (actual.loteEspecial) return res.status(400).json({ error: 'No se puede cambiar la función de un lote especial.' });
      const f = norm(cambios.funcion);
      if (f && !DESTINO_TIPOS.includes(f)) return res.status(400).json({ error: 'Función inválida.' });
      patch.funcion = f;
    }
    if ('modelo' in cambios) {
      if (actual.loteEspecial) return res.status(400).json({ error: 'No se puede cambiar el modelo de un lote especial.' });
      const m = norm(cambios.modelo);
      if (m && !MODELOS.includes(m)) return res.status(400).json({ error: 'Modelo inválido.' });
      patch.modelo = m;
    }

    // Diff real contra el estado vigente.
    const diff = [];
    if ('vendedor_id' in patch && (patch.vendedor_id || null) !== (actual.vendedor?.id || null)) {
      diff.push({ campo: 'vendedor', antes: actual.vendedor?.nombre || null, despues: (await nombreVendedor(patch.vendedor_id))?.nombre || null });
    }
    if ('funcion' in patch && (patch.funcion || null) !== (actual.funcion || null)) {
      diff.push({ campo: 'funcion', antes: actual.funcion || null, despues: patch.funcion || null });
    }
    if ('modelo' in patch && (patch.modelo || null) !== (actual.modelo || null)) {
      diff.push({ campo: 'modelo', antes: actual.modelo || null, despues: patch.modelo || null });
    }

    if (!diff.length) {
      return res.json({ sinCambios: true, sticker: actual });
    }
    if (!motivo) {
      return res.status(400).json({ error: 'Poné un motivo del cambio (queda en la bitácora del chip).' });
    }

    // Solo mandamos a transicionar los campos que efectivamente cambian.
    const patchEfectivo = {};
    for (const d of diff) {
      if (d.campo === 'vendedor') patchEfectivo.vendedor_id = patch.vendedor_id;
      if (d.campo === 'funcion') patchEfectivo.funcion = patch.funcion;
      if (d.campo === 'modelo') patchEfectivo.modelo = patch.modelo;
    }
    await transicionarSticker(id, patchEfectivo);
    await registrarEventoAdmin(id, 'edicion_consola', {
      antes: Object.fromEntries(diff.map((d) => [d.campo, d.antes])),
      despues: Object.fromEntries(diff.map((d) => [d.campo, d.despues])),
      motivo,
    });

    res.json({ ok: true, diff, sticker: await snapshot(id) });
  });
}
