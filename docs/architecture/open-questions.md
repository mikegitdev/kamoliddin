# Open questions / assumptions log (spec §19 [O] items tracked here)

| # | Question | Current provisional default | Decided by |
|---|---|---|---|
| 1 | CLICK one-time checkout | Adapter unimplemented until merchant confirmation; recurring charges are out of scope (ADR-0007) | pending provider |
| 2 | 2GIS licensing / tile economics | MapLibre + OSM tiles in dev only; production tiles unresolved — **launch blocker: public OSM tiles must not serve prod**. Deploy wiring ready: set `VITE_MAP_TILES_URL` / `VITE_MAP_GLYPHS_URL` / `VITE_MAP_ATTRIBUTION` (frontend) — commercial provider still to be chosen | pending provider |
| 3 | SMS provider | **DevSMS (devsms.uz) selected** (product owner, 2026-10-29): API v1 universal-OTP adapter implemented from published docs (ADR-0006); Telegram preferred for login, DevSMS for first-login/forced-SMS/phone-change. Latency/price benchmark still worth recording pre-launch; Eskiz adapter kept as alternative, Play Mobile unverified | done (selected); benchmark doc optional |
| 4 | Final daily rate (UZS) | Demo tariff 30,000 UZS/24h | product owner |
| 5 | ~~Renewal price policy~~ | Moot — no auto-renewal, one-time payment per order (ADR-0007) | product owner |
| 6 | 25h request: display 25h (charge 2 days) vs display 48h entitlement | Honor requested display duration, disclose 2-day charge before payment (checkout now states that billing is in whole 24-hour days; wording to confirm) | product owner |
| 7 | Partial-term refund on admin suspension | Manual review queue, no auto-proration | product owner |
| 8 | DNS / VPS sizing / RPO-RTO | VPS sizing proposed (see "Provisional VPS sizing" below, unvalidated estimate); DNS and RPO/RTO not yet chosen | ops design |
| 9 | Reconciliation sweep command | Shipped: `manage.py reconcile_payments` + 5-min beat task (ADR-0005 note 8); `ops_report` stays as the daily alerting surface | done |
| 10 | ~~Renewal timed retries~~ | Moot — auto-renewal removed (ADR-0007) | product owner |
| 11 | Campaign headline minimum length | Resolved: `CampaignSerializer.validate_headline` and the editor both require at least 3 trimmed characters | done |
| 12 | Banner-less campaign drafts | Model/API require non-empty `banner_key`; UI substitutes frontend-only sentinel `banners/placeholder.jpg` (no such object in storage — draft `banner_url` 404s). Either make `banner_key` blank-able with submit-time enforcement, or keep the sentinel and seed a real placeholder object. **Interim:** the editor shows a placeholder graphic when the draft banner fails to load | maintainer |
| 13 | Clearing branch contacts / hours | Resolved: `BranchesPage` sends empty strings for cleared contacts and `{}` for a cleared schedule on PATCH | done |
| 14 | `Location.city` writability | Accepted by the API but never exposed in the UI — every branch is stored as "Tashkent". Intentional for the single-city MVP? | product owner |
| 15 | `Business.logo_key` UI | Resolved: cabinet logo upload and removal in `BusinessProfilePage` (section 4), saved through `PATCH logo_key` | done |
| 16 | OTP delivery channel | Telegram channel shipped (ADR-0006): enrollment-bound chat delivery, SMS fallback + `channel=sms` escape hatch. SMS provider decision closed with DevSMS (#3); first-time signup and phone changes deliver via DevSMS universal OTP | shipped; maintainer review |
| 17 | Paid visibility add-ons (Joymee TOP/RAISE) vs the old "no premium ranking in MVP" exclusion (spec §1 [C]) | **Superseded explicitly by the product owner (2026-10-31):** uniform-priced TOP/RAISED promotion add-ons shipped. Base rate stays uniform per location per day (spec §6 [C] intact — add-ons are two more *uniform platform prices*, not individual pricing); add-on is bought at quote time in the same one-time order (ADR-0007 intact — no wallet, no stored balance); promotion lives exactly as long as the paid placement interval (no expiry job). Feed ranking: TOP block → RAISED block → organic, distance/relevance preserved within blocks; grants never get a tier (spec §7.4). See `docs/product/competitive-analysis-joymee.md` | product owner (explicit) |
| 18 | Post-hoc promotion semantics (Joymee tariff page) | Shipped (2026-11-01, product owner pick): TOP/RAISE days for a **running** placement bought as a separate one-time order (`kind=promotion`). Decisions: window starts at **settlement** time, not quote (payment latency must not eat paid days); days bounded 1..30; one live promo per placement (re-quote refused `already_promoted` until it ends); no capacity consumed and no new placement created; refund **ends** the window but never cancels the placement nor erases records; feed/featured strip count a tier only inside its window; demo reset unlinks `Order.promoted_placement` before deleting (PROTECT cycle). Featured strip = campaigns with a live TOP window (Joymee VIP-pool equivalent), not a third tier | product owner (via follow-up selection) |
| 19 | Verified badge scope + outcome survey semantics | Shipped (2026-11-01, product owner pick): the badge is a **staff judgment** action (`POST /admin/businesses/{id}/verify|unverify`, reason → ActivityEvent, 409 on no-op) — deliberately NO passport/selfie/document pipeline (legal + storage burden stays out); display-only, never affects eligibility, survives disable/enable. Survey: one immutable `CampaignOutcome` per campaign, opens only when the campaign ran and every placement ended (`not_ended`/`already_answered` guards), three fixed answers + optional comment; owner-only, product telemetry never public. Demo reset drops outcome rows before campaigns (PROTECT) | product owner (via follow-up selection) |
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
| CLICK one-time checkout | Merchant confirmation and verified docs; sandbox + production checkout, authenticated callbacks, duplicate-callback safety, timeout reconciliation, refund and settlement evidence, to be recorded in `docs/architecture/click-verification.md`. Implement the verified one-time `ClickPaymentGateway` only; recurring/tokenization capability and renewal backfills are not required (ADR-0007) |
| 2GIS / tiles | Signed commercial offer with quota + data-use terms, or a licensed OSM tile host; configure `VITE_MAP_TILES_URL`, `VITE_MAP_GLYPHS_URL`, `VITE_MAP_ATTRIBUTION` (frontend) and update `docs/runbooks/deploy.md` |
| SMS benchmark | Optional post-selection check for DevSMS (chosen 2026-10-29): test batches through `SMS_PROVIDER=devsms` — latency per network, delivery success, price per message → `docs/architecture/sms-benchmark.md`. Eskiz (and Play Mobile once documented) remain the documented fallbacks |
| Legal | Reviewed privacy notice, advertising content rules, refund policy for Uzbekistan → `docs/product/legal-review.md` |
## Assumptions made while scaffolding (to be reviewed)

- Order carries a required `campaign` FK (checkout flow is campaign-scoped).
- Placement rows link to their purchasing order (ADR-0003); reservations are
  created at checkout as PENDING and promoted at settlement.
- Staff log into Django Admin with phone + password; the `/staff` control room
  also supports the normal phone-OTP session flow.
- ADR-0007 removed renewal agreements, attempts, stored tokens and automatic
  charges. A repeat purchase requires a new quote and one-time checkout; the
  former renewal idempotency/retry assumptions no longer apply.
- Staff control room (`/staff`): staff can block advertiser logins, disable
  businesses/branches and take down single placements; every action needs a
  reason and writes an ActivityEvent. No money moves and no staff-rights
  management from the console (Django Admin only). Open:
  - A staff-blocked placement is NOT credited back on unblock (original
    interval kept); compensation, if any, goes through the refund flow.
  - Refunding an order does not cancel its staff-BLOCKED placements (they
    stay blocked and are refused on unblock) — `cancel_order_placements`
    left untouched (maintainer-owned).
  - A user block does not hide that user's live ads; staff disable the
    business separately when needed.

## Hardening pass 2026-11-02 — deliberate trade-offs (code is authoritative)

- `GET /api/v1/orders` stays unpaginated: the cabinet's "paid total" stat sums
  the full list. Organic growth is one order per purchase; quote spam is capped
  by `MAX_OPEN_DRAFT_QUOTES` (10 open drafts per owner). Ceiling: paginate +
  move the stat server-side when an advertiser legitimately exceeds ~1000 orders.
- Staff work queues (`/admin/review-queue`, `/admin/refunds`) are capped at the
  200 most recent rows (same pattern as `/admin/reports`); the overview's
  counters keep reporting true totals.
- Engagement counters are denormalized onto `Campaign.views_count` /
  `contact_clicks_count` (F()-incremented with each `CampaignEvent` row).
  `CampaignEvent` rows themselves are retained indefinitely as the raw log;
  a pruning policy is a future product decision.
- `create_checkout` still calls the provider inside the capacity-locked
  transaction — acceptable while the only gateway is the instant fake adapter.
  Constraint documented on `ClickPaymentGateway`; the real adapter must use a
  hard socket timeout or the transaction must be split before it ships.
- Order/placement not-found vs not-owned responses differ (400/404 vs 403):
  accepted as-is because ids are UUID4 (unguessable); noted for symmetry with
  the anti-enumeration discipline of the auth flow.

## Phase 2 pass 2026-11-02 — spec §12/§15 reconciliation

- `Order.State.PAYMENT_PROCESSING` and `Refund.State.ADMIN_REVIEW` (spec §7.2)
  are defined but unreachable on purpose: `awaiting_payment` already covers
  the provider window (settlement is a single atomic hop), and refunds go
  request → decision in one staff action. Wiring the extra states would add
  churn without behavior. Maintainer-owned state machines (§16) — flagging
  the divergence here instead of changing them.
- Spec §15 monitoring items now in `ops_report`: Celery queue backlog, OTP
  failure health, TLS expiry. Garage storage usage stays a manual checklist
  item (admin API on :3903) — no in-app query path without new credentials.
- Structured logs: prod emits one JSON object per line with the request id
  (`apps/core/logging.py`); dev keeps the readable console format.
- Banner card thumbnails (spec §11 [R] "image variants"): uploads generate a
  480px `_sm.jpg` variant; `backfill_banner_thumbs` covers pre-existing
  banners (run once per environment after deploy); `prune_orphan_media`
  treats derived thumbs as referenced. Clients fall back to `banner_url`
  when `banner_thumb_url` is absent/404 until backfill runs.
- Spec §12/§13 drift (route names, quote envelope shape, §5 model inventory)
  is superseded by the generated OpenAPI schema — regenerate, don't edit prose.

## Phase 4 pass 2026-11-02 — accounts hardening, envelope consistency, CSP

- Telegram enrollment tokens are now single-use (cache-marked on first
  /start) and carry a random nonce — previously a forwarded bind link could
  be replayed after unbind, handing the account's OTP delivery to whoever
  clicked it, and two links minted in the same second were byte-identical.
- OTP delivery (Telegram/SMS) runs AFTER the challenge row commits — provider
  latency no longer holds the per-phone advisory lock. Provider outages now
  answer the uniform 202 + ops log instead of a 500.
- Staff sessions via OTP for the /staff console are intentional (documented
  scaffold assumption); Django Admin stays password-only. Model docstring
  updated to match the blessed behavior.
- Not-found/not-yours semantics unified: billing checkout/refunds return 404
  for missing ids (was 400/409) and 404 for foreign orders (was 403), matching
  the owner-filtered views; `ValidationError({"detail": ...})` pseudo-field
  sites replaced with plain coded details.
- nginx ships a CSP (`script-src 'self'` — the SPA loads no third-party
  scripts); img-src/connect-src stay permissive until the licensed tile host
  is known, then tighten.
- Load smoke vs the dev container: anon throttle engaged exactly at the
  configured 300/min; 200s at p50 169ms under 30-way concurrency (DEBUG
  runserver) — consistent with the runbook's load checkpoint. Re-run against
  prod-shaped infra before launch sign-off (runbook note stands).
