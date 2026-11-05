#!/usr/bin/env bash
# Manual reproducible deployment (spec §15). Fail-fast; each step echoes intent.
# Prereqs on the VPS: docker compose plugin, git, Node 22+ (frontend build),
# infra/docker/.env.prod and TLS certs in infra/nginx/certs/ (see runbook).
set -euo pipefail

echo "==> 1/10 Preflight: repo, env file, tooling, image tag"
: "${DEPLOY_ROOT:?DEPLOY_ROOT must point to the repo on the VPS}"
cd "$DEPLOY_ROOT"

ENV_FILE="${ENV_FILE:-infra/docker/.env.prod}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (see infra/docker/.env.prod.example)" >&2; exit 1; }
[ -f infra/nginx/certs/fullchain.pem ] && [ -f infra/nginx/certs/privkey.pem ] \
  || { echo "missing TLS certs in infra/nginx/certs/ — see docs/runbooks/deploy.md" >&2; exit 1; }
command -v node >/dev/null || { echo "node+npm required to build the frontend" >&2; exit 1; }
command -v git >/dev/null || { echo "git required" >&2; exit 1; }

COMPOSE_FILE="infra/docker/docker-compose.prod.yml"
COMPOSE="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"
TAG="$(git rev-parse --short HEAD)" && export TAG
# Release stamp baked into the backend image (/health/ "release"); the
# frontend build stamps itself the same way (vite.config.ts). "-dirty" = an
# uncommitted on-server edit (hotfix) went into the build.
BACKEND_GIT_SHA="$(git log -1 --format=%h -- backend)"
BACKEND_GIT_DATE="$(git log -1 --format=%cI -- backend)"
git diff --quiet HEAD -- backend || BACKEND_GIT_SHA="$BACKEND_GIT_SHA-dirty"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export BACKEND_GIT_SHA BACKEND_GIT_DATE BUILT_AT

echo "==> 2/10 Off-server DB + object backup"
BACKUP_TARGET="${BACKUP_TARGET:?}" ENV_FILE="$ENV_FILE" infra/scripts/backup.sh

echo "==> 3/10 Building frontend SPA (served by nginx from frontend/dist)"
( cd frontend && npm ci && npm run build )

echo "==> 4/10 Building tagged backend image"
$COMPOSE build web
$COMPOSE pull --ignore-pull-failures

echo "==> 5/10 Migration check + migrate + collectstatic (explicit, fail-fast)"
$COMPOSE run --rm web python manage.py makemigrations --check --dry-run
$COMPOSE run --rm web python manage.py migrate
# The image runs as the unprivileged `app` user; collectstatic writes into
# the root-owned-on-reuse backend_static volume, so elevate for this step.
$COMPOSE run --rm --user root web python manage.py collectstatic --noinput

echo "==> 6/10 Garage app key + bucket grant (idempotent)"
ENV_FILE="$ENV_FILE" infra/scripts/garage-init.sh

echo "==> 7/10 Starting services"
$COMPOSE up -d

echo "==> 8/10 Health gates: web readiness (DB, 503 on failure) + Celery"
# X-Forwarded-Proto: SECURE_SSL_REDIRECT would answer a bare request with a
# 301, which curl -f treats as success — the gate would pass on a dead DB.
$COMPOSE exec -T web curl -fsS -H "X-Forwarded-Proto: https" http://localhost:8000/health/
echo
$COMPOSE exec -T worker celery -A config inspect ping

echo "==> 9/10 Release SHA"
git rev-parse HEAD > .last-release-sha || true

echo "==> 10/10 External HTTPS spot-check"
# --resolve pins the real domain to loopback so the cert's SAN validates.
DOMAIN="$(grep -E '^DJANGO_ALLOWED_HOSTS=' "$ENV_FILE" | head -1 | cut -d= -f2 | cut -d, -f1 | tr -d ' ')"
if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "*" ] \
   && curl -fsS --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/health/" -o /dev/null 2>/dev/null; then
  echo "TLS serving OK"
else
  echo "WARN: external spot-check failed — verify https://<domain>/health/ manually."
fi
echo "Done. Rollback: docs/runbooks/deploy.md (forward-only schema caveats)."
