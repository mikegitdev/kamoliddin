# MVP launch checklist

Scope: paid local advertising in Tashkent, with **one-time payments only** per
[ADR-0007](../architecture/adr-0007-one-time-payment-no-auto-renewal.md).
No recurring billing, stored payment tokens or merchant-initiated charges.
The [engineering spec](../../Local_Advertising_Engineering_Spec_v1_EN.md) defines
functional acceptance; this checklist tracks launch evidence and sequencing.

A checked item requires recorded evidence. Existing code or fake-provider success
alone does not close an external gate. Local checks do not establish hosted CI or
production readiness.

## 1. Green engineering baseline

Run from the repository root with dependencies installed and the dev backend
container running (its `/app` mount must point at this checkout):

```bash
(cd frontend && npm run lint && npm run typecheck && npm run build)
docker exec localads-backend-dev python -m ruff check .
docker exec localads-backend-dev python -m mypy apps/billing apps/payments apps/placements
docker exec localads-backend-dev python manage.py check
docker exec localads-backend-dev python manage.py makemigrations --check --dry-run
docker exec localads-backend-dev python -m pytest
```

Local evidence: base revision `768d97f` plus the lint/docs changes on
`chore/green-baseline-launch-checklist`. Backend commands ran in the dev container
with this checkout mounted at `/app`.

- [x] Frontend lint, typecheck and production build pass.
- [x] Backend Ruff and financial-core mypy pass (43 source files).
- [x] Django system check and migration drift check pass.
- [x] Existing backend tests pass against real PostGIS: **125 passed**. The 54
  warnings all report the dev container's missing `/app/staticfiles/` directory.
- [x] OpenAPI schema and generated TypeScript match committed artifacts:
  regenerated into temporary files and compared byte-for-byte, without changing
  generated source files.
- [ ] Resolve the existing schema-generation diagnostic for `TelegramBindView`:
  drf-spectacular cannot infer its serializer and reports an error even though
  generation exits successfully and committed artifacts match. Handle this as a
  separate API-contract change; no endpoint or schema was changed in this task.
- [ ] Hosted CI is green for the release revision, not just the local checkout.

## 2. Real one-time payments — critical path

Owner: maintainer / merchant account holder. `ClickPaymentGateway` intentionally
raises `NotImplementedError` until provider behavior is verified.

- [ ] Merchant access and official integration documentation obtained.
- [ ] Verified one-time checkout, authenticated callbacks, amount/currency and
  order validation implemented without weakening permissions or idempotency.
- [ ] Sandbox and production evidence covers successful and failed payments,
  duplicate callbacks, provider timeout/reconciliation, refunds and settlement.
- [ ] Security-sensitive / paid-entitlement changes receive maintainer review.

Record evidence in `docs/architecture/click-verification.md` when available;
that evidence document does not exist yet. Use a verified compliant fallback if
CLICK cannot meet the one-time-payment contract. Do not restore recurring billing.

## 3. Providers and product/legal decisions — parallel work

- [ ] Choose licensed production map tiles (2GIS or licensed OSM provider), record
  quota/data-use terms and verify attribution. Configure `VITE_MAP_TILES_URL`,
  `VITE_MAP_GLYPHS_URL` and `VITE_MAP_ATTRIBUTION`; do not launch on public OSM tiles.
- [ ] Benchmark real OTP delivery by mobile network, latency, success rate,
  cost and sender registration; record in `docs/architecture/sms-benchmark.md`
  when available. Eskiz has a documented adapter; Play Mobile is unverified.
  Enrolled Telegram delivery does not replace SMS for first signup/phone changes.
- [ ] Product owner approves the final daily tariff, 25-hour display/2-day charge
  disclosure and partial-term refund policy. Provisional defaults remain tracked
  in [open questions](../architecture/open-questions.md).
- [ ] Qualified Uzbekistan counsel signs off the
  [legal checklist](../product/legal-review.md), including privacy, advertising,
  refund/fiscal obligations, personal-data hosting and backup destinations.
- [ ] Publish reviewed RU/UZ terms and privacy pages and implement the required
  consent records; do not treat an engineering checklist as legal approval.

## 4. Production rehearsal and acceptance

Owner: ops / maintainer. Follow the [deploy runbook](../runbooks/deploy.md).
Dev load measurements and a dev-data restore are useful prior evidence, not
production-shaped sign-off.

- [ ] Select domain, host, backup target, retention and RPO/RTO; confirm hosting
  and backup locations against counsel's advice.
- [ ] Deploy staging with the production Compose topology, real secrets, TLS,
  private DB/Redis/Garage and non-fake providers; record the release revision.
- [ ] Complete spec §17 functional acceptance, including ownership/admin denial,
  concurrent capacity, paid-but-unapproved invisibility, duplicate callbacks,
  late moderation, repeat purchase, expiry, free grants and refunds.
- [ ] Run the existing Playwright smoke specs against a disposable seeded dev
  stack (`cd frontend && npm run e2e`); record results. They depend on fake OTP
  delivery and mutate demo/OTP state, so do not point them at production.
- [ ] Manually verify responsive RU/UZ public, advertiser and staff journeys,
  keyboard/dialog basics and anonymous contact/directions links on staging.
- [ ] Complete a real payment → moderation → publication → expiry/refund flow;
  fake-provider smoke coverage is not a substitute.
- [ ] Restore off-server Postgres **and Garage media** to a clean environment;
  verify migrations, health, pins/search, media and payment reconciliation.
- [ ] Run representative production-shaped load; agree measured latency/error
  budgets instead of assuming the dev measurements predict capacity.
- [ ] Exercise alerts for worker/queue health, payment reconciliation, OTP errors,
  disk/storage, backup freshness and TLS expiry.
- [ ] Rehearse app rollback with the forward-only schema compatibility check.

## Release decision and rollback implications

Launch a paid pilot only after the applicable external and operational gates
above have evidence and maintainer/product sign-off. Record any waiver explicitly;
do not mark unfinished work as delivered.

The green-baseline task changes documentation and unused test imports only: no
runtime behavior, API schema, migrations, financial invariants or data backfill.
It requires no data rollback. ADR-0007's earlier destructive renewal migrations
remain forward-only; reverting these docs cannot restore the deleted data.
