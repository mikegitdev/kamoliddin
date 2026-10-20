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
$COMPOSE run --rm web python manage.py collectstatic --noinput

echo "==> 6/10 Garage app key + bucket grant (idempotent)"
ENV_FILE="$ENV_FILE" infra/scripts/garage-init.sh

echo "==> 7/10 Starting services"
$COMPOSE up -d

echo "==> 8/10 Health gates: web readiness (DB, 503 on failure) + Celery"
$COMPOSE exec -T web curl -fsS http://localhost:8000/health/
echo
$COMPOSE exec -T worker celery -A config inspect ping

echo "==> 9/10 Release SHA"
git rev-parse HEAD > .last-release-sha || true

echo "==> 10/10 External HTTPS spot-check"
if curl -fsS "https://localhost/health/" -o /dev/null 2>/dev/null; then
  echo "TLS serving OK"
else
  echo "WARN: https://localhost/health/ failed (cert CN is the site domain) — verify https://<domain>/health/ manually."
fi
echo "Done. Rollback: docs/runbooks/deploy.md (forward-only schema caveats)."
