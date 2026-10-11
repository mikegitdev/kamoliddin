# ADR-0001: Monorepo, locked stack, and module boundaries

**Status:** Accepted (baseline from the engineering spec, 2026-10-09)
**Owners:** architect/maintainer role (spec §16)

## Context

MVP for a paid local business advertising map in Tashkent (8-week target).
Solo delivery with AI agents in parallel; provider gates (CLICK recurring,
2GIS licensing, SMS providers) are unresolved external dependencies.

## Decision

1. **Monorepo** `frontend/ + backend/ + infra/ + docs/` — no microservices, no
   Kubernetes, no event buses, no custom admin SPA (spec §2 [C]).
2. **Backend:** Django 5.2 LTS modular monolith; one Django app per bounded
   context: accounts, businesses, locations, campaigns, placements, billing,
   payments, renewals, discovery (public), moderation (+ core for API
   conventions). DRF, `/api/v1`, OpenAPI via drf-spectacular.
3. **Database:** PostgreSQL + PostGIS only. No SQLite anywhere, including tests
   (spec §17). Geometry: `PointField(srid=4326, geography=True)` + GiST index.
4. **Frontend:** React 19 + Vite + TypeScript. FSD-ish structure
   (app/pages/features/entities/shared/map-adapters). RU/UZ dictionaries,
   no hardcoded UI strings.
5. **Map abstraction:** app code talks only to `MapAdapter`
   (initialize/setCenterZoom/setMarkers/setClusters/onViewportChange/
   onMarkerClick/destroy). MapLibre+OSM is the dev fallback; 2GIS MapGL
   adapter slots in behind the same interface once licensed.
6. **Payments:** everything behind `PaymentGateway` (create_checkout /
   verify_webhook / get_payment_status / charge_recurring). CLICK adapter
   raises NotImplementedError until merchant recurring capability is proven
   (spec §19 [E]). Fake gateway exists for dev/tests only.
7. **SMS:** `SMSAdapter` protocol; only `fake` implemented. Eskiz/Play Mobile
   adapters must come from verified docs (never fabricated).
8. **Money:** integer minor units (tiyin), `BigIntegerField`, UZS. Quotes are
   server-computed with rate snapshots; immutable after payment.
9. **State machines:** campaign review, order/payment, placement states are
   separate lifecycles — never collapse them (spec §4 invariant).

## Consequences

- Provider swaps (CLICK -> fallback) touch only `apps/payments/gateways.py`.
- Map vendor swaps touch only `frontend/src/map-adapters`.
- Migration chain and financial invariants are maintainer-owned; feature agents
  work behind those contracts.
- Local dev requires Docker (PostGIS + Redis + Garage) — no lightweight
  in-memory fallback; this is deliberate.
- Object storage: Garage replaced MinIO (ADR-0002) — single-node, private S3
  API; public reads stay server-mediated through Django (spec §11).
