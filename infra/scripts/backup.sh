#!/usr/bin/env bash
# Off-server backup (spec §15, §17 item 22): DB dump + Garage media sync.
# Targets the PRODUCTION compose stack by default. Configure BACKUP_TARGET
# (e.g. user@backup-host:/srv/backups/localads) and run from cron.
# Restore drill: see docs/runbooks/deploy.md.
set -euo pipefail

BACKUP_TARGET="${BACKUP_TARGET:?Set BACKUP_TARGET (off-server path, scp/rsync syntax)}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-infra/docker/.env.prod}"
NETWORK="${NETWORK:-local-ads-prod_backend_net}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Garage credentials come from the deploy env file. The app key is
# read/write on the media bucket only (least privilege — garage-init.sh).
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${GARAGE_APP_ACCESS_KEY:?must be set in $ENV_FILE}"
: "${GARAGE_APP_SECRET_KEY:?must be set in $ENV_FILE}"

echo "==> dumping PostgreSQL"
docker compose -f "$COMPOSE_FILE" exec -T db pg_dump -U localads --no-owner localads \
  | gzip > "$WORKDIR/db-$STAMP.sql.gz"

echo "==> syncing Garage media (aws-cli on the compose network)"
docker run --rm --network "$NETWORK" \
  -e AWS_ACCESS_KEY_ID="$GARAGE_APP_ACCESS_KEY" \
  -e AWS_SECRET_ACCESS_KEY="$GARAGE_APP_SECRET_KEY" \
  -e AWS_DEFAULT_REGION=garage \
  -v "$WORKDIR:/backup" \
  "${AWSCLI_IMAGE:-amazon/aws-cli:latest}" s3 sync "s3://localads-media" "/backup/media-$STAMP" \
  --endpoint-url http://garage:3900

echo "==> checksums"
( cd "$WORKDIR" && find . -type f -exec sha256sum {} \; > "SHA256SUMS-$STAMP" )

echo "==> shipping to $BACKUP_TARGET"
rsync -a "$WORKDIR/" "$BACKUP_TARGET/$STAMP/"

echo "==> pruning local copies older than 7 days on the target"
ssh "$(echo "$BACKUP_TARGET" | cut -d: -f1)" \
  "find '$(echo "$BACKUP_TARGET" | cut -d: -f2)' -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +" \
  || echo "WARN: prune failed — check target retention manually"

echo "OK: backup $STAMP shipped. Verify a restore drill before launch."
