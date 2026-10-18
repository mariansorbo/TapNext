# Backend + base en un VPS de São Paulo

Objetivo: que el tap responda rápido desde Argentina. El backend y Postgres
corren en **la misma máquina en São Paulo** (~30–40 ms de Buenos Aires; la base
a <1 ms del backend). Reemplaza a Render (Oregón) + Neon (São Paulo).

Cada paso se valida con `landing/scripts/bench-tap.mjs` (ver "Medir").

## 0. Medir (antes y después de cada paso)

Desde la PC, en `landing/`:

```
node scripts/bench-tap.mjs 01-render-neon --codigo <codigo_publico de un sticker activo>
node scripts/bench-tap.mjs --comparar
```

`--api https://api.next-tap.tech` cuando el backend ya esté en el VPS.

## 1. Crear el VPS (lo hace Mariano)

- Vultr → Deploy → Cloud Compute (Shared CPU) → **São Paulo** → **Ubuntu 24.04**
  → plan de 1 GB RAM (~US$5–6/mes). Cargar la clave SSH pública de la PC.
- Anotar la IP.

## 2. DNS

Registro **A** `api.next-tap.tech` → IP del VPS (donde se maneja el DNS de
next-tap.tech). Esperar a que resuelva antes del paso 3 (Caddy saca el
certificado HTTPS solo, pero necesita que el dominio ya apunte).

## 3. Preparar el VPS

```
scp deploy/vps/setup-vps.sh root@<IP>:
ssh root@<IP> bash setup-vps.sh api.next-tap.tech
```

Imprime una **deploy key**: agregarla en GitHub → TapNext → Settings → Deploy
keys (solo lectura). Después:

```
ssh root@<IP>
sudo -u nexttap git clone git@github.com:mariansorbo/TapNext.git /srv/nexttap
cd /srv/nexttap/landing && sudo -u nexttap npm ci --omit=dev
```

## 4. `.env` del VPS

`/srv/nexttap/landing/.env` (dueño `nexttap`, `chmod 600`): **copiar todas las
variables de Render** (Dashboard → tapnext → Environment), con estos cambios:

| Variable | Valor en el VPS |
|---|---|
| `DATABASE_URL` | la de `/root/database_url.txt` |
| `API_PUBLIC_URL` | `https://api.next-tap.tech` (webhook de Mercado Pago) |
| `RENDER_EXTERNAL_URL` | **no ponerla** (pisa a `API_PUBLIC_URL`) |
| `PORT` / `NODE_ENV` | no hace falta: los pone el servicio |

## 5. Corte (≈10 min, de noche)

1. Render → tapnext → **Suspend** (que nadie escriba en Neon durante la copia).
2. En el VPS: `bash /srv/nexttap/deploy/vps/migrar-base.sh '<DATABASE_URL de Neon>'`
   — baja Neon, la restaura local, compara filas tabla por tabla y arranca la app.
3. `curl https://api.next-tap.tech/api/health`
4. Repo: apuntar el frontend al VPS y pushear (Vercel redeploya):
   - `landing/vercel.json`: los 3 rewrites `tapnext.onrender.com` → `api.next-tap.tech`
   - `landing/activacion.html`: `ROUTER_BASE`
   - Vercel → Environment: `VITE_API_BASE` = `https://api.next-tap.tech` (y redeploy)
5. Afuera del repo:
   - Google Cloud → OAuth → URI de redirección autorizada nueva (si
     `GOOGLE_REDIRECT_URI` apuntaba a onrender) y actualizar la variable.
   - Webhooks configurados a mano en paneles (Mercado Pago "Notificaciones",
     Enviopack) si apuntaban a onrender. Los pagos nuevos ya mandan
     `notification_url` con `API_PUBLIC_URL`.
6. Tapear un llavero real y medir: `node scripts/bench-tap.mjs 03-vps-sao-paulo --codigo ... --api https://api.next-tap.tech`

## 6. Después

- Sacar el keep-alive: `Documents/NextTap/scripts/keepalive/desinstalar.ps1` y
  `.github/workflows/keep-alive.yml` (el VPS no se duerme).
- Una semana andando bien → borrar el servicio de Render y el proyecto de Neon
  (antes, bajar un último dump de Neon por las dudas).
- Deploys: `ssh root@<IP> bash /srv/nexttap/deploy/vps/actualizar.sh`
- Backups: `/var/backups/nexttap/` (diario, 14 días). Conviene copiarlos fuera
  del VPS de vez en cuando.
