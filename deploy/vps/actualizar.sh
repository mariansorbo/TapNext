#!/usr/bin/env bash
# Deploy de una versión nueva en el VPS (reemplaza al auto-deploy de Render).
# En el VPS, como root:  bash /srv/nexttap/deploy/vps/actualizar.sh
set -euo pipefail
cd /srv/nexttap
sudo -u nexttap git pull --ff-only
cd landing && sudo -u nexttap npm ci --omit=dev
systemctl restart nexttap
sleep 2
curl -fsS http://127.0.0.1:3001/api/health && echo "  ← backend arriba"
