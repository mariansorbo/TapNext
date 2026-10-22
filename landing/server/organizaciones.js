// Organizaciones: cuenta de empresa. Es una cuenta de comprador común (entra a
// Mi panel con su mail, tiene sus productos) que el admin marca como
// organización. Lo que cambia: la pantalla del tap de TODOS sus productos dice
// NextTap + el nombre de la organización y muestra la imagen que la organización carga desde
// Mi panel (ver orgBloque en index.js).
//
// Comprador (Mi panel):
//   PATCH  /api/me/organizacion          { nombre?, colorFondo? }
//   PUT    /api/me/organizacion/imagen   cuerpo = la imagen (image/webp|jpeg|png);
//                                        ?color=#rrggbb = fondo de la pantalla
//                                        (el color mayoritario del logo, lo calcula el editor)
//                                        ?borde=#rrggbb = color del borde de la imagen ya
//                                        encuadrada (si es igual al fondo, el cuadro va sin sombra)
//   DELETE /api/me/organizacion/imagen
// Público:
//   GET    /api/org/imagen/:ver          la imagen, cacheable para siempre
//   (el tap la pide como /v/<código>?logo=<ver>, mismo origen que la pantalla)
//   GET    /api/me/organizacion/llaveros                    → los llaveros de la empresa, con
//                                                           el destino, mail y teléfono de quien lo activó
//   POST   /api/me/organizacion/llaveros/:codigo/desactivar → deja de llevar al contacto
//   POST   /api/me/organizacion/llaveros/:codigo/reactivar
//   POST   /api/me/organizacion/llaveros/:codigo/resetear   → borra a la persona y su contacto:
//                                                           queda listo para que lo active otra
// Admin:
//   GET    /api/admin/organizaciones
//   POST   /api/admin/organizaciones     { email, nombre } → convierte (o crea) la cuenta
//   PATCH  /api/admin/organizaciones/:id { nombre }
//   DELETE /api/admin/organizaciones/:id → vuelve a ser cuenta común
//   POST   /api/admin/organizaciones/:id/llaveros { codigos } → asigna llaveros (código público
//                                        o UID, separados por espacio/coma/renglón) a la empresa
//   DELETE /api/admin/organizaciones/:id/llaveros/:codigo     → lo desasigna
//
// Llaveros de la empresa (organizacion_stickers): qué empresa "es dueña" de un
// llavero es independiente de quién lo activó. La empresa los compra y los
// reparte; cada persona activa el suyo gratis con su cuenta y su contacto, y la
// pantalla del tap igual muestra la marca de la empresa. Desde Mi panel la
// empresa ve todos sus llaveros y puede desactivarlos o resetearlos.
//
// La imagen llega ya recortada por el navegador (editor de Mi panel: cuadrada,
// 1080 px, WebP o JPEG). Acá solo se valida que sea una imagen de verdad y de
// tamaño razonable, y se guarda en la base (una por organización).

import express from 'express';
import { createHash } from 'node:crypto';
import { db } from './db.js';

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS organizaciones (
    comprador_id INTEGER PRIMARY KEY REFERENCES compradores(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    imagen BYTEA,
    imagen_tipo TEXT,
    imagen_ver TEXT,                       -- hash del contenido: va en la URL pública
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_organizaciones_imagen_ver
    ON organizaciones(imagen_ver) WHERE imagen_ver IS NOT NULL;
  -- Fondo de la pantalla del tap (#rrggbb). NULL = el negro de NextTap.
  ALTER TABLE organizaciones ADD COLUMN IF NOT EXISTS color_fondo TEXT;
  -- Color del borde de la imagen ya encuadrada: si coincide con el fondo, la
  -- imagen se funde con la pantalla y el cuadro va sin sombra.
  ALTER TABLE organizaciones ADD COLUMN IF NOT EXISTS color_borde TEXT;

  CREATE TABLE IF NOT EXISTS organizacion_stickers (
    sticker_id INTEGER PRIMARY KEY REFERENCES stickers(id) ON DELETE CASCADE,
    organizacion_id INTEGER NOT NULL REFERENCES organizaciones(comprador_id) ON DELETE CASCADE,
    asignado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    desactivado_en TIMESTAMPTZ             -- no NULL = la empresa lo desactivó: el tap no lleva al contacto
  );
  CREATE INDEX IF NOT EXISTS idx_org_stickers_org ON organizacion_stickers(organizacion_id);
`);

// Los productos que ya estaban a nombre de una cuenta de empresa (modelo
// anterior: la marca salía del dueño) pasan a ser llaveros de esa empresa.
// RETURNING sticker_id explícito: la tabla no tiene id y el shim de db.js le
// agregaría RETURNING id a cualquier INSERT que no traiga uno.
await db.execute(
  `INSERT INTO organizacion_stickers (sticker_id, organizacion_id)
   SELECT s.id, o.comprador_id FROM stickers_actual s JOIN organizaciones o ON o.comprador_id = s.comprador_id
   ON CONFLICT (sticker_id) DO NOTHING RETURNING sticker_id`
);

export const ORG_NOMBRE_MAX = 40;
const IMAGEN_MAX_BYTES = 1_500_000;

const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

function limpiarNombre(crudo) {
  const nombre = String(crudo ?? '').replace(/\s+/g, ' ').trim();
  if (!nombre) return { error: 'Poné el nombre de la organización.' };
  if (nombre.length > ORG_NOMBRE_MAX) return { error: `El nombre puede tener hasta ${ORG_NOMBRE_MAX} letras.` };
  return { nombre };
}

// '#AbC123' → '#abc123'; cualquier otra cosa → null (sin color = fondo de marca).
export function colorValido(crudo) {
  const c = String(crudo ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) ? c : null;
}

// El tipo sale de los primeros bytes, no del Content-Type que manda el
// navegador: así no se cuela nada que no sea una imagen.
function tipoDeImagen(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// URL de la imagen relativa a la API (Mi panel y admin le anteponen API_BASE).
const urlImagen = (ver) => (ver ? `/api/org/imagen/${ver}` : null);

export async function organizacionDe(compradorId) {
  const [o] = await q(
    'SELECT nombre, imagen_ver, color_fondo, color_borde FROM organizaciones WHERE comprador_id = ?',
    [compradorId]
  );
  return o
    ? { nombre: o.nombre, imagenUrl: urlImagen(o.imagen_ver), colorFondo: o.color_fondo, colorBorde: o.color_borde }
    : null;
}

// Manda la imagen por su versión. Inmutable: si la organización sube otra,
// cambia el hash y por lo tanto la URL.
export async function enviarImagenOrg(res, ver) {
  if (!/^[a-f0-9]{16}$/.test(String(ver))) return res.status(404).end();
  const [o] = await q('SELECT imagen, imagen_tipo FROM organizaciones WHERE imagen_ver = ?', [ver]);
  if (!o?.imagen) return res.status(404).end();
  res.set({
    'Content-Type': o.imagen_tipo,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.send(o.imagen);
}

// Estado de un llavero para la empresa: desactivado (lo apagó la empresa),
// activo (alguien lo activó) o sin_activar (todavía nadie lo usó).
const estadoLlavero = (f) => (f.desactivado_en ? 'desactivado' : f.estado === 'activo' ? 'activo' : 'sin_activar');

// Separa una lista pegada de códigos (espacios, comas, renglones).
const listaCodigos = (texto) => [
  ...new Set(
    String(texto ?? '')
      .split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean)
  ),
];

// deps.resetearSticker(sticker, motivo) → { status, body }: lo arma index.js con
// la reescritura maestra (borra persona, contacto y venta; queda activable gratis).
export function crearOrganizacionesRouter({ requireAuth, resetearSticker }) {
  const r = express.Router();

  r.get('/org/imagen/:ver', (req, res) => enviarImagenOrg(res, req.params.ver));

  async function requireOrg(req, res, next) {
    const [o] = await q('SELECT comprador_id FROM organizaciones WHERE comprador_id = ?', [req.comprador.id]);
    if (!o) return res.status(403).json({ error: 'Tu cuenta no es de una organización.' });
    next();
  }

  // Cambia lo que venga: el nombre y/o el color de fondo.
  r.patch('/me/organizacion', requireAuth, requireOrg, async (req, res) => {
    const body = req.body || {};
    if ('nombre' in body) {
      const { nombre, error } = limpiarNombre(body.nombre);
      if (error) return res.status(400).json({ error });
      await q('UPDATE organizaciones SET nombre = ?, actualizada_en = NOW() WHERE comprador_id = ?', [
        nombre,
        req.comprador.id,
      ]);
    }
    if ('colorFondo' in body) {
      const color = colorValido(body.colorFondo);
      if (body.colorFondo && !color) return res.status(400).json({ error: 'Color inválido.' });
      await q('UPDATE organizaciones SET color_fondo = ?, actualizada_en = NOW() WHERE comprador_id = ?', [
        color,
        req.comprador.id,
      ]);
    }
    res.json({ organizacion: await organizacionDe(req.comprador.id) });
  });

  r.put(
    '/me/organizacion/imagen',
    requireAuth,
    requireOrg,
    express.raw({ type: () => true, limit: IMAGEN_MAX_BYTES }),
    async (req, res) => {
      const tipo = tipoDeImagen(req.body);
      if (!tipo) return res.status(400).json({ error: 'El archivo no es una imagen JPG, PNG o WebP.' });
      const ver = createHash('sha256').update(req.body).digest('hex').slice(0, 16);
      // Imagen nueva → fondo nuevo, el que calculó el editor (?color= vacío =
      // logo sin color dominante → negro de marca). Sin ?color, queda el que había.
      const conColor = req.query.color !== undefined;
      await q(
        `UPDATE organizaciones SET imagen = ?, imagen_tipo = ?, imagen_ver = ?,
                color_fondo = CASE WHEN ? THEN ? ELSE color_fondo END,
                color_borde = ?, actualizada_en = NOW()
          WHERE comprador_id = ?`,
        [req.body, tipo, ver, conColor, colorValido(req.query.color), colorValido(req.query.borde), req.comprador.id]
      );
      res.json({ organizacion: await organizacionDe(req.comprador.id) });
    }
  );

  r.delete('/me/organizacion/imagen', requireAuth, requireOrg, async (req, res) => {
    await q(
      `UPDATE organizaciones SET imagen = NULL, imagen_tipo = NULL, imagen_ver = NULL, color_fondo = NULL,
                color_borde = NULL, actualizada_en = NOW()
        WHERE comprador_id = ?`,
      [req.comprador.id]
    );
    res.json({ organizacion: await organizacionDe(req.comprador.id) });
  });

  // --- Llaveros de la empresa ---
  r.get('/me/organizacion/llaveros', requireAuth, requireOrg, async (req, res) => {
    const filas = await q(
      `SELECT s.codigo_publico, s.modelo, s.funcion, s.estado, s.comprador_id, s.vigente_desde,
              os.desactivado_en, d.tipo AS destino_tipo, d.valor AS destino_valor, c.email, c.whatsapp
         FROM organizacion_stickers os
         JOIN stickers_actual s ON s.id = os.sticker_id
         LEFT JOIN destinos d ON d.sticker_id = s.id
         LEFT JOIN compradores c ON c.id = s.comprador_id
        WHERE os.organizacion_id = ?
        ORDER BY (s.estado = 'activo') DESC, s.codigo_publico`,
      [req.comprador.id]
    );
    res.json({
      llaveros: filas.map((f) => {
        // La persona es quien lo activó; si sigue a nombre de la empresa, no hay persona.
        const persona = f.comprador_id && f.comprador_id !== req.comprador.id;
        return {
          codigo: f.codigo_publico,
          modelo: f.modelo,
          funcion: f.funcion,
          estado: estadoLlavero(f),
          destino: f.destino_tipo ? { tipo: f.destino_tipo, valor: f.destino_valor } : null,
          email: persona ? f.email : null,
          telefono: persona ? f.whatsapp : null,
          desde: f.estado === 'activo' ? f.vigente_desde : null,
        };
      }),
    });
  });

  // Llavero de ESTA empresa (si no, 404: no se puede tocar uno ajeno).
  async function llaveroDeLaOrg(req, res) {
    const [s] = await q(
      `SELECT s.*, os.desactivado_en FROM organizacion_stickers os JOIN stickers_actual s ON s.id = os.sticker_id
        WHERE os.organizacion_id = ? AND s.codigo_publico = ?`,
      [req.comprador.id, req.params.codigo]
    );
    if (!s) res.status(404).json({ error: 'Ese llavero no es de tu empresa.' });
    return s || null;
  }

  r.post('/me/organizacion/llaveros/:codigo/desactivar', requireAuth, requireOrg, async (req, res) => {
    const s = await llaveroDeLaOrg(req, res);
    if (!s) return;
    await q('UPDATE organizacion_stickers SET desactivado_en = COALESCE(desactivado_en, NOW()) WHERE sticker_id = ?', [
      s.id,
    ]);
    res.json({ ok: true, estado: 'desactivado' });
  });

  r.post('/me/organizacion/llaveros/:codigo/reactivar', requireAuth, requireOrg, async (req, res) => {
    const s = await llaveroDeLaOrg(req, res);
    if (!s) return;
    await q('UPDATE organizacion_stickers SET desactivado_en = NULL WHERE sticker_id = ?', [s.id]);
    res.json({ ok: true, estado: s.estado === 'activo' ? 'activo' : 'sin_activar' });
  });

  r.post('/me/organizacion/llaveros/:codigo/resetear', requireAuth, requireOrg, async (req, res) => {
    const s = await llaveroDeLaOrg(req, res);
    if (!s) return;
    const [org] = await q('SELECT nombre FROM organizaciones WHERE comprador_id = ?', [req.comprador.id]);
    const { status, body } = await resetearSticker(s, `Reseteado por la empresa ${org?.nombre || ''}`.trim());
    if (status >= 400) return res.status(status).json(body);
    await q('UPDATE organizacion_stickers SET desactivado_en = NULL WHERE sticker_id = ?', [s.id]);
    res.json({ ok: true, estado: 'sin_activar' });
  });

  // Imagen más grande que el tope: express.raw tira 413 — lo devolvemos en
  // castellano (el editor ya achica, esto es por si alguien llama a mano).
  r.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'La imagen es muy pesada (máximo 1,5 MB).' });
    }
    next(err);
  });

  return r;
}

// deps.liberarGratis(sticker, motivo) → { status, body }: lo arma index.js con
// la activación liberada gratis (así cada persona activa el suyo sin pagar).
export function crearOrganizacionesAdminRouter({ liberarGratis } = {}) {
  const r = express.Router();

  r.get('/organizaciones', async (req, res) => {
    const filas = await q(
      `SELECT o.comprador_id, o.nombre, o.imagen_ver, o.creada_en, c.email,
              (SELECT COUNT(*) FROM organizacion_stickers os WHERE os.organizacion_id = o.comprador_id) AS productos,
              (SELECT COUNT(*) FROM organizacion_stickers os JOIN stickers_actual s ON s.id = os.sticker_id
                WHERE os.organizacion_id = o.comprador_id AND s.estado = 'activo') AS activos
         FROM organizaciones o JOIN compradores c ON c.id = o.comprador_id
        ORDER BY o.creada_en DESC`
    );
    res.json(
      filas.map((o) => ({
        compradorId: o.comprador_id,
        nombre: o.nombre,
        email: o.email,
        imagenUrl: urlImagen(o.imagen_ver),
        productos: Number(o.productos),
        activos: Number(o.activos),
        creadaEn: o.creada_en,
      }))
    );
  });

  // Convierte en organización la cuenta de ese mail. Si todavía no existe (la
  // empresa no compró nada), se crea: después entra a Mi panel con el código.
  r.post('/organizaciones', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Mail inválido.' });
    const { nombre, error } = limpiarNombre(req.body?.nombre);
    if (error) return res.status(400).json({ error });

    let [c] = await q('SELECT id FROM compradores WHERE LOWER(email) = ?', [email]);
    if (!c) [c] = await q('INSERT INTO compradores (email) VALUES (?) RETURNING id', [email]);
    await q(
      `INSERT INTO organizaciones (comprador_id, nombre) VALUES (?, ?)
       ON CONFLICT (comprador_id) DO UPDATE SET nombre = EXCLUDED.nombre, actualizada_en = NOW()
       RETURNING comprador_id`,
      [c.id, nombre]
    );
    res.json({ ok: true, compradorId: c.id });
  });

  r.patch('/organizaciones/:id', async (req, res) => {
    const { nombre, error } = limpiarNombre(req.body?.nombre);
    if (error) return res.status(400).json({ error });
    await q('UPDATE organizaciones SET nombre = ?, actualizada_en = NOW() WHERE comprador_id = ?', [
      nombre,
      Number(req.params.id),
    ]);
    res.json({ ok: true });
  });

  // Asigna llaveros a la empresa. Los que todavía no se vendieron quedan con
  // activación liberada gratis: la empresa los reparte y cada persona activa el suyo.
  r.post('/organizaciones/:id/llaveros', async (req, res) => {
    const orgId = Number(req.params.id);
    const [org] = await q('SELECT nombre FROM organizaciones WHERE comprador_id = ?', [orgId]);
    if (!org) return res.status(404).json({ error: 'Esa organización no existe.' });
    const codigos = listaCodigos(req.body?.codigos);
    if (!codigos.length) return res.status(400).json({ error: 'Pegá al menos un código.' });

    const resultado = { asignados: [], liberados: [], noEncontrados: [], deOtraEmpresa: [] };
    for (const codigo of codigos) {
      const [s] = await q(
        'SELECT * FROM stickers_actual WHERE codigo_publico = ? OR UPPER(uid_nfc) = UPPER(?) LIMIT 1',
        [codigo, codigo]
      );
      if (!s) {
        resultado.noEncontrados.push(codigo);
        continue;
      }
      const [ya] = await q('SELECT organizacion_id FROM organizacion_stickers WHERE sticker_id = ?', [s.id]);
      if (ya && ya.organizacion_id !== orgId) {
        resultado.deOtraEmpresa.push(s.codigo_publico);
        continue;
      }
      await q(
        `INSERT INTO organizacion_stickers (sticker_id, organizacion_id) VALUES (?, ?)
         ON CONFLICT (sticker_id) DO NOTHING RETURNING sticker_id`,
        [s.id, orgId]
      );
      resultado.asignados.push(s.codigo_publico);
      if (s.estado === 'en_stock' && liberarGratis) {
        const { status } = await liberarGratis(s, `Regalo de la empresa ${org.nombre}`);
        if (status < 400) resultado.liberados.push(s.codigo_publico);
      }
    }
    res.json(resultado);
  });

  r.delete('/organizaciones/:id/llaveros/:codigo', async (req, res) => {
    await q(
      `DELETE FROM organizacion_stickers WHERE organizacion_id = ?
         AND sticker_id = (SELECT id FROM stickers WHERE codigo_publico = ?)`,
      [Number(req.params.id), req.params.codigo]
    );
    res.status(204).end();
  });

  r.delete('/organizaciones/:id', async (req, res) => {
    await q('DELETE FROM organizaciones WHERE comprador_id = ?', [Number(req.params.id)]);
    res.status(204).end();
  });

  return r;
}
