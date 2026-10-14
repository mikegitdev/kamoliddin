# Local Advertising Map Platform — monorepo

Paid local business advertising network on a live interactive map (Tashkent, Uzbekistan).
MVP engineering baseline: [`Local_Advertising_Engineering_Spec_v1_EN.md`](./Local_Advertising_Engineering_Spec_v1_EN.md).

## Stack

| Area | Choice |
|---|---|
| Frontend | React 19 + Vite + TypeScript, MapLibre (2GIS adapter interface defined) |
| Backend | Django 5.2 LTS modular monolith + Django REST Framework |
| Database | PostgreSQL + PostGIS (GeoDjango, SRID 4326) |
| Jobs | Celery worker + Beat + Redis |
| Storage | Garage (S3-compatible, single-node) |
| Payments | CLICK-first via `PaymentGateway` contract; fake adapter for dev |
| SMS | Provider-neutral adapter; fake adapter for dev (Eskiz / Play Mobile TBD) |

## Layout

```text
frontend/   React + Vite + TS app (map-first homepage, advertiser cabinet, RU/UZ)
backend/    Django project: config/ + apps/{core,accounts,businesses,locations,
            campaigns,placements,billing,payments,renewals,discovery,moderation}
infra/      nginx config, deploy script skeletons
docs/       architecture ADRs, runbooks
```

## Quickstart (dev)

Prereqs: Docker, uv (or pip), Node LTS (22+).

One-command alternative: `./dev.sh` starts infrastructure, backend, and frontend
together (Ctrl+C stops the servers; if GeoDjango native libs are missing it runs
the backend in Docker automatically, as described below).

```bash
# 1. Infrastructure (PostGIS + Redis + Garage)
docker compose up -d

# 2. Backend
# (migrations for the initial schema are already generated under backend/apps/*/migrations)
cd backend
cp .env.example .env
uv sync                                  # or: pip install -r requirements.txt
uv run python manage.py migrate
uv run python manage.py seed --demo --reset  # rich demo dataset (~100 businesses across Tashkent, banners, all campaign states)
uv run python manage.py createsuperuser  # staff phone + password, for /admin
uv run python manage.py runserver        # http://localhost:8000 (needs local GDAL; alternatively run in Docker — see below)

# 3. Frontend
cd ../frontend
npm install
npm run dev                              # http://localhost:5173 (proxies /api -> :8000)
```

Useful URLs:
- API: `http://localhost:8000/api/v1/`
- OpenAPI schema: `http://localhost:8000/api/schema/` (drf-spectacular)
- Swagger UI: `http://localhost:8000/api/docs/`
- Django admin: `http://localhost:8000/admin/`
- Health: `http://localhost:8000/health/`
- Media (public read, served by Django): `http://localhost:8000/media/...`
  — objects live in Garage (S3-compatible, fully private; spec §11). Admin via
  `docker compose exec garage /garage -c /etc/garage.toml ...` (no web console).

Dev SMS provider is `fake`: OTP codes are printed to the server log (never do this in prod).

### Demo accounts (after `seed --demo --reset`)

| Role | Phone | How to sign in |
|---|---|---|
| Advertiser (owns all ~100 demo businesses) | +998 90 123 45 67 | OTP — code prints in server log |
| Staff/admin | +998 90 111 00 00 | Django Admin password `admin12345`; or same OTP flow |

**Staff moderation console**: log in as staff via the normal OTP flow and open
`/staff` — review queue (approve/reject with reason), refunds, free grants, and
the ad-limit setting, all without Django Admin or curl.

Demo dataset includes every campaign scenario: active+paid, paid-pending-moderation,
submitted, draft, rejected+refunded, auto-renew agreement, and a free grant — plus
generated banner images (Pillow) served from `/media/`.

### No local GDAL? Run the backend in Docker instead

`runserver` locally needs GDAL/GEOS/PROJ (GeoDjango). If installing them is
inconvenient, run the API in Docker against the compose services:

```bash
cd backend
docker build -t localads-backend:dev .
docker run --rm --network local-ads_default -p 8000:8000 \
  -e DATABASE_URL=postgis://localads:localads@db:5432/localads \
  -e REDIS_URL=redis://redis:6379/1 -e CELERY_BROKER_URL=redis://redis:6379/0 \
  -e DJANGO_SECRET_KEY=dev-only-insecure-secret-key -e DJANGO_DEBUG=True \
  localads-backend:dev python manage.py runserver 0.0.0.0:8000
```

## Conventions

- API prefix `/api/v1`, JSON, ISO-8601 UTC timestamps, `error.code/message/fields`,
  `X-Request-ID` on responses (see `backend/apps/core`).
- Money: integer minor units (tiyin), currency UZS. Never floats.
- Time: `timestamptz` UTC internally, displayed in Asia/Tashkent.
- Billing term: `charge_days = max(1, ceil(duration / 86400s))` per location (spec §6).
- Auth: phone OTP -> server session (secure HttpOnly cookie). CSRF applies to
  authenticated mutations.

## Status / not yet implemented (spec gates)

**Working end-to-end (verified):** phone-OTP login · business & branch CRUD ·
campaign draft→submit→moderation (admin actions + REST) · server-side quotes with
immutable snapshots (25h → 2 days) · idempotent checkout · fake payment → paid →
placement activation · paid-but-unapproved stays invisible · late moderation
shifts the interval preserving charged duration · approved-then-edited campaign
auto-hides pending re-review · media upload with magic-byte validation · public
bbox map API with live ad counts · placement state refresh task · **auto-renewals**
(consent→agreement, worker with exactly-one-charge-per-period under concurrency,
cancel/re-enable, content-change alert) · **refunds** (owner request → admin
approve/reject → placements cancelled, renewal disabled) · **free grants**
(admin-issued zero-charge placements, publicly equal ranking) · **admin REST**
(review/grants/refunds/ad-limit) · **public search** (relevance + distance) ·
**20 focused pytest tests** on the money path (pricing, settlement idempotency,
renewal concurrency, ad cap) run against real PostGIS.

Still pending (external gates — cannot be built until verified):
- CLICK production recurring charges: **[E] gate open** — `ClickGateway` raises
  `NotImplementedError` until merchant capability is verified (spec §19). The
  `PaymentGateway` contract + fake provider are ready for the verified adapter.
- 2GIS MapGL adapter: interface defined in `frontend/src/map-adapters`; MapLibre/OSM
  is the dev fallback. Production tiles require a licensed provider (spec §10).
- Eskiz / Play Mobile SMS adapters: contract + fake adapter ready (spec §9).

Not in scope for this scaffold (roadmap weeks 7–8):
- Playwright E2E suite, load tests, restore drill, legal/privacy review —
  these are launch gates, not scaffold features.
