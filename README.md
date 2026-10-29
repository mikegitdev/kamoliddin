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
| OTP delivery | Fake SMS for dev; enrolled Telegram delivery preferred with DevSMS (universal OTP) as the SMS path (ADR-0006); Eskiz adapter kept as alternative |

## Layout

```text
frontend/   React + Vite + TS app (map-first homepage, advertiser cabinet,
            staff console; RU/UZ). src layers: app/ pages/ features/ entities/
            shared/ + map-adapters/ (MapLibre dev adapter, 2GIS interface)
backend/    Django project: config/ + apps/{core,accounts,businesses,locations,
            campaigns,placements,billing,payments,discovery,moderation}
            (+ renewals: retired app kept installed only for its migration
            chain — ADR-0007)
infra/      nginx config, deploy script skeletons
docs/       architecture ADRs + field contract, runbooks, product, acceptance
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

# Optional — background jobs (placement state refresh, payment reconciliation):
uv run celery -A config worker -l info    # second terminal
uv run celery -A config beat -l info      # third terminal

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

**Staff control room**: log in as staff via the normal OTP flow and open
`/staff` — review queue, complaints, campaigns (suspend), placements (block /
unblock with live visibility), businesses & branches (disable / enable), users
(block login, drill-down), refunds, orders, free grants, logs (filterable audit
trail with CSV export, payment attempts, provider webhooks) and
the ad-limit setting. Every staff action requires a reason and is audit-logged.

Demo dataset includes every campaign scenario: active+paid, paid-pending-moderation,
submitted, draft, rejected+refunded, one-day purchase, and a free grant — plus
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

### Regenerating the API client (after any API change)

The OpenAPI schema and the generated TypeScript client are committed artifacts —
CI fails on drift. After changing serializers/views/endpoints:

```bash
cd backend  && uv run python manage.py spectacular --file ../frontend/openapi.json
cd frontend && npm run gen:api   # -> src/shared/api/schema.d.ts
# then commit both files together
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
bbox map API with live ad counts · placement state refresh task · **one-time
payment per order** (no auto-renewal — ADR-0007) · **refunds** (owner request → admin
approve/reject → placements cancelled) · **free grants**
(admin-issued zero-charge placements, publicly equal ranking) · **admin REST**
(review/grants/refunds/ad-limit) · **public search** (relevance + distance) ·
**focused pytest tests** on the money path (pricing, settlement idempotency,
ad cap) run against real PostGIS.

Still pending (external gates — cannot be built until verified):
- CLICK production checkout: **[E] gate open** — `ClickPaymentGateway` raises
  `NotImplementedError` until merchant capability is verified (spec §19). The
  `PaymentGateway` contract + fake provider are ready for the verified adapter.
- 2GIS MapGL adapter: interface defined in `frontend/src/map-adapters`; MapLibre/OSM
  is the dev fallback. Production tiles require a licensed provider (spec §10).
- SMS: DevSMS (devsms.uz) selected as the production SMS provider (product
  owner, 2026-10-29); the adapter uses API v1 universal OTP with
  `Idempotency-Key` (ADR-0006). Real-network delivery/price benchmark is
  still worth recording before launch. Eskiz adapter kept as the alternative;
  Play Mobile remains unimplemented pending verified documentation. Enrolled
  Telegram OTP delivery is implemented; initial signup and phone changes
  still need SMS.

## Verification and launch readiness

- Playwright smoke specs exist in `frontend/e2e/` for the public map, advertiser
  cabinet and staff console. Run `cd frontend && npm run e2e` against a disposable
  seeded dev stack with the Docker backend on `:8000` (default container
  `localads-backend-dev`, override via `E2E_BACKEND_CONTAINER`). The suite uses
  fake SMS with `OTP_DEV_ECHO` and modifies demo data and OTP throttle state; it
  is not production-provider evidence and is not currently run by CI.
- Backend CI runs Ruff, financial-core mypy, migration checks and pytest against
  real PostGIS. Frontend CI runs ESLint, TypeScript and build; API-contract CI
  checks generated OpenAPI/TypeScript drift. Without local GDAL, use the dev
  backend container for backend checks (`docker exec localads-backend-dev ...`).
- Dev load measurements and a dev-data restore drill are recorded in
  [the deploy runbook](docs/runbooks/deploy.md). Production-shaped load testing,
  an off-server Postgres + Garage restore and rollback rehearsal remain open.
- Legal/privacy review remains open; see
  [the legal checklist](docs/product/legal-review.md).

Use the [launch checklist](docs/acceptance/launch-checklist.md) for the next
milestones and required evidence. Green automated checks alone do not close
provider, legal or production-readiness gates. Billing scope is one-time payments
only, per [ADR-0007](docs/architecture/adr-0007-one-time-payment-no-auto-renewal.md).
