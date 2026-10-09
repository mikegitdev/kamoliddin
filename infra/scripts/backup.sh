#!/usr/bin/env bash
# Off-server backup (spec §15, §17 item 22): DB dump + MinIO media mirror.
# Configure BACKUP_TARGET (e.g. user@backup-host:/srv/backups/localads) and run
# from cron. Restore drill: see docs/runbooks/deploy.md.
set -euo pipefail

BACKUP_TARGET="${BACKUP_TARGET:?Set BACKUP_TARGET (off-server path, scp/rsync syntax)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"   # dev compose holds db/minio
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> dumping PostgreSQL"
docker compose -f "$COMPOSE_FILE" exec -T db pg_dump -U localads --no-owner localads \
  | gzip > "$WORKDIR/db-$STAMP.sql.gz"

echo "==> mirroring MinIO media"
docker compose -f "$COMPOSE_FILE" exec -T minio mc mirror --overwrite local/localads-media \
  "$WORKDIR/media-$STAMP" 2>/dev/null || docker run --rm --network "$(basename "$PWD")_default" \
  -v "$WORKDIR:/backup" --entrypoint sh minio/mc -c \
  "mc alias set b http://minio:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD &&
   mc mirror --overwrite b/localads-media /backup/media-$STAMP"

echo "==> checksums"
( cd "$WORKDIR" && find . -type f -exec sha256sum {} \; > "SHA256SUMS-$STAMP" )

echo "==> shipping to $BACKUP_TARGET"
rsync -a "$WORKDIR/" "$BACKUP_TARGET/$STAMP/"

echo "==> pruning local copies older than 7 days on the target"
ssh "$(echo "$BACKUP_TARGET" | cut -d: -f1)" \
  "find '$(echo "$BACKUP_TARGET" | cut -d: -f2)' -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +" \
  || echo "WARN: prune failed — check target retention manually"

echo "OK: backup $STAMP shipped. Verify a restore drill before launch."
