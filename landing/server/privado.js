// Páginas internas (panel admin y panel vendedor): el HTML y el JS no se
// entregan sin sesión. Antes salían del hosting estático como cualquier página
// y con "Ver código fuente" se leía todo el back-office (ciclo del inventario,
// comisiones, integraciones), aunque la API estuviera protegida.
//
// Cómo funciona:
//   - vercel.json reescribe /admin.html, /vendedor.html y /privado/* a este
//     router, así el navegador sigue en el dominio del sitio (la cookie es de
//     primera parte).
//   - GET /privado/<rol>: con la cookie de una sesión vigente entrega la página
//     real; sin ella, una pantalla de acceso que no cuenta nada del panel.
//   - POST /privado/entrar/<rol>: hace el login de siempre (/api/<rol>/login),
//     y si sale bien deja la cookie y devuelve el token, que el panel guarda en
//     sessionStorage como antes.
//   - GET /privado/<rol>/a/*: el JS y el CSS del panel, también con cookie. Cada
//     rol tiene su propio build (npm run build:privado), así que un vendedor no
//     puede bajar el bundle del admin.
//
// El build sale en server/privado/<rol>/ y se commitea (el VPS hace git pull
// sin compilar nada).

import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), 'privado');

const ROLES = {
  admin: {
    cookie: 'tap_priv_admin',
    tabla: 'admin_sesiones',
    clave: 'tap_admin_token',
    campos: [{ id: 'password', tipo: 'password', texto: 'Contraseña' }],
  },
  vendedor: {
    cookie: 'tap_priv_vendedor',
    tabla: 'vendedor_sesiones',
    clave: 'tap_vendedor_token',
    campos: [
      { id: 'identificador', tipo: 'text', texto: 'Email o WhatsApp' },
      { id: 'password', tipo: 'password', texto: 'Contraseña' },
    ],
  },
};

function leerCookie(req, nombre) {
  const raw = req.headers.cookie || '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Pantalla de acceso: nada del nombre del panel ni de lo que hace.
function paginaAcceso(rol) {
  const { campos, clave } = ROLES[rol];
  const config = JSON.stringify({ rol, clave, campos }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow"><title>Acceso</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14171A;color:#EDEFE9;font:16px Inter,system-ui,sans-serif}
form{width:min(320px,86vw);display:grid;gap:12px}
input,button{font:inherit;padding:12px 14px;border-radius:10px;border:1px solid rgba(237,239,233,.18);background:#22272C;color:inherit}
button{background:#7B5CFF;border-color:#7B5CFF;color:#fff;cursor:pointer}
p{margin:0;min-height:1.2em;font-size:14px;color:#ff8a8a}
</style></head><body>
<form id="f">${campos.map((c) => `<input id="${c.id}" type="${c.tipo}" placeholder="${c.texto}" autocomplete="${c.tipo === 'password' ? 'current-password' : 'username'}" required>`).join('')}
<button type="submit">Entrar</button><p id="e" role="status"></p></form>
<script>
const C = ${config};
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const e = document.getElementById('e');
  e.textContent = '';
  const body = {};
  for (const c of C.campos) body[c.id] = document.getElementById(c.id).value;
  try {
    const r = await fetch('/privado/entrar/' + C.rol, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) { e.textContent = d.error || 'No se pudo entrar.'; return; }
    sessionStorage.setItem(C.clave, d.token);
    location.reload();
  } catch { e.textContent = 'No se pudo entrar.'; }
});
</script></body></html>`;
}

export function crearPrivadoRouter({ get, hashValue, puerto }) {
  const router = express.Router();

  const sesionVigente = async (rol, req) => {
    const token = leerCookie(req, ROLES[rol].cookie);
    if (!token) return false;
    const fila = await get(`SELECT id FROM ${ROLES[rol].tabla} WHERE token_hash = ? AND expira > NOW()`, [hashValue(token)]);
    return Boolean(fila);
  };

  // Nada de esto se cachea (ni en el navegador ni en el proxy del hosting).
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Robots-Tag': 'noindex, nofollow' });
    next();
  });

  const exigirRol = (req, res, next) => (ROLES[req.params.rol] ? next() : res.status(404).end());

  router.post('/entrar/:rol', exigirRol, express.json(), async (req, res) => {
    const { rol } = req.params;
    try {
      // Reusa el login real (topes de intentos, hash relleno, etc.); el IP del
      // cliente viaja en X-Forwarded-For para que los topes no se junten todos en 127.0.0.1.
      const r = await fetch(`http://127.0.0.1:${puerto}/api/${rol}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': req.ip || '' },
        body: JSON.stringify(req.body || {}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.token) {
        return res.status(r.status === 429 ? 429 : 401).json({ error: data.error || 'No se pudo entrar.' });
      }
      res.cookie(ROLES[rol].cookie, data.token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
      res.json({ token: data.token });
    } catch {
      res.status(502).json({ error: 'No se pudo entrar.' });
    }
  });

  router.delete('/sesion/:rol', exigirRol, (req, res) => {
    res.clearCookie(ROLES[req.params.rol].cookie, { path: '/' });
    res.status(204).end();
  });

  // JS/CSS del panel: solo con sesión del mismo rol.
  router.use('/:rol/a', exigirRol, async (req, res, next) => {
    if (!(await sesionVigente(req.params.rol, req))) return res.status(404).end();
    express.static(join(RAIZ, req.params.rol, 'a'), { index: false, fallthrough: false })(req, res, next);
  });

  router.get('/:rol', exigirRol, async (req, res) => {
    const { rol } = req.params;
    if (!(await sesionVigente(rol, req))) return res.type('html').send(paginaAcceso(rol));
    try {
      res.type('html').send(readFileSync(join(RAIZ, rol, `${rol}.html`), 'utf8'));
    } catch {
      res.status(503).type('text').send('Panel no compilado: correr npm run build:privado.');
    }
  });

  return router;
}
