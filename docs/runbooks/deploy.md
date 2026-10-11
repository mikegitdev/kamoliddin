# Deploy runbook (single VPS, manual — spec §15)

> Fill in real host names, backup targets, and alert endpoints before launch.
> The scripted version is `infra/scripts/deploy.sh`.

## Prerequisites (once per VPS)

1. **Env file** — `cp infra/docker/.env.prod.example infra/docker/.env.prod` and
   fill every value (Postgres, Garage bootstrap + least-privilege app keys,
   media domain). Never commit it.
2. **Garage config** — generate `infra/docker/garage.prod.toml` on the server
   (never committed) with fresh secrets; the admin API stays internal and is
   used by `garage-init.sh`:
   ```bash
   umask 077
   cat > infra/docker/garage.prod.toml <<EOF
   metadata_dir = "/var/lib/garage/meta"
   data_dir = "/var/lib/garage/data"
   db_engine = "sqlite"
   replication_factor = 1
   rpc_bind_addr = "[::]:3901"
   rpc_public_addr = "127.0.0.1:3901"
   rpc_secret = "$(openssl rand -hex 32)"

   [s3_api]
   s3_region = "garage"
   api_bind_addr = "[::]:3900"
   root_domain = ".s3.internal"

   [s3_web]
   bind_addr = "[::]:3902"
   root_domain = ".web.internal"

   [admin]
   api_bind_addr = "[::]:3903"
   admin_token = "$(openssl rand -hex 16)"
   metrics_token = "$(openssl rand -hex 16)"
   EOF
   ```
3. **TLS certificates** — before the first `up -d` (nginx always listens on
   443 and refuses to start without certs):
   ```bash
   sudo certbot certonly --standalone -d ads.example.uz   # port 80 must be free
   cp /etc/letsencrypt/live/ads.example.uz/fullchain.pem infra/nginx/certs/
   cp /etc/letsencrypt/live/ads.example.uz/privkey.pem  infra/nginx/certs/
   ```
   Renewals: `certbot renew --webroot -w infra/nginx/certbot` (port 80 serves
   `/.well-known/acme-challenge/` and redirects everything else to HTTPS),
   then copy the refreshed files and `docker compose ... restart proxy`.
4. **Tooling** — docker (compose plugin), git, Node 22+ (the SPA is built on
   the VPS during deploy).

## Topology

nginx (infra/nginx/nginx.conf) -> web (gunicorn, backend/Dockerfile)
workers: celery worker + beat; state: PostgreSQL/PostGIS, Redis, Garage.
Only the proxy exposes public ports; DB/Redis/Garage stay on the internal
compose network. Media objects live in Garage (private S3 API, ADR-0002) and
are served publicly only through Django's `/media/` route (spec §11).

## Steps (deploy.sh automates 1–9)

1. **Preflight** — verify `.env.prod`, TLS certs, Node, pinned image tags,
   disk space.
2. **Backups (off-server)** — `pg_dump` + Garage media sync to the external
   target; record timestamps.
3. **Build frontend** — `npm ci && npm run build` → `frontend/dist` (mounted
   read-only into nginx).
4. **Build/pull** tagged images; record the release SHA (`.last-release-sha`).
5. **Migrate + collectstatic** — `manage.py makemigrations --check` must be
   clean, then `migrate` and `collectstatic --noinput` (explicit, fail-fast;
   never run automatically at container start).
6. **Garage init** — `infra/scripts/garage-init.sh` imports the bucket-scoped
   app key (read/write only; idempotent; the app never uses the bootstrap key).
7. **Start** — `docker compose up -d`; `/health/` must return 200/`ok`
   (DB failure returns 503 and fails the gate).
8. **Reconcile** — run payment/renewal reconciliation job.
9. **Verify** — `https://<domain>/` map page, advertiser login, admin login.

## Rollback

- App-only change: redeploy previous image tag; migrations are forward-only —
  a rollback must not revert schema. Confirm the previous app version is
  compatible with the new schema before deploying it.
- Data incident: restore from off-server backup into a clean environment and
  cut over (restore drill is a launch gate, spec §17 item 22).

### Restore drill (prod-shaped: Garage media + Postgres)

`infra/scripts/backup.sh` output is self-contained per timestamp:
`db-<stamp>.sql.gz`, `media-<stamp>/` (mirrored bucket objects),
`SHA256SUMS-<stamp>`. To drill a restore into a clean environment:

1. Start a fresh `postgis/postgis:16-3.4` + Garage stack (`garage-init.sh`
   against it).
2. `gunzip -c db-<stamp>.sql.gz | psql` (PostGIS template "already exists"
   errors are expected and harmless) — see the dev drill below for details.
3. `aws s3 sync media-<stamp>/ s3://localads-media --endpoint-url ...` (same
   aws-cli invocation as `backup.sh`, with source and target swapped).
4. Verify: `manage.py migrate --check`, `/health/` 200, public map API returns
   pins/ads, `/media/banners/...` serves 200 (through Django), spot-check search.

A production-shaped drill (off-server backup → clean VPS) is a launch gate
(spec §17 item 22); the dev-data drill below is the inner loop.

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
  failure/reconciliation queue depth, disk usage, Garage storage usage
  (admin API `:3903/v2/GetClusterStatus`), DB backup
  freshness, TLS expiry, OTP error rate.

## Load checkpoint (2026-09-10, dev runserver + DEBUG, single worker)

- 10 concurrency: p50 141 ms / p95 219 ms / p99 229 ms, 0 errors.
- 30 concurrency: p50 391 ms / p95 731 ms, 0 5xx (throttles only).
- Anon rate limit (300/min burst, 5/s refill) engages exactly as configured —
  protects the map API from a single abusive client.
- Prod runs gunicorn (multi-worker) behind nginx, so treat these as a floor.
  Re-run against prod-shaped infra before launch sign-off.
