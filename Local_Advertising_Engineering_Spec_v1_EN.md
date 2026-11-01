# Local Advertising Map Platform
## Developer-Ready Engineering Specification — MVP v1.0

**Language:** English  
**Status:** Product baseline confirmed; technical design proposed; external provider gates outstanding  
**Geography:** Tashkent, Uzbekistan (citywide)  
**Delivery objective:** 8-week MVP, conditional on provider readiness and solo AI-assisted delivery capacity  
**Product owner decisions:** Discovery Rounds 1–10, with latest decisions superseding earlier conflicts  
**Document date:** 9 October 2026

**Scope update:** [ADR-0007](docs/architecture/adr-0007-one-time-payment-no-auto-renewal.md)
(accepted 20 October 2026) supersedes the original recurring-billing requirements.
The current MVP uses one-time payments only: no auto-renewal, stored payment tokens,
or merchant-initiated charges. The model/API inventory, release gates and roadmap
below reflect that decision. Track launch evidence in the
[launch checklist](docs/acceptance/launch-checklist.md).

## 1. Requirement status and scope control

- **[C] Confirmed:** Explicitly selected by product owner. Do not silently change.
- **[R] Recommended default:** Implementation recommendation requiring technical review, not an original business decision.
- **[E] External dependency:** Cannot be marked delivered without provider or legal verification.
- **[O] Open detail:** Decision not explicitly made; default remains provisional.

**[C] Product:** A paid local business advertising network centered on a live interactive map. The advertisement may be a discount, announcement, launch, opening, event, promotion, or general legitimate business message. A discount is NOT mandatory. This supersedes the temporary Round 5 promotion-only rule.

**[C] Excluded:** Individual-product/SKU catalog; shopping cart; customer checkout; delivery; price comparison; messaging between customers and businesses; rating/reviews; visitor authentication; ~~premium ranking in MVP~~ *(superseded 2026-10-31 by the product owner: uniform-priced TOP/RAISED promotion add-ons shipped post-MVP — see open-questions.md #17 and `docs/product/competitive-analysis-joymee.md`; the base daily rate stays uniform per spec §6)*; complicated role hierarchy; native mobile apps; advanced marketing analytics; SEO as an MVP launch priority.

**[C] Primary measurement:** Real paid advertising revenue in the first three months; meaningful nonzero payments validate willingness to pay. [R] Also instrument paid advertisers, repeat purchases, active locations, ad opens and outbound contact/directions clicks.

## 2. Locked stack and pending vendors

| Component | Selection | Status |
|---|---|---|
| Frontend | React, Vite, TypeScript | [C] |
| Backend | Python, Django modular monolith | [C] |
| REST API | Django REST Framework | [R] |
| Database | PostgreSQL with PostGIS | [C] |
| Geospatial ORM | GeoDjango, location point SRID 4326 | [R] |
| Map | 2GIS if commercially acceptable; licensed OSM stack otherwise | [C]/[E] |
| Payments | CLICK preferred for one-time checkout; verified compliant fallback if unavailable | [C]/[E] |
| SMS | Provider-neutral integration; benchmark Eskiz and Play Mobile | [C]/[E] |
| Object storage | Self-hosted Garage, S3-compatible | [C] |
| Hosting | One VPS, Docker Compose, external backups | [C] |
| Deployment | Documented manual Docker deployment initially | [C] |
| Background jobs | Celery worker + Celery Beat + Redis | [R] |
| Administration | Django Admin with custom actions | [R] |
| QA | Automated tests, type checking, linting before merge | [C] |
| Agents | Codex + Claude Code, parallel independent modules/worktrees | [C] |

**[R] Initial version baseline:** Django 5.2 LTS, compatible Python runtime, modern supported PostgreSQL/PostGIS images, Node LTS, dependency lock files and pinned Docker image tags. Confirm compatibility matrix before fixing exact patch versions.

**[R] Repository:** Monorepo with `frontend/`, `backend/`, `infra/`, `docs/`, `AGENTS.md`. Avoid separate microservices, Kubernetes, Elasticsearch, event buses, and a custom admin SPA in MVP.

## 3. Actors, tenancy, and core policies

| Actor | Abilities | Restrictions |
|---|---|---|
| Anonymous visitor | View map, search, categories, location details, active ads, contacts/directions | No account required; no paid admin APIs |
| Advertiser owner | Phone OTP login; create/edit company, locations, campaigns; pay and purchase another term explicitly | Access only owned business data; one owner per business in MVP |
| Administrator | Moderation, risk review, location takedowns, refunds, tariffs, limits, free grants, audit views | Authenticated staff and logged privileged actions |

**[C] Business onboarding:** Phone OTP -> business profile -> create map locations immediately. Admin reviews suspicious/reported location claims, rather than approving every new location. [R] Treat verified phone, claimed location and confirmed location ownership as separate flags; provide reports, collision detection, impersonation takedown, and action logs. A location can be created immediately but disabled from advertising when risk-flagged.

**[C] Campaign moderation:** Every NEW campaign requires administrator approval. [R] Meaningful edits after approval require re-review; an unchanged eligible campaign purchased for another term does not require repeated review.

**[C] General business advertising:** No mandatory discount or measurable promotion; classification uses business category. [R] Optional internal ad-type tags (opening/event/sale/announcement) may be stored but should not create new essential user workflows.

## 4. Conceptual domain model and cardinalities

- User 1:N Business is not required by launch UX: [C] one owner per business; [R] database may allow one user to own several businesses while each business has exactly one current owner.
- Business 1:N Location; each location holds its own coordinates, address, hours, contacts and moderation flags.
- Business 1:N Campaign; campaign stores shared ad copy and exactly one banner.
- Campaign 1:N Placement; each placement joins precisely one location to one paid/granted advertising interval.
- Placement N:1 Location; many distinct campaigns can be simultaneously advertised at a location, subject to a configurable active limit.
- Order 1:N OrderItem; each line purchases one placement for a defined charged term and immutable quoted price.
- PaymentAttempt N:1 Order; one order may have multiple provider attempts and events; one fully paid order activates its purchased entitlements exactly once.
- Grant creates zero-charge entitlements; a grant is NOT a successful financial payment.

**Critical invariant:** Campaign != Placement != Order != Payment. They have different lifecycles and audit requirements.

## 5. Detailed Django model inventory

| Model | Essential fields | Constraints / indexes |
|---|---|---|
| User | id UUID, phone_e164, is_active, created_at | Unique normalized phone; OTP rate limits |
| OTPChallenge | phone_hash, code_hash, purpose, expires_at, attempts, resend_after, consumed_at | TTL, max attempts, no plaintext codes |
| Business | id, owner_id, name, slug, category_id, logo_key, description, phone, telegram, whatsapp, site, status | Ownership FK; name is not proof of legal identity |
| BusinessCategory | id, slug, name_ru, name_uz, active, sort_order | Unique slug |
| Location | id, business_id, name, address, city, point(PointField), contact fields, hours JSON, status, risk_flags | GiST spatial index; same-business FK checks |
| Campaign | id, business_id, headline, body, banner_key, review_status, review_version, created_at | Exactly one primary image; lifecycle auditing |
| CampaignReview | campaign_id, content_version, reviewer_id, decision, reason, timestamp | Immutable decision record |
| Placement | id, campaign_id, location_id, start_at, end_at, state, source_type, charge_days | Foreign keys; same-business validation; no public visibility without entitlement |
| Tariff | id, currency UZS, amount_per_24h, valid_from, valid_until | Date-effective rates; admin edit only |
| Order | id, business_id, amount_total, currency, state, quote_expires_at, created_at | Server-generated totals; immutable once paid |
| OrderItem | order_id, placement_intent_id, location_id, unit_rate_snapshot, charge_days, line_total | Locked financial snapshot |
| PaymentAttempt | order_id, provider, provider_payment_id, idempotency_key, amount, status, response_digest | Provider-ref uniqueness; retries recorded |
| PaymentEvent | provider, event_id, payment_attempt_id, validated_payload_digest, received_at | Deduplicate webhook identifiers |
| Refund | order_id, amount, reason, state, operator_id, provider_ref, completed_at | Manual review and separate accounting |
| FreeGrant | business_id, campaign_id, location_id, start_at, end_at, reason, admin_id | Zero collected money; distinct source |
| ActivityEvent | actor, action, entity, entity_id, metadata, created_at | Append-only administrative audit trail |
| PlatformSetting | key, value_json, changed_by, changed_at | Default max active ads/location = 5 |

**[R] Schema refinements:** UUID identifiers; `created_at/updated_at`; soft disable business and location instead of physical deletion; integer minor currency amounts, not floating-point; versioned API contracts. Use `timestamptz` UTC internally; display Asia/Tashkent. Enforce same-business membership in transactional service methods plus database-compatible constraints where practical.

**[R] PostGIS:** query within viewport bounding box plus indexed point; use geographic distance for proximity. Avoid cross-provider geocoder IDs as primary keys. Keep owner-entered address text and coordinates independent from map provider.

## 6. Price calculation and term semantics

**[C]** Uniform platform daily price per location; no bulk discounts. User selects arbitrary planned start and end times. Charge `max(1, ceil((requested_end - requested_start)/86,400 seconds))` whole 24-hour units for each selected location. Sum line items across locations. Quote is calculated on server and stored with rate snapshot. *(Amendment 2026-10-31, product owner: optional uniform-priced visibility add-ons — TOP and RAISED per 24h per location — may be selected at quote time; extended 2026-11-01: the same tiers can also be bought afterwards for an already-running placement as a separate one-time order (kind=promotion, 1..30 days, window starting at settlement). Each is a platform-wide uniform price, snapshotted into the order line like the base rate. Still no individual pricing, no bulk discounts, no wallet. See open-questions.md #17–#18.)*

**[C]** After late moderation, move the entire scheduled campaign interval forward to a newly assigned activation time, preserving the purchased duration. [R] If originally scheduled in future, activate at scheduled time after approval and valid payment; if scheduled start has passed, activate once all gates succeed. Persist `actual_start_at` and `actual_end_at` per placement. Distinguish requested interval from *charged full-block entitlement*: [O] whether a 25-hour user request displays for 25 hours while billing two days or displays the full 48-hour entitlement should be decided explicitly in UX; proposed default is honor requested display duration but charge 2 units, consistently disclosed before payment.

**[C]** Online payment during campaign submission. All newly created campaigns are moderated before becoming public. Corrected rejected campaigns may be resubmitted; advertiser cancellation after rejection leads to an administrator-processed refund.

**[R] Financial controls:** Price snapshot immutability after order confirmation; idempotent checkout creation; no activation from client return URL alone; backend verifies provider authorization/callback signatures and order amount/currency; recorded refund actions never erase payment records.

## 7. Campaign, payment and moderation state machines

### 7.1 Campaign content lifecycle

`draft -> submitted -> under_review -> approved | rejected`

`rejected -> editable -> submitted` (new content version). `approved -> published` only when one or more valid placements are active. `approved -> suspended` on administrative takedown. Expired campaigns remain internally retained but are invisible in every public endpoint and direct URL. No hard deletion of financial/audit records.

### 7.2 Order and payment lifecycle

`draft_quote -> awaiting_payment -> payment_processing -> paid | failed | expired`

Payment may finish before moderation. A PAID order creates rights to publish, not immediate public visibility. On permanent rejection, show correction/cancellation options; cancellation creates `refund_requested -> admin_review -> provider_refund_processing -> refunded | refund_failed`.

Order payment and campaign approval are **separate gates**. Placement eligible when: business/location not suspended, campaign content approved, fully paid or valid free grant, scheduled start reached, end not reached, capacity reserved, no active ban. Activation must be idempotent.

### 7.3 Placement states

`pending -> scheduled -> active -> expired`; abnormal `blocked`, `cancelled`. A business location may be flagged and suppressed without disabling other branches belonging to the same campaign. Public query checks eligibility rather than trusting a cached `active` flag alone.

### 7.4 Free grants

Admin may issue placement grant with effective term and a reason, creating zero-paid financial amount and grant source. Moderation rules still apply. Admin must not manufacture a successful CLICK payment event. Free placements rank identically with paid placements in MVP.

## 8. One-time payments and explicit repeat purchases

**[C]** Per ADR-0007, each campaign order is a single one-time payment for the
advertiser's selected interval. Automatic renewal, stored payment tokens and
merchant-initiated charges are out of scope. The original mandatory-renewal
requirement is superseded; its removal and forward-only migrations are recorded
in ADR-0007.

To advertise longer, the owner explicitly requests a new quote and checkout for
another interval. Pricing and capacity checks still apply; unchanged approved
content does not require another review. An unpaid or failed purchase never
extends public visibility beyond an existing paid term.

**[E] Must prove with CLICK or a verified compliant fallback:** One-time checkout,
authenticated callbacks, amount/currency rules, refunds and settlement. Duplicate
callbacks must not create duplicate entitlements, and ambiguous provider state
must enter reconciliation rather than trigger a blind repeat charge.

## 9. Phone OTP authentication and SMS adapter

**[C]** SMS provider-neutral implementation and comparative tests with Eskiz and Play Mobile. **[R]** Use E.164 normalization for Uzbek numbers, short-lived hashed OTPs, resend throttling, IP and phone number rate limits, daily quotas and generic anti-enumeration responses. Successful OTP creates an authenticated server session; use secure HttpOnly cookies with CSRF protection on mutating requests, or an equivalent documented token strategy. Never store OTP plaintext, SMS credentials or session secrets in repository.

**Provider contract [R]:** `send_otp(phone_e164, message, request_id) -> provider_message_id` and `get_delivery_status(provider_message_id)` where supported. Track latency, successful deliveries, failures, operational cost, sender registration lead time and per-network reliability. Fake provider available in local/test environments; production adapter chosen only after integration benchmark.

**Addition (2026-10-22) [R]: Telegram delivery channel.** Login codes may be
delivered to a Telegram chat **enrolled under an authenticated session** via a
signed one-time deep link (ADR-0006); SMS stays available as forced fallback
(`channel=sms`) and on any delivery failure. Phone-change codes remain SMS-only.
No unauthenticated phone→chat delivery exists (would allow account takeover).

## 10. Map design and provider abstraction

**[C]** Homepage fills majority of viewport with map, floating search/category controls, and responsive location details. Pins represent locations; display count of *currently active public* ads per location. Zoomed-out map clusters; at identical coordinates an overlap selector exposes independent businesses. Clicking location shows business identity/address/contact and active ad list. Result ordering is relevance first then distance. No paid ranking boost in MVP.

**[R]** Backend endpoint returns filtered location identifiers, coordinates and active counts, not 2GIS raw POI data. Frontend map adapter interface: `initialize`, `setCenterZoom`, `setMarkers`, `setClusters`, `onViewportChange`, `onMarkerClick`, `destroy`. 2GIS MapGL adapter primary; licensed OSM/MapLibre adapter fallback. Cluster count semantics should distinguish number of locations vs number of ads, never ambiguously label both as 'count'.

**[R]** On move/zoom request viewport results using debounce; fetch only active locations in bbox, apply category/text filters in server, paginate/limit large responses; mobile location card uses bottom sheet. Directions open external provider, not a built-in router. Preserve own stored coordinates even if maps vendor changes, subject to provider geocoding storage license.

**[E]** Verify commercial 2GIS licensing for a public map-heavy advertising site, key provisioning, map-tile request prices, geocoding and coordinate-storage rules, Tashkent address coverage, mobile performance, attribution. Fallback requires correctly licensed map tiles, attribution, a tile host (public OSM tiles must not be used as an unlimited production CDN) and compatible geocoding.

## 11. Media, security and privacy

**[C]** One banner per campaign; logos for businesses; self-hosted Garage/S3-compatible storage.

**[R]** Upload flow: authenticated user requests signed upload or server-mediated temporary upload -> type/size/magic-byte validation -> optional image re-encoding/metadata stripping -> public reference only for approved campaigns. Use UUID object keys; never trust original filename, prevent SVG/script injection by policy, set cache headers and image variants. Ensure expired campaign details are inaccessible through public API even if an old public image URL remains cached.

**[R]** Security: HTTPS, secure sessions/CSRF or token policy, permission-scoped querysets, least-privilege database and object access, API throttling, request validation, admin MFA where feasible, audit logs, backup encryption, restricted provider secrets, webhook signature validation, container patches, dependency scanning and incident response for impersonation or fraud. No retention of card PAN/CVV. Define basic privacy notice, cookies, contact data handling and required advertising disclosures with legal review.

## 12. API contract — DRF v1

Prefix `/api/v1`; REST JSON; consistent `id`, `created_at`, `updated_at`, ISO 8601 UTC timestamps, machine-readable `error.code`, `error.message`, `error.fields`, `request_id`; standard HTTP 400/401/403/404/409/422/429. API specification generated as OpenAPI; typed TypeScript client generated from OpenAPI and committed or built in CI.

| Verb | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | /auth/otp/request | Public rate limited | Create OTP challenge |
| POST | /auth/otp/verify | Public rate limited | Verify OTP/login |
| POST | /auth/logout | Owner | Terminate session |
| GET,POST | /businesses | Owner | List/create own businesses |
| GET,PATCH | /businesses/{id} | Owner | Own profile |
| GET,POST | /businesses/{id}/locations | Owner | Manage branch list |
| PATCH | /locations/{id} | Owner | Edit branch details |
| GET | /categories | Public | Business category list |
| GET,POST | /campaigns | Owner | My campaigns/create draft |
| GET,PATCH | /campaigns/{id} | Owner | Campaign details/edit draft |
| POST | /campaigns/{id}/submit | Owner | Submit and initiate payment flow |
| POST | /orders/quote | Owner | Price quote for dates and branches |
| GET | /orders/{id} | Owner | Order/payment status |
| POST | /orders/{id}/checkout | Owner | Create idempotent provider checkout |
| POST | /payments/click/webhook | Provider | Authenticated and deduplicated webhook |
| POST | /payments/{provider}/webhook | Provider | Alternate approved provider adapter |
| GET | /public/locations | Public | Filter bbox/category/query active pins |
| GET | /public/locations/{id} | Public | Business location and active ads |
| GET | /public/campaigns/{id} | Public | Active-only ad details |
| GET | /public/search | Public | Relevant locations/campaigns |
| POST | /public/reports | Public rate limited | Report suspicious business/ad |
| POST | /admin/campaigns/{id}/review | Staff | Approve/reject version |
| POST | /admin/grants | Staff | Issue zero-charge placement grant |
| POST | /admin/refunds/{id}/process | Staff | Manually process refund |
| PATCH | /admin/settings/ad-limit | Staff | Change max simultaneous ads |

**[R] Example search:** `GET /api/v1/public/locations?bbox=69.15,41.20,69.40,41.40&category=restaurant&q=pizza&limit=200`; require bbox size and response count bounds and protect against large spatial scans. Actual pagination/cluster responses require load testing.

**[R] Quote request:** `{business_id, campaign_id, location_ids, requested_start_at, requested_end_at}`. Response: `{quote_id, currency:"UZS", billable_days, unit_price_minor, line_items, total_minor, expires_at}`. Frontend must never supply authoritative price. Server rejects inconsistent location business ownership or conflicts with per-location cap.

**[R] Provider webhooks:** Must validate authenticity, timestamp/replay where available, amount, currency, merchant identity, order reference, and provider event identity before entering financial transaction service. Respond idempotently; recover through reconciliation when state ambiguous.

## 13. Frontend route and screen requirements

| Route | Screen | Acceptance focus |
|---|---|---|
| / | Map-first homepage | Full map, active pins, search and filters, empty state |
| /locations/:id | Location detail | Business profile, active ads, directions/contact actions |
| /ads/:id | Public advertisement | Approved paid/granted active only; expired returns unavailable |
| /login | Phone OTP login | Resend countdown, errors, throttle |
| /app | Advertiser overview | Active, pending, rejected, expired counts |
| /app/business | Business profile | Owner editing and validation |
| /app/locations | Branch management | Map picker, coordinates and contact data |
| /app/campaigns | My campaigns | Status filters, create/copy/purchase another term |
| /app/campaigns/new | Campaign editor | One banner, content, locations and dates |
| /app/checkout/:id | Pricing and payment | Server quote, provider redirect/confirmation, non-success states |
| /app/billing | Orders and payments | Receipts/status, cancellation, refund request |
| /admin/ | Django Admin | Moderation, tariffs, grants, refunds, risk reports |

**[R]** Build responsive map controls with accessible dialogs, keyboard navigation, mobile bottom sheet, loading skeletons and localized date/currency formatting. [C] Support Russian and Uzbek UI; use translation dictionaries, no hardcoded UI strings. SEO prerendering is NOT a launch blocker; publicly shared direct links must still work.

## 14. Business and security edge cases

| Scenario | Expected invariant |
|---|---|
| SMS resend flood | Throttle/lock; no unbounded provider costs |
| Duplicate business claim at same location | Flag review; do not silently merge ownership |
| Business blocked mid-term | Hide ads at affected locations, retain accounting; admin handles dispute |
| Two businesses at identical coordinates | Both separately accessible; map overlap selector |
| Six concurrent active ads with limit five | Sixth cannot activate; prospective interval conflict checked |
| Campaign paid, not approved | No public listing; preserve full paid duration |
| Moderation after requested start | Shift to actual eligible activation; preserve duration |
| Paid campaign rejected | Allow correction; cancellation -> admin refund workflow |
| Payment callback repeated | No duplicate entitlement/charge recorded |
| Provider charged but response timed out | Query provider; do not blind retry |
| Repeat purchase fails or remains unpaid | Existing paid term remains valid; no unpaid extension |
| Checkout or callback repeated | No duplicate payment attempt or entitlement for the same idempotent operation |
| Paid term ends without another purchase | Hide ad exactly at paid-term end; no automatic charge or unpaid grace |
| Campaign content changed after approval | Re-review content version before public display |
| Expired direct URL | No public ad content (e.g. 404/410) |
| Free grant | Public eligibility equivalent, paid revenue still zero |
| Location reassigned to different business | Block transition until reviewed; no cross-tenant links |
| One VPS fails | Restore verified off-server backups and recheck payment reconciliation |

## 15. DevOps: single VPS Docker Compose

**[C]** One production VPS, manual reproducible deployment, off-server backups. **[R]** Compose services: reverse proxy/static frontend; Django web (Gunicorn or compatible WSGI runner); Celery worker; Celery scheduler; PostgreSQL/PostGIS; Redis; Garage. Separate internal service network; only proxy ports publicly open, Garage admin private, DB private. Use named volumes, separate storage paths and off-server snapshots.

**[R]** Deployment script: (1) verify environment and image tags; (2) off-server DB backup and object backup; (3) pull/build tagged images; (4) run migration checks and `migrate`; (5) start services; (6) health check frontend/API/worker; (7) reconcile jobs/payments; (8) record release SHA; (9) documented rollback including forward-only schema migration caveats. No automatic destructive migration during startup. Protect prod .env/secrets with server permissions, no git commits.

**[R]** Monitoring: structured application and HTTP logs, payment failures and reconciliation queue, Celery heartbeat and backlog, disk capacity, Garage storage usage, DB backup freshness, TLS expiry, OTP errors. Export backup snapshots off the VPS. Perform at least one restore drill before launch.

## 16. AI-agent development operating model

**[C]** Maximum practical parallelization using Codex and Claude Code in isolated modules/worktrees. **[R]** Define immutable contracts before parallel implementation: one architect/maintainer owns domain schema, API versioning and payments state machines. Other agents own features behind contracts. Do not allow parallel edits of the same migration chain, financial invariants or environment compose file.

**Recommended directory tree:**

```text
local-ads/
  frontend/src/{app,pages,features,entities,shared,map-adapters}
  backend/{config,apps/{accounts,businesses,locations,campaigns,
                       placements,billing,payments,discovery,moderation}}
  infra/{docker,nginx,scripts,backups}
  docs/{product,architecture,api,adr,runbooks,acceptance}
  frontend/e2e/
  AGENTS.md
```

**AGENTS.md rules [R]:** English only; read domain ADR before editing; one task/branch/worktree; no fabricated provider behavior; every PR includes migrations/API schema/tests; never write raw card data; never bypass permissions; preserve idempotency; security and paid entitlements require maintainer review; run lint/typecheck/tests; include rollback implications; no unexplained package upgrades; no failing CI; log open assumptions. Assign Codex and Claude Code separate review roles periodically to find integration bugs.

**[R] Parallel batches:**
- Batch A: auth/SMS adapter, categories/businesses/locations, map adapter, frontend design system; agreed contracts first.
- Batch B: campaign editor, public map/search, admin moderation, Garage upload pipeline.
- Batch C: one-time payment provider integration and reconciliation (single-owner module), frontend checkout, monitoring and QA.

## 17. Testing and release gates

**[C]** All changes require automated unit/integration tests, type checks and lint checks before merge. **[R]** Backend pytest + pytest-django, Ruff, mypy/pyright; frontend Vitest, ESLint, `tsc --noEmit`; Playwright for end-to-end; real PostGIS test service for spatial query tests. Financial concurrency and callback tests must run under an actual transactional PostgreSQL environment, not SQLite.

**Acceptance suite (release-blocking):**
1. OTP registration and throttling work; fake adapter deterministic; provider benchmark documented.
2. Owner can create a business and many locations; cannot edit another user's objects.
3. User can create one campaign, one banner, and select 20 branches; system creates intended placements only.
4. Quote = configured rate * branch count * ceil(duration/24h); 25h rounds to 2.
5. One failed payment creates no valid paid entitlement.
6. One successful authorized payment creates entitlements once despite duplicate callbacks.
7. Paid but unapproved ad does not appear anywhere public.
8. Late approval preserves full purchased term at shifted start time.
9. Rejected paid campaign can be edited/resubmitted without double payment; cancellation enters manual refund queue.
10. Each business-location pin displays correct count of active ads, not historical ads.
11. Map clusters zoom out and exposes coincident locations separately.
12. Search prioritizes relevance and then distance; nonmatching category excluded.
13. Location ad cap 5 enforced under concurrent publishing and repeat-purchase attempts.
14. Expired or blocked advertisement returns no public detail, direct URL included.
15. Free grant displays normally, with exactly zero paid revenue.
16. Another campaign term requires an explicit new quote and one-time checkout; no automatic charges or stored payment tokens.
17. A successful repeat purchase creates its intended entitlements once despite duplicate callbacks.
18. An unpaid or failed repeat purchase does not extend publication beyond an existing paid term.
19. Provider timeout enters reconciliation; never blind-charge again.
20. Browser contact and external directions links work without visitor login.
21. RU/UZ text and mobile UI meet basic accessibility and smoke tests.
22. External DB and media backups restore to a clean container environment.
23. Unauthorized admin APIs and cross-tenant financial references are rejected.
24. Provider production one-time checkout, callback, refund and settlement evidence and merchant rights are documented.

**[R] Performance gates:** benchmark with representative Tashkent locations and ads. Define map initial render, bbox query latency, app response budget and error thresholds using measured load; do not invent scale guarantees without test data.

## 18. Eight-week roadmap and ownership

| Week | Main deliverables | Exit gate |
|---|---|---|
| 1 | Monorepo, API conventions, Docker dev environment, initial schema, CLICK one-time checkout and 2GIS/OTP POCs | Merchant checkout feasibility known; major vendor blockers documented |
| 2 | OTP, user/business/location modules, GeoDjango query, admin bootstrap | Auth, ownership and map coordinates tested |
| 3 | Campaign editor, Garage image flow, location assignment, category UI | Complete draft workflow works |
| 4 | Tariffs, immutable quotes, CLICK checkout, order/attempt/event states, moderation | Paid pending campaign never public; idempotency green |
| 5 | Placement scheduler/worker, repeat purchases, payment reconciliation, manual refund queue | Payment concurrency, reconciliation and expiry tests green |
| 6 | Public map, 2GIS markers and clustering, search, location cards, fallback adapter interface | Anonymous visitor journey and map tests green |
| 7 | RU/UZ, responsive UX, security hardening, E2E, free grants and reporting | All functional acceptance tests green |
| 8 | Restore drill, load test, production settings, runbooks, release, pilot advertising | Real payment proof, rollback rehearsal and acceptance signoff |

**Planning warning:** eight weeks for mostly one person with AI agents is an aggressive target, not a guaranteed delivery date. Merchant approval for one-time payments, map licensing and legal policy are hard gates. Work should be parallelized only after schema/API decisions are stable. If a provider fails, switch to a verified compliant provider while preserving the PaymentGateway contract and ADR-0007's one-time-payment scope.

## 19. External verification and remaining open items

| Item | Status | Completion evidence |
|---|---|---|
| CLICK production one-time checkout | [E] Critical | Merchant confirmation + sandbox/prod checkout, authenticated callback, duplicate-callback, reconciliation, refund and settlement evidence |
| Fallback compliant one-time payment provider | [E] Conditional | Written terms + verified checkout/callback/refund/settlement capability |
| 2GIS business usage and map tiles economics | [E] Critical | Commercial offer, quota and permitted data-use terms |
| OSM fallback tiles/geocoding licenses | [E] Conditional | Approved provider or self-hosted plan and attribution |
| Eskiz vs Play Mobile performance and prices | [E] Important | Test results, SMS quotes, sender registration |
| Advertising/consumer/privacy/refund compliance in Uzbekistan | [E] Critical | Reviewed terms, privacy notice, advertising content rules |
| Final daily rate | [O] | Admin-set price approved by product owner |
| 25h request: actual visibility 25h or billed 48h entitlement | [O] | Product acceptance of displayed term rule |
| Partial term refund on administrative suspension | [O] | Written refund policy |
| Provider names, DNS, VPS sizing, retention RPO/RTO | [O] | Operational design and stress test |

## 20. Definition of Done

The release qualifies as MVP only if a phone-verified owner can register, create a business/location, purchase a multi-location campaign through a verified one-time payment provider, pass moderation, appear on a responsive location-pin map, receive contact traffic and expire on time. Another term requires an explicit new quote and checkout; duplicate callbacks must not duplicate entitlements, and failed or unpaid purchases must not extend visibility. Internal administrators must moderate, grant free placements and process refund requests, and off-server database and media backup restoration must work. Licensed production maps, verified OTP delivery and legal sign-off remain launch gates. No payment-provider simulation is sufficient to claim production payments are complete.

## 21. External technical references

- Django 5.2 / GeoDjango: https://docs.djangoproject.com/en/5.2/ref/contrib/gis/
- GeoDjango spatial database support: https://docs.djangoproject.com/en/5.2/ref/contrib/gis/db-api/
- 2GIS MapGL marker clustering: https://docs.2gis.com/en/mapgl/objects/clustering
- 2GIS map tile charging: https://docs.2gis.com/en/mapgl/overview/tariffs

**Provider-specific payment and SMS behavior remains an integration verification task, not a guaranteed feature based on marketing pages or unverified third-party examples.**
