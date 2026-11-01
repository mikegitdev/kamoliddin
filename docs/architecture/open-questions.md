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
