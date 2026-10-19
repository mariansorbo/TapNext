// Organizaciones: cuenta de empresa. Es una cuenta de comprador común (entra a
// Mi panel con su mail, tiene sus productos) que el admin marca como
// organización. Lo que cambia: la pantalla del tap de TODOS sus productos dice
// "NextTap by <nombre>" y muestra la imagen que la organización carga desde
// Mi panel (ver orgBloque en index.js).
//
// Comprador (Mi panel):
//   PATCH  /api/me/organizacion          { nombre?, colorFondo? }
//   PUT    /api/me/organizacion/imagen   cuerpo = la imagen (image/webp|jpeg|png);
//                                        ?color=#rrggbb = fondo de la pantalla
//                                        (el color mayoritario del logo, lo calcula el editor)
//   DELETE /api/me/organizacion/imagen
// Público:
//   GET    /api/org/imagen/:ver          la imagen, cacheable para siempre
//   (el tap la pide como /v/<código>?logo=<ver>, mismo origen que la pantalla)
// Admin:
//   GET    /api/admin/organizaciones
//   POST   /api/admin/organizaciones     { email, nombre } → convierte (o crea) la cuenta
//   PATCH  /api/admin/organizaciones/:id { nombre }
//   DELETE /api/admin/organizaciones/:id → vuelve a ser cuenta común
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
`);

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
  const [o] = await q('SELECT nombre, imagen_ver, color_fondo FROM organizaciones WHERE comprador_id = ?', [
    compradorId,
  ]);
  return o ? { nombre: o.nombre, imagenUrl: urlImagen(o.imagen_ver), colorFondo: o.color_fondo } : null;
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

export function crearOrganizacionesRouter({ requireAuth }) {
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
                color_fondo = CASE WHEN ? THEN ? ELSE color_fondo END, actualizada_en = NOW()
          WHERE comprador_id = ?`,
        [req.body, tipo, ver, conColor, colorValido(req.query.color), req.comprador.id]
      );
      res.json({ organizacion: await organizacionDe(req.comprador.id) });
    }
  );

  r.delete('/me/organizacion/imagen', requireAuth, requireOrg, async (req, res) => {
    await q(
      `UPDATE organizaciones SET imagen = NULL, imagen_tipo = NULL, imagen_ver = NULL, color_fondo = NULL,
                actualizada_en = NOW()
        WHERE comprador_id = ?`,
      [req.comprador.id]
    );
    res.json({ organizacion: await organizacionDe(req.comprador.id) });
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

export function crearOrganizacionesAdminRouter() {
  const r = express.Router();

  r.get('/organizaciones', async (req, res) => {
    const filas = await q(
      `SELECT o.comprador_id, o.nombre, o.imagen_ver, o.creada_en, c.email,
              (SELECT COUNT(*) FROM stickers_actual s WHERE s.comprador_id = o.comprador_id) AS productos
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

  r.delete('/organizaciones/:id', async (req, res) => {
    await q('DELETE FROM organizaciones WHERE comprador_id = ?', [Number(req.params.id)]);
    res.status(204).end();
  });

  return r;
}
