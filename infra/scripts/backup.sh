#!/usr/bin/env bash
# Off-server backup (spec §15, §17 item 22): DB dump + Garage media sync.
# Targets the PRODUCTION compose stack by default. Configure BACKUP_TARGET
# (e.g. user@backup-host:/srv/backups/localads) and run from cron.
#
# Encryption (spec §11 [R]): when BACKUP_ENCRYPTION_KEY is set, every artifact
# is encrypted at rest with openssl AES-256-CBC + PBKDF2 before it leaves the
# machine. KEEP THE KEY OFF THE BACKUP HOST (e.g. a password manager) —
# without it a restore is impossible. Restore one file with:
#   openssl enc -d -aes-256-cbc -pbkdf2 \
#     -in db-<stamp>.sql.gz.enc -pass env:BACKUP_ENCRYPTION_KEY | gunzip | psql ...
#
# Restore drill: see docs/runbooks/deploy.md.
set -euo pipefail

BACKUP_TARGET="${BACKUP_TARGET:?Set BACKUP_TARGET (off-server path, scp/rsync syntax)}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-infra/docker/.env.prod}"
NETWORK="${NETWORK:-local-ads-prod_backend_net}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAMP_FILE="${STAMP_FILE:-$HOME/.localads-last-backup}"
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

encrypt_file() {
  # Encrypt in place when a key is configured; no-op otherwise (logged).
  local f="$1"
  if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -salt \
      -in "$f" -out "$f.enc" -pass env:BACKUP_ENCRYPTION_KEY
    rm -f "$f"
  else
    echo "WARN: BACKUP_ENCRYPTION_KEY not set — shipping UNENCRYPTED backup" >&2
  fi
}

echo "==> dumping PostgreSQL"
docker compose -f "$COMPOSE_FILE" exec -T db pg_dump -U localads --no-owner localads \
  | gzip > "$WORKDIR/db-$STAMP.sql.gz"
encrypt_file "$WORKDIR/db-$STAMP.sql.gz"

echo "==> syncing Garage media (aws-cli on the compose network)"
docker run --rm --network "$NETWORK" \
  -e AWS_ACCESS_KEY_ID="$GARAGE_APP_ACCESS_KEY" \
  -e AWS_SECRET_ACCESS_KEY="$GARAGE_APP_SECRET_KEY" \
  -e AWS_DEFAULT_REGION=garage \
  -v "$WORKDIR:/backup" \
  "${AWSCLI_IMAGE:-amazon/aws-cli:latest}" s3 sync "s3://localads-media" "/backup/media-$STAMP" \
  --endpoint-url http://garage:3900
find "$WORKDIR/media-$STAMP" -type f -print0 | while IFS= read -r -d '' f; do
  encrypt_file "$f"
done

echo "==> checksums"
( cd "$WORKDIR" && find . -type f -exec sha256sum {} \; > "SHA256SUMS-$STAMP" )

echo "==> shipping to $BACKUP_TARGET"
rsync -a "$WORKDIR/" "$BACKUP_TARGET/$STAMP/"

# Freshness stamp for `manage.py ops_report` (mount or copy it into the web
# container and set OPS_LAST_BACKUP_FILE — see deploy runbook).
date -u +%FT%TZ > "$STAMP_FILE"

echo "==> pruning old backups on the target (timestamp-shaped dirs only, >7 days)"
ssh "$(echo "$BACKUP_TARGET" | cut -d: -f1)" \
  "find '$(echo "$BACKUP_TARGET" | cut -d: -f2)' -maxdepth 1 -type d \
     -regextype posix-extended -regex '.*/20[0-9]{6}T[0-9]{6}Z' -mtime +7 -exec rm -rf {} +" \
  || echo "WARN: prune failed — check target retention manually"

echo "OK: backup $STAMP shipped. Verify a restore drill before launch."
