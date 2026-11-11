// Editar sticker B2 — escritura de link + candado (PWD/PACK/AUTH0) desde la APK.
//
// La escritura física del chip la hace la APK "NextTap Chips" (NfcA nativo): Web
// NFC no puede mandar PWD_AUTH ni escribir PWD/PACK/AUTH0. Este módulo solo pone
// la parte del servidor:
//   - GET  /api/admin/b2/chip?uid=      → estado del chip en el sistema + claves
//   - POST /api/admin/b2/:id/resultado  → lo que pasó en el chip real (bitácora y
//                                         candado verificado por la APK)
// Las claves siguen siendo las derivadas de siempre (deriveChipPassword /
// deriveChipPack): los chips ya bloqueados desde el asistente o con NFC Tools
// se pueden reescribir sin cambiar nada.

const normUid = (u) => String(u || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();

export function montarConsolaB2(app, deps) {
  const { get, run, requireAdmin, registrarEventoAdmin, deriveChipPassword, deriveChipPack, CHIP_MASTER_SECRET, PUBLIC_ROUTER_BASE } = deps;

  // PWD de la NTAG21x = 4 bytes (8 hex) y PACK = 2 bytes (4 hex). deriveChipPassword
  // devuelve 16 hex; el software de programación usa los primeros 8.
  const claves = (uid) => ({
    pwd: deriveChipPassword(uid).slice(0, 8),
    pack: deriveChipPack(uid).slice(0, 4),
  });

  app.get('/api/admin/b2/chip', requireAdmin, async (req, res) => {
    if (!CHIP_MASTER_SECRET) {
      return res.status(503).json({ error: 'Configurá CHIP_MASTER_SECRET: sin eso no se pueden derivar las claves del chip.' });
    }
    const uid = normUid(req.query.uid);
    if (!uid) return res.status(400).json({ error: 'Falta el UID del chip.' });

    const s = await get(
      `SELECT id, codigo_publico, uid_nfc, protegido_en, estado, etapa, modelo, funcion
         FROM stickers_actual WHERE LOWER(uid_nfc) = ?`,
      [uid]
    );
    const base = { uid, ...claves(uid) };
    if (!s) return res.json({ ...base, registrado: false });
    res.json({
      ...base,
      registrado: true,
      id: s.id,
      codigoPublico: s.codigo_publico,
      urlSistema: `${PUBLIC_ROUTER_BASE}/v/${s.codigo_publico}`,
      estado: s.estado,
      etapa: s.etapa,
      modelo: s.modelo,
      funcion: s.funcion,
      protegidoEn: s.protegido_en,
    });
  });

  // La APK avisa qué hizo sobre el chip real. `bloqueo`: 'aplicado' (lo bloqueó
  // ahora), 'ya_estaba' (ya tenía candado con la clave derivada) o 'no' (no se
  // pidió / no se pudo). Solo con aplicado/ya_estaba se marca protegido_en.
  app.post('/api/admin/b2/:id/resultado', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const s = await get('SELECT id, protegido_en FROM stickers WHERE id = ?', [id]);
    if (!s) return res.status(404).json({ error: 'Sticker no encontrado.' });

    const url = String(req.body?.url || '').slice(0, 2000) || null;
    const urlAntes = String(req.body?.urlAntes || '').slice(0, 2000) || null;
    const bloqueo = ['aplicado', 'ya_estaba'].includes(req.body?.bloqueo) ? req.body.bloqueo : 'no';
    const motivo = String(req.body?.motivo || '').trim().slice(0, 300) || null;
    const chip = String(req.body?.chip || '').slice(0, 20) || null;

    const quedaProtegido = bloqueo !== 'no';
    if (quedaProtegido && !s.protegido_en) {
      await run('UPDATE stickers SET protegido_en = NOW() WHERE id = ?', [id]);
    }
    await registrarEventoAdmin(id, 'edicion_b2', {
      antes: { url: urlAntes, protegido: Boolean(s.protegido_en) },
      despues: { url, protegido: Boolean(s.protegido_en) || quedaProtegido, bloqueo, chip },
      motivo,
    });
    res.json({ ok: true });
  });
}
