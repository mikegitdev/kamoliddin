# Deploy runbook (single VPS, manual — spec §15)

> Skeleton. Fill in real host names, backup targets, and alert endpoints
> before launch. The scripted version is `infra/scripts/deploy.sh`.

## Topology

nginx (infra/nginx/nginx.conf) -> web (gunicorn, backend/Dockerfile)
workers: celery worker + beat; state: PostgreSQL/PostGIS, Redis, MinIO.
Only the proxy exposes public ports; DB/Redis/MinIO stay on the internal
compose network.

## Steps

1. **Preflight** — verify `.env` on the server (never committed), image tags
   pinned, disk space.
2. **Backups (off-server)** — `pg_dump` + `mc mirror` of the media bucket to
   the external target; record timestamps.
3. **Build/pull** tagged images; record the release SHA (`.last-release-sha`).
4. **Migrate** — `manage.py makemigrations --check` must be clean, then
   `manage.py migrate`. Migrations never run automatically at container start.
5. **Start** — `docker compose up -d`; verify `/health/` returns `{"status":"ok"}`.
6. **Reconcile** — run payment/renewal reconciliation job (once implemented).
7. **Verify** — anonymous map page, advertiser login, admin login.

## Rollback

- App-only change: redeploy previous image tag; migrations are forward-only —
  a rollback must not revert schema. Confirm the previous app version is
  compatible with the new schema before deploying it.
- Data incident: restore from off-server backup into a clean environment and
  cut over (restore drill is a launch gate, spec §17 item 22).

### Restore drill (verified 2026-10-09, dev data)

1. Dump: `docker exec <db> pg_dump -U localads --no-owner localads | gzip > db.sql.gz`
   plus `tar czf media.tar.gz -C backend media`.
2. Restore: fresh `postgis/postgis:16-3.4` container → `CREATE EXTENSION IF NOT
   EXISTS postgis` → `gunzip -c db.sql.gz | psql` (the `tiger`/`topology` "already
   exists" errors from the PostGIS template are expected and harmless).
3. Verify: `manage.py migrate --check` passes; row counts match; `/health` ok;
   `/api/v1/public/locations` returns expected pins/ads; `/media/banners/...`
   serves 200; spot-check search.

Observed: 21 businesses / 25 locations / 21 campaigns / 24 orders / 27
placements restored, migrations consistent, live API + banners serving.

## Monitoring checklist

- `/health/` endpoint (DB check), Celery heartbeat + queue backlog, payment
  failure/reconciliation queue depth, disk usage, MinIO usage, DB backup
  freshness, TLS expiry, OTP error rate.

## Load checkpoint (2026-09-10, dev runserver + DEBUG, single worker)

- 10 concurrency: p50 141 ms / p95 219 ms / p99 229 ms, 0 errors.
- 30 concurrency: p50 391 ms / p95 731 ms, 0 5xx (throttles only).
- Anon rate limit (300/min burst, 5/s refill) engages exactly as configured —
  protects the map API from a single abusive client.
- Prod runs gunicorn (multi-worker) behind nginx, so treat these as a floor.
  Re-run against prod-shaped infra before launch sign-off.
