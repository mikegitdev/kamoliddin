#!/usr/bin/env bash
# Manual reproducible deployment (spec §15). Fail-fast; each step echoes intent.
set -euo pipefail

echo "==> 1/9 Verifying environment and image tags"
: "${DEPLOY_ROOT:?DEPLOY_ROOT must point to the repo on the VPS}"
cd "$DEPLOY_ROOT"

echo "==> 2/9 Off-server DB + object backup"
BACKUP_TARGET="${BACKUP_TARGET:?}" infra/scripts/backup.sh

echo "==> 3/9 Pulling/building tagged images"
TAG="$(git rev-parse --short HEAD)" && export TAG
 docker compose -f infra/docker/docker-compose.prod.yml build web
 docker compose -f infra/docker/docker-compose.prod.yml pull --ignore-pull-failures

echo "==> 4/9 Migration check + migrate (no destructive auto-migrate on startup)"
docker compose -f infra/docker/docker-compose.prod.yml run --rm web \
  python manage.py makemigrations --check --dry-run
docker compose -f infra/docker/docker-compose.prod.yml run --rm web python manage.py migrate

echo "==> 5/9 Starting services"
docker compose -f infra/docker/docker-compose.prod.yml up -d

echo "==> 6/9 Health checks (frontend / API / worker)"
curl -fsS http://localhost/health/ && \
  docker compose -f infra/docker/docker-compose.prod.yml exec -T worker \
    celery -A config inspect ping

echo "==> 7/9 Payment/renewal reconciliation"
docker compose -f infra/docker/docker-compose.prod.yml run --rm web \
  python manage.py run_renewals

echo "==> 8/9 Recording release SHA"
git rev-parse HEAD > .last-release-sha || true

echo "==> 9/9 Done. Rollback: see docs/runbooks/deploy.md (forward-only schema caveats)."
