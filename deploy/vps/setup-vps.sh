#!/usr/bin/env bash
# Deja un VPS Ubuntu 24.04 recién creado listo para correr el backend de NextTap
# con Postgres en la misma máquina. Se corre UNA vez, como root:
#
#   curl -fsSL <raw de este archivo> | bash -s -- api.next-tap.tech
#   (o copiándolo con scp y: bash setup-vps.sh api.next-tap.tech)
#
# Instala: Node 24, Postgres 17, Caddy (HTTPS automático), firewall, swap,
# backup diario de la base, y el servicio systemd `nexttap`. El código y el
# .env se cargan después (ver README.md, pasos 3 y 4).
set -euo pipefail

DOMINIO="${1:?Uso: setup-vps.sh <dominio del backend, ej. api.next-tap.tech>}"
APP_USER=nexttap
APP_DIR=/srv/nexttap
DB_NAME=nexttap
DB_USER=nexttap

export DEBIAN_FRONTEND=noninteractive
timedatectl set-timezone America/Argentina/Buenos_Aires

echo "== Paquetes base"
apt-get update -y
apt-get install -y curl git ufw ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

echo "== Swap de 1 GB (la máquina chica tiene poca RAM para Node + Postgres)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Node 24"
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

echo "== Postgres 17 (repo oficial PGDG: pg_dump tiene que ser >= la versión de Neon)"
apt-get install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt-get install -y postgresql-17
# Postgres escucha solo en localhost (default): nadie de afuera llega a la base.

DB_PASS="$(openssl rand -hex 24)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"

echo "== Usuario y carpeta de la app"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" /var/backups/nexttap
chown -R "$APP_USER:$APP_USER" "$APP_DIR" /var/backups/nexttap

# Clave para que el VPS pueda clonar el repo privado (deploy key de solo lectura).
if [ ! -f "/home/$APP_USER/.ssh/id_ed25519" ]; then
  sudo -u "$APP_USER" ssh-keygen -t ed25519 -N '' -f "/home/$APP_USER/.ssh/id_ed25519" -C "nexttap-vps"
  sudo -u "$APP_USER" bash -c "ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null"
fi

# DATABASE_URL lista para pegar en el .env (local, sin SSL → db.js lo detecta).
echo "DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}" > /root/database_url.txt
chmod 600 /root/database_url.txt

echo "== Servicio systemd"
cat > /etc/systemd/system/nexttap.service <<UNIT
[Unit]
Description=NextTap backend
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=${APP_USER}
WorkingDirectory=${APP_DIR}/landing
EnvironmentFile=${APP_DIR}/landing/.env
Environment=NODE_ENV=production
Environment=PORT=3001
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

echo "== Caddy (HTTPS automático con Let's Encrypt)"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy
cat > /etc/caddy/Caddyfile <<CADDY
${DOMINIO} {
	encode gzip
	reverse_proxy 127.0.0.1:3001
}
CADDY
systemctl reload caddy || systemctl restart caddy

echo "== Firewall: solo SSH y web"
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

echo "== Backup diario de la base (03:30, guarda 14 días)"
cat > /etc/cron.d/nexttap-backup <<CRON
30 3 * * * postgres pg_dump -Fc ${DB_NAME} > /var/backups/nexttap/nexttap-\$(date +\%F).dump && find /var/backups/nexttap -name '*.dump' -mtime +14 -delete
CRON
chown postgres:postgres /var/backups/nexttap

echo
echo "================================================================"
echo " Listo. Falta:"
echo "  1. Agregar esta deploy key (solo lectura) en GitHub → TapNext → Settings → Deploy keys:"
echo
cat "/home/$APP_USER/.ssh/id_ed25519.pub"
echo
echo "  2. La DATABASE_URL local quedó en /root/database_url.txt"
echo "  3. Seguir con deploy/vps/README.md (clonar, .env, migrar base)."
echo "================================================================"
