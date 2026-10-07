// Edición forzada — botón del admin para pruebas.
//
// Cambia la función (tipo de destino) y el valor del destino de CUALQUIER chip,
// sin las barreras de la consola "Editar sticker": no importa el estado
// (en_stock, vendido_pendiente, activo…), ni que sea de lote especial, ni que
// tenga comprador. Pensado para forzar un llavero a apuntar a algo y tapearlo.
//
// - La función se versiona con transicionarSticker (fila SCD2 nueva).
// - El valor va a `destinos` (upsert), igual que cuando lo carga el comprador.
// - Todo queda en la bitácora sticker_eventos_admin como 'edicion_forzada'.
// - "Sin validar": guarda el valor tal cual si el plugin lo rechaza.
// - "Forzar activo": pasa el chip a estado 'activo' (sin venta ni comprador),
//   porque /v/:codigo solo sigue el destino de chips activos. Va en la misma
//   transición SCD2 que la función.

function identDesde(crudo) {
  let ident = String(crudo || '').trim();
  const m = ident.match(/(?:[?&]c=|\/(?:v|activacion)\/)([^/?#&\s]+)/i);
  if (m) ident = decodeURIComponent(m[1]).trim();
  return ident;
}

export function montarEdicionForzada(app, deps) {
  const {
    get,
    run,
    requireAdmin,
    transicionarSticker,
    registrarEventoAdmin,
    DESTINO_TIPOS,
    DESTINO_META,
    normalizarDestino,
    PUBLIC_ROUTER_BASE,
  } = deps;

  async function snapshot(stickerId) {
    const s = await get(
      `SELECT s.id, s.codigo_publico, s.uid_nfc, s.estado, s.modelo, s.funcion,
              d.tipo AS destino_tipo, d.valor AS destino_valor, d.actualizado_en AS destino_actualizado_en
         FROM stickers_actual s
         LEFT JOIN destinos d ON d.sticker_id = s.id
        WHERE s.id = ?`,
      [stickerId]
    );
    if (!s) return null;
    const avisos = [];
    if (s.estado !== 'activo') {
      avisos.push(`El chip está "${s.estado}": el tap no sigue el destino hasta que esté activo (tildá "Forzar estado a activo").`);
    }
    if (s.destino_tipo && s.funcion && s.destino_tipo !== s.funcion) {
      avisos.push(`La función (${s.funcion}) y el tipo del destino guardado (${s.destino_tipo}) no coinciden.`);
    }
    return {
      id: s.id,
      codigoPublico: s.codigo_publico,
      uidNfc: s.uid_nfc,
      estado: s.estado,
      modelo: s.modelo,
      funcion: s.funcion,
      destino: s.destino_tipo
        ? { tipo: s.destino_tipo, valor: s.destino_valor, actualizadoEn: s.destino_actualizado_en }
        : null,
      linkTap: `${PUBLIC_ROUTER_BASE}/v/${s.codigo_publico}`,
      avisos,
      destinos: DESTINO_TIPOS.map((id) => ({ id, ...DESTINO_META[id] })),
    };
  }

  app.get('/api/admin/edicion-forzada', requireAdmin, async (req, res) => {
    const ident = identDesde(req.query.q);
    if (!ident) return res.status(400).json({ error: 'Escribí o escaneá un código.' });
    const low = ident.toLowerCase();
    const st = await get(
      'SELECT id FROM stickers WHERE codigo_publico = ? OR LOWER(uid_nfc) = ? OR LOWER(uid_fisico) = ?',
      [low, low, low]
    );
    if (!st) return res.status(404).json({ error: `No encontré ningún producto con "${ident}".` });
    res.json(await snapshot(st.id));
  });

  // Body: { funcion, valor, sinValidar?, forzarActivo?, motivo? }. valor vacío = borrar el destino.
  app.patch('/api/admin/edicion-forzada/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Sticker no encontrado.' });
    const actual = await snapshot(id);
    if (!actual) return res.status(404).json({ error: 'Sticker no encontrado.' });

    const funcion = String(req.body?.funcion || '').trim();
    if (!DESTINO_TIPOS.includes(funcion)) return res.status(400).json({ error: 'Elegí una función.' });

    const crudo = req.body?.valor;
    const crudoTxt = typeof crudo === 'string' ? crudo.trim() : crudo ? JSON.stringify(crudo) : '';
    let valor = null;
    if (crudoTxt) {
      const norm = normalizarDestino(funcion, crudo);
      if (norm.error) {
        if (!req.body?.sinValidar) {
          return res.status(400).json({ error: `${norm.error} (o tildá "Guardar sin validar").` });
        }
        valor = crudoTxt;
      } else {
        valor = norm.valor;
      }
    }

    const estado = req.body?.forzarActivo ? 'activo' : actual.estado;
    const antes = {
      estado: actual.estado,
      funcion: actual.funcion || null,
      destino: actual.destino ? `${actual.destino.tipo}:${actual.destino.valor}` : null,
    };
    const despues = { estado, funcion, destino: valor ? `${funcion}:${valor}` : null };
    if (Object.keys(antes).every((k) => antes[k] === despues[k])) {
      return res.json({ sinCambios: true, sticker: actual });
    }

    const patch = {};
    if (antes.funcion !== funcion) patch.funcion = funcion;
    if (antes.estado !== estado) patch.estado = estado;
    if (Object.keys(patch).length) await transicionarSticker(id, patch);
    if (valor) {
      await run(
        `INSERT INTO destinos (sticker_id, tipo, valor, actualizado_en) VALUES (?, ?, ?, NOW())
         ON CONFLICT(sticker_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor, actualizado_en = NOW()`,
        [id, funcion, valor]
      );
    } else if (actual.destino) {
      await run('DELETE FROM destinos WHERE sticker_id = ?', [id]);
    }
    await registrarEventoAdmin(id, 'edicion_forzada', {
      antes,
      despues,
      motivo: String(req.body?.motivo || '').trim() || 'prueba forzada',
    });

    res.json({ ok: true, antes, despues, sticker: await snapshot(id) });
  });
}
