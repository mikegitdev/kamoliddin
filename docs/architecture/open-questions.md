# Open questions / assumptions log (spec §19 [O] items tracked here)

| # | Question | Current provisional default | Decided by |
|---|---|---|---|
| 1 | CLICK merchant-initiated recurring charges | Adapter unimplemented until merchant confirmation; agreements created as `pending_token` with empty token (ADR-0005) | pending provider |
| 2 | 2GIS licensing / tile economics | MapLibre + OSM tiles in dev only; production tiles unresolved — **launch blocker: public OSM tiles must not serve prod** | pending provider |
| 3 | Eskiz vs Play Mobile | Fake adapter in dev; Eskiz adapter implemented from published docs (ADR-0006) but benchmark not run; Play Mobile unverified | pending benchmark |
| 4 | Final daily rate (UZS) | Demo tariff 30,000 UZS/24h | product owner |
| 5 | Renewal price policy (current tariff vs locked) | `current_tariff`, consent shown at opt-in | product owner |
| 6 | 25h request: display 25h (charge 2 days) vs display 48h entitlement | Honor requested display duration, disclose 2-day charge before payment | product owner |
| 7 | Partial-term refund on admin suspension | Manual review queue, no auto-proration | product owner |
| 8 | DNS / VPS sizing / RPO-RTO | Not yet chosen | ops design |
| 9 | Reconciliation sweep command | Not shipped; `ops_report` surfaces ambiguous states for manual resolution | engineering backlog |
| 10 | Renewal timed retries | One-shot (ALERT, no retry) — revisit with real provider (ADR-0005 §7) | engineering backlog |

## Evidence that closes each [E] gate (spec §19)

| Gate | Evidence required to close |
|---|---|
| CLICK recurring | Sandbox + production merchant-initiated charge, retry with same idempotency key, refund, and settlement report, recorded in `docs/architecture/click-verification.md`; then implement `charge_recurring`/`refund_charge` in `ClickPaymentGateway` and backfill `pending_token` agreements |
| 2GIS / tiles | Signed commercial offer with quota + data-use terms, or a licensed OSM tile host; configure `VITE_MAP_TILES_URL` (frontend) and update `docs/runbooks/deploy.md` |
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
