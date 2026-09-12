#!/usr/bin/env bash
# One-shot deploy to a public Linux server over SSH (Ubuntu/Debian with Docker installed).
#
#   ./scripts/deploy-vps.sh user@server.example.com bingo.example.com
#
# What it does: syncs this checkout to /opt/tg-bingo on the host (node_modules, dist and
# .git excluded), writes the production .env there if it does not exist yet (you are asked
# for the bot token and an admin token; the Postgres password is generated), then runs
# `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`.
# Re-run after every change; Compose rebuilds only what changed. Prerequisites on the host:
# Docker Engine + Compose plugin, ports 80/443 open, DNS A record for the domain -> host.
set -euo pipefail

HOST="${1:?usage: deploy-vps.sh user@host domain}"
DOMAIN="${2:?usage: deploy-vps.sh user@host domain}"
REMOTE_DIR="${REMOTE_DIR:-/opt/tg-bingo}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ checking Docker on $HOST"
if ! ssh "$HOST" "command -v docker >/dev/null && docker compose version >/dev/null 2>&1"; then
  echo "→ Docker Engine + Compose plugin not found; installing with the official script (get.docker.com)"
  ssh "$HOST" "curl -fsSL https://get.docker.com | sh"
fi

echo "→ syncing $HERE to $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p '$REMOTE_DIR'"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude '.env' --exclude 'bot/data' \
  "$HERE/" "$HOST:$REMOTE_DIR/"

# Production env: created once, never overwritten (it holds the generated DB password).
if ! ssh "$HOST" "test -f '$REMOTE_DIR/.env'"; then
  # BOT_TOKEN / ADMIN_TOKEN may be passed as environment variables (non-interactive use);
  # otherwise they are asked for once.
  [ -n "${BOT_TOKEN:-}" ] || read -r -p "BOT_TOKEN (from @BotFather): " BOT_TOKEN
  [ -n "${ADMIN_TOKEN+x}" ] || read -r -p "ADMIN_TOKEN (any long random string; blank = admin dashboard disabled): " ADMIN_TOKEN
  PG_PASS="$(openssl rand -hex 24)"
  ssh "$HOST" "cat > '$REMOTE_DIR/.env' <<EOF
DOMAIN=$DOMAIN
BOT_TOKEN=$BOT_TOKEN
ADMIN_TOKEN=$ADMIN_TOKEN
POSTGRES_PASSWORD=$PG_PASS
EOF
chmod 600 '$REMOTE_DIR/.env'"
  echo "→ wrote $REMOTE_DIR/.env (keep it: it holds the database password)"
fi

echo "→ building and starting the stack on $HOST"
ssh "$HOST" "cd '$REMOTE_DIR' && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans"

echo "→ waiting for the server health check"
for i in $(seq 1 30); do
  if curl -fsS -m 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    echo "✓ live: https://$DOMAIN  (admin: https://$DOMAIN/api/admin/dashboard)"
    exit 0
  fi
  sleep 5
done
echo "Stack started but https://$DOMAIN/api/health is not answering yet."
echo "Check: ssh $HOST 'cd $REMOTE_DIR && docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail 50 caddy server'"
exit 1
