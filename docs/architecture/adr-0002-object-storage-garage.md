# ADR-0002: Object storage — Garage (replacing MinIO)

**Status:** Accepted (2026-10-10)
**Owners:** architect/maintainer role (spec §16)
**Supersedes:** the MinIO baseline in ADR-0001 / spec §1 ("Self-hosted MinIO,
S3-compatible" [C] row updated accordingly — deliberate change, not silent).

## Context

The stack needs self-hosted S3-compatible storage for media objects (banners,
logos; spec §11) on a single VPS (spec §15). MinIO was the original baseline.
Decision: switch to [Garage](https://garagehq.deuxfleurs.fr/) — a lighter
single-binary Rust object store that fits the one-VPS manual-deploy topology.

All behaviors below were verified empirically against `dxflrs/garage:v2.4.1`
on 2026-10-10 (no fabricated provider behavior, repo rule 4).

## Decision

1. **Garage v2.4.x** (`dxflrs/garage:v2.4.1`, pinned) in dev and prod.
   Single node: `server --single-node --default-bucket` auto-assigns the
   layout and creates the `localads-media` bucket + a bootstrap key from
   `GARAGE_DEFAULT_*` env. Idempotent across restarts (no credential
   rotation on reboot).
2. **Least privilege in prod** (`infra/scripts/garage-init.sh`, replacing
   `minio-init.sh`): the app uses a separate key imported via the admin API
   (`POST /v2/ImportKey`) with only `read`+`write` on `localads-media`
   (`POST /v2/AllowBucketKey`). Verified: that key gets `AccessDenied` on
   `CreateBucket` and `PutBucketWebsite` (owner-only). The bootstrap key is
   never used by the app.
3. **Storage is never publicly exposed.** Garage's S3 API has **no anonymous
   access at all** (upstream issue #263), which matches this codebase's
   server-mediated media design: public reads flow through Django's
   `MediaServeView` (`/media/<path>`, apps/core/media.py, spec §11), which
   streams from the private bucket. nginx `/media/` proxies to Django.
   Django-storages emits those URLs via `S3_PUBLIC_DOMAIN` (custom domain),
   e.g. `ads.example.uz/media`.
4. **Region is enforced.** Garage validates the sigv4 credential region
   against `s3_region` (MinIO ignored it) → `S3_REGION=garage` /
   `region_name` in `STORAGES` (config/settings/base.py). Wrong region =
   `400 Bad Request` on every S3 call.
5. **Backups** use `aws-cli` `s3 sync` against the S3 API with the app key
   (read-only need, key is already read/write-scoped) — `infra/scripts/backup.sh`.

## Consequences

- Dev: `docker compose up -d` boots Garage with fixed dev creds (same trust
  level as the previous setup); the old `.docker-data/minio` directory was
  removed; dev objects were not migrated.
- Prod: `infra/docker/garage.prod.toml` is generated on the server (fresh
  `rpc_secret`/`admin_token`, runbook snippet) and gitignored; env keys are
  `GARAGE_DEFAULT_*` (bootstrap) and `GARAGE_APP_*` (app) in `.env.prod`.
- Garage's website endpoint (`:3902`) is deliberately unused — it exists in
  the default config but nothing routes to it. If CDN-style direct reads are
  ever wanted, it is the only documented path (vhost-style Host matching;
  path-style returns 404).
- Single-node `replication_factor = 1`: disk loss loses media; off-server
  backups remain the recovery path (spec §17 item 22).
