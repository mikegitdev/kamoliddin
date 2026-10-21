# Open questions / assumptions log (spec §19 [O] items tracked here)

| # | Question | Current provisional default | Decided by |
|---|---|---|---|
| 1 | CLICK one-time checkout | Adapter unimplemented until merchant confirmation; recurring charges are out of scope (ADR-0007) | pending provider |
| 2 | 2GIS licensing / tile economics | MapLibre + OSM tiles in dev only; production tiles unresolved — **launch blocker: public OSM tiles must not serve prod**. Deploy wiring ready: set `VITE_MAP_TILES_URL` / `VITE_MAP_GLYPHS_URL` / `VITE_MAP_ATTRIBUTION` (frontend) — commercial provider still to be chosen | pending provider |
| 3 | Eskiz vs Play Mobile | Fake adapter in dev; Eskiz adapter implemented from published docs (ADR-0006) but benchmark not run; Play Mobile unverified | pending benchmark |
| 4 | Final daily rate (UZS) | Demo tariff 30,000 UZS/24h | product owner |
| 5 | ~~Renewal price policy~~ | Moot — no auto-renewal, one-time payment per order (ADR-0007) | product owner |
| 6 | 25h request: display 25h (charge 2 days) vs display 48h entitlement | Honor requested display duration, disclose 2-day charge before payment | product owner |
| 7 | Partial-term refund on admin suspension | Manual review queue, no auto-proration | product owner |
| 8 | DNS / VPS sizing / RPO-RTO | VPS sizing proposed (see "Provisional VPS sizing" below, unvalidated estimate); DNS and RPO/RTO not yet chosen | ops design |
| 9 | Reconciliation sweep command | Shipped: `manage.py reconcile_payments` + 5-min beat task (ADR-0005 note 8); `ops_report` stays as the daily alerting surface | done |
| 10 | ~~Renewal timed retries~~ | Moot — auto-renewal removed (ADR-0007) | product owner |
| 11 | Campaign headline minimum length | UI requires > 2 trimmed chars; API accepts any non-empty trim — mirror the min length into `CampaignSerializer` when validation is next touched | maintainer |
| 12 | Banner-less campaign drafts | Model/API require non-empty `banner_key`; UI substitutes frontend-only sentinel `banners/placeholder.jpg` (no such object in storage — draft `banner_url` 404s). Either make `banner_key` blank-able with submit-time enforcement, or keep the sentinel and seed a real placeholder object | maintainer |
| 13 | Clearing branch contacts / hours | Location PATCH omits empty contact/hours fields (`undefined`), so owners cannot clear them from the UI, while Business contacts clear via `""` — align BranchesPage to send empty strings | maintainer |
| 14 | `Location.city` writability | Accepted by the API but never exposed in the UI — every branch is stored as "Tashkent". Intentional for the single-city MVP? | product owner |
| 15 | `Business.logo_key` UI | API-optional field with an upload path (`purpose=logos`) but no cabinet input — ship an upload control or drop the field from the contract | product owner |
## Provisional VPS sizing (open question #8)

Estimate derived from the spec §15 Compose stack (proxy + static frontend,
Gunicorn, Celery worker, Celery beat, PostgreSQL/PostGIS, Redis, Garage). Not
load-tested — confirm with the stress test before launch.

| | Minimum (MVP / pilot) | Comfortable |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB (2–3 Gunicorn workers) | 8 GB |
| Disk | 60 GB NVMe | 120–160 GB NVMe (Garage media grows) |
| OS | Ubuntu 24.04 LTS, Docker Engine + Compose v2 | same |

Also required: off-server backup target (separate bucket or host), domain + DNS,
TLS (e.g. Let's Encrypt), only 80/443 publicly open.

Constraints to resolve before choosing a provider:

- **x86_64 (amd64) host.** The PostGIS image in `docker-compose.yml` is
  amd64-only; an ARM VPS would need emulation or a different image.
- **Data residency.** Uzbekistan's personal-data law is understood to require
  citizens' personal data (e.g. owner phone numbers) to be stored on servers in
  Uzbekistan, which may rule out foreign hosts — confirm in the legal review
  (`docs/product/legal-review.md`).

## Evidence that closes each [E] gate (spec §19)

| Gate | Evidence required to close |
|---|---|
| CLICK recurring | Sandbox + production merchant-initiated charge, retry with same idempotency key, refund, and settlement report, recorded in `docs/architecture/click-verification.md`; then implement `charge_recurring`/`refund_charge` in `ClickPaymentGateway` and backfill `pending_token` agreements |
| 2GIS / tiles | Signed commercial offer with quota + data-use terms, or a licensed OSM tile host; configure `VITE_MAP_TILES_URL`, `VITE_MAP_GLYPHS_URL`, `VITE_MAP_ATTRIBUTION` (frontend) and update `docs/runbooks/deploy.md` |
| SMS benchmark | Test batches through Eskiz (and Play Mobile once documented): latency per network, delivery success, price per message, sender registration lead time → `docs/architecture/sms-benchmark.md` |
| Legal | Reviewed privacy notice, advertising content rules, refund policy for Uzbekistan → `docs/product/legal-review.md` |
## Assumptions made while scaffolding (to be reviewed)

- Order carries a required `campaign` FK (checkout flow is campaign-scoped).
- Placement rows link to their purchasing order (ADR-0003); reservations are
  created at checkout as PENDING and promoted at settlement.
- Staff log into Django Admin with phone + password (OTP is for advertisers).
- Renewal provider idempotency uses `uuid5("renewal:<agreement>:<boundary>")`
  so hard-crash reruns dedupe at the provider side.
- Renewal retry policy: a failed charge sets ALERT (no automatic retry) until
  the advertiser re-enables or an admin reviews — deliberate MVP conservatism;
  timed retries can be added behind the same constraint.
- Staff control room (`/staff`): staff can block advertiser logins, disable
  businesses/branches and take down single placements; every action needs a
  reason and writes an ActivityEvent. No money moves and no staff-rights
  management from the console (Django Admin only). Open:
  - A staff-blocked placement is NOT credited back on unblock (original
    interval kept); compensation, if any, goes through the refund flow.
  - Refunding an order does not cancel its staff-BLOCKED placements (they
    stay blocked and are refused on unblock) — `cancel_order_placements`
    left untouched (maintainer-owned).
  - Renewals now fail closed (`business_disabled` / `owner_blocked` →
    agreement ALERT) when the business is disabled or the owner blocked;
    re-enabling does not auto-resume the agreement.
  - A user block does not hide that user's live ads; staff disable the
    business separately when needed.
