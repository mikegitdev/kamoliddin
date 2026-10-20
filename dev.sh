#!/usr/bin/env bash
# One-command local development runner for the Local Advertising monorepo.
#
# Starts, in order:
#   1. Dev infrastructure from docker-compose.yml (PostGIS, Redis, Garage)
#      — waits for container healthchecks
#   2. Django backend  -> http://localhost:8000  (config.settings.dev)
#   3. Vite frontend   -> http://localhost:5173  (proxies /api and /media -> :8000)
#
# Backend modes (picked automatically):
#   - local : GeoDjango native libs (GDAL/GEOS) present -> .venv runserver (autoreload)
#   - docker: libs missing -> runs in the localads-backend:dev image on the
#             compose network, with backend/ bind-mounted so runserver
#             autoreload still works (README "No local GDAL?" fallback)
#
# Ctrl+C stops both dev servers. Containers keep running;
# stop them separately with `docker compose stop`.
#
# Notes:
#   - Migrations are applied automatically before the servers start (idempotent).
#   - Demo data is NOT seeded automatically (it would reset the DB). Run manually:
#       cd backend && uv run python manage.py seed --demo --reset
#   - Celery worker/beat are NOT started; background jobs (placement states) need them:
#       cd backend && uv run celery -A config worker -l info

set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1;36m[dev]\033[0m %s\n' "$*"; }

BACKEND_CONTAINER=localads-backend-dev

# --- 0. Pre-flight -----------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  say "ERROR: docker is required (PostGIS/Redis/Garage). Install Docker first."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  say "ERROR: Docker daemon is not running. Start Docker and retry."
  exit 1
fi

for port in 8000 5173; do
  if lsof -i ":$port" -P -n 2>/dev/null | grep -q LISTEN; then
    say "WARNING: port $port already in use — an existing server may conflict."
  fi
done

# --- 1. Infrastructure (PostGIS + Redis + Garage) -----------------------------------

say "Starting infrastructure (PostGIS, Redis, Garage)..."
docker compose up -d --wait

# --- 2. Backend (Django) -------------------------------------------------------------

say "Preparing backend..."
if command -v uv >/dev/null 2>&1; then
  ( cd backend && uv sync --quiet )
elif [[ ! -x backend/.venv/bin/python ]]; then
  say "ERROR: backend/.venv not found and uv is not installed."
  say "       Install uv (https://docs.astral.sh/uv/) and retry."
  exit 1
fi
PY="$PWD/backend/.venv/bin/python"

if [[ ! -f backend/.env ]]; then
  cp backend/.env.example backend/.env
  say "Created backend/.env from .env.example"
fi

# GeoDjango native libs present? Otherwise fall back to the Docker image.
BACKEND_MODE=local
if ( cd backend && "$PY" -c "from django.contrib.gis.gdal import libgdal" \
                        && "$PY" -c "from django.contrib.gis.geos import libgeos" ) >/dev/null 2>&1; then
  say "GeoDjango libs found — running backend locally (.venv)."
else
  BACKEND_MODE=docker
  say "GeoDjango libs (GDAL/GEOS) missing locally — backend runs in Docker instead."
  say "Building localads-backend:dev image (cached after the first run)..."
  ( cd backend && docker build -q -t localads-backend:dev . >/dev/null )
fi

# docker-mode invocation: compose network, backend/ mounted for autoreload,
# env overrides point at the compose service names instead of localhost.
docker_backend() {
  docker run --rm -i --name "$BACKEND_CONTAINER" --network local-ads_default \
    -p 8000:8000 \
    -v "$PWD/backend:/app" \
    -e DATABASE_URL=postgis://localads:localads@db:5432/localads \
    -e REDIS_URL=redis://redis:6379/1 \
    -e CELERY_BROKER_URL=redis://redis:6379/0 \
    localads-backend:dev "$@"
}

say "Applying migrations..."
if [[ $BACKEND_MODE == local ]]; then
  ( cd backend && "$PY" manage.py migrate --noinput )
else
  # A previous run that died without cleanup can leave the named container behind.
  docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  docker_backend python manage.py migrate --noinput
fi

# --- Child-process management ---------------------------------------------------------

BACKEND_PID=""
FRONTEND_PID=""
CLEANED=0

cleanup() {
  [[ $CLEANED -eq 1 ]] && return
  CLEANED=1
  say "Stopping dev servers..."
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  # Reap any direct children (npm/node spawn chains).
  [[ -n "$FRONTEND_PID" ]] && pkill -TERM -P "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && pkill -TERM -P "$BACKEND_PID" 2>/dev/null || true
  [[ $BACKEND_MODE == docker ]] && docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  wait 2>/dev/null || true
  say "Stopped (containers still running: docker compose stop)."
}
trap cleanup EXIT INT TERM HUP

# --- 3. Run both dev servers ----------------------------------------------------------

say "Starting Django dev server on http://localhost:8000 ..."
if [[ $BACKEND_MODE == local ]]; then
  ( cd backend && exec "$PY" manage.py runserver ) &
else
  docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  docker_backend python manage.py runserver 0.0.0.0:8000 &
fi
BACKEND_PID=$!

say "Preparing frontend..."
( cd frontend && { [[ -d node_modules ]] || npm install; } )

say "Starting Vite dev server on http://localhost:5173 ..."
# exec vite directly (not `npm run dev`) so the PID we track IS the server.
( cd frontend && exec ./node_modules/.bin/vite ) &
FRONTEND_PID=$!

say ""
say "Backend  : http://localhost:8000   (API /api/v1 · admin /admin · docs /api/docs)"
say "Frontend : http://localhost:5173"
say "Press Ctrl+C to stop both servers."
say ""

# Exit (and clean up) as soon as either server dies.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

# Deliberate shutdown (signal) already handled by cleanup.
[[ $CLEANED -eq 1 ]] && exit 0

if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  say "Backend exited unexpectedly (check the output above)."
else
  say "Frontend exited unexpectedly (check the output above)."
fi
