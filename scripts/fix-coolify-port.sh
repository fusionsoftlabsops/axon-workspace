#!/usr/bin/env bash
# ============================================================
# Fix: cambiar el puerto de Coolify del default :8000 a otro
# (porque :8000 lo usa otro huésped, como el FastAPI/Ollama).
#
# Asume que el install oficial ya corrió y los archivos están
# en /data/coolify/source/. Solo recrea los containers con el
# nuevo APP_PORT.
#
# USO: APP_PORT=9000 sudo bash fix-coolify-port.sh
# o:   sudo bash fix-coolify-port.sh  (default 9000)
# ============================================================

set -euo pipefail

APP_PORT=${APP_PORT:-9000}

log() { printf '\n\033[1;36m[fix-coolify] %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m[fix-coolify ERROR] %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || fail "este script requiere sudo. corré: sudo bash $0"

[[ -d /data/coolify/source ]] || fail "/data/coolify/source no existe — Coolify no está instalado"

ENV_FILE=/data/coolify/source/.env
[[ -f "$ENV_FILE" ]] || fail "$ENV_FILE no existe"

log "1/4 — Asegurando APP_PORT=$APP_PORT en $ENV_FILE"

if grep -qE '^APP_PORT=' "$ENV_FILE"; then
  # Ya existe — reemplazar
  sed -i "s|^APP_PORT=.*|APP_PORT=${APP_PORT}|" "$ENV_FILE"
  log "  APP_PORT existente reemplazado"
else
  # No existe — agregar
  echo "APP_PORT=${APP_PORT}" >> "$ENV_FILE"
  log "  APP_PORT agregado al final"
fi

log "Valor actual: $(grep '^APP_PORT=' "$ENV_FILE")"

log "2/4 — Verificando que el puerto :$APP_PORT esté libre"
if ss -tlnp 2>/dev/null | grep -qE ":${APP_PORT}\s"; then
  port_owner=$(ss -tlnp | grep ":${APP_PORT}" | head -1)
  fail "puerto $APP_PORT ya ocupado: $port_owner"
fi

log "3/4 — docker compose down + up con la nueva config"
cd /data/coolify/source
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

log "4/4 — Esperando hasta 60s a que coolify esté healthy"
deadline=$(( $(date +%s) + 60 ))
last_status="unknown"
while [[ $(date +%s) -lt $deadline ]]; do
  last_status=$(docker inspect coolify --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  if [[ "$last_status" == "healthy" ]]; then
    log "OK — coolify healthy"
    break
  fi
  sleep 3
done

echo ""
echo "═══ Estado final ═══"
docker ps --filter 'name=coolify' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo ""

if [[ "$last_status" != "healthy" ]]; then
  echo "⚠  coolify aún no healthy (status: $last_status). Logs:"
  docker logs coolify 2>&1 | tail -15
  exit 1
fi

echo "✓ Dashboard accesible en http://localhost:${APP_PORT} (desde el túnel SSH)"
