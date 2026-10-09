# Open questions / assumptions log (spec §19 [O] items tracked here)

| # | Question | Current provisional default | Decided by |
|---|---|---|---|
| 1 | CLICK merchant-initiated recurring charges | Adapter unimplemented until merchant confirmation | pending provider |
| 2 | 2GIS licensing / tile economics | MapLibre + OSM tiles in dev only; production tiles unresolved | pending provider |
| 3 | Eskiz vs Play Mobile | Fake adapter in dev | pending benchmark |
| 4 | Final daily rate (UZS) | Demo tariff 30,000 UZS/24h | product owner |
| 5 | Renewal price policy (current tariff vs locked) | `current_tariff`, consent shown at opt-in | product owner |
| 6 | 25h request: display 25h (charge 2 days) vs display 48h entitlement | Honor requested display duration, disclose 2-day charge before payment | product owner |
| 7 | Partial-term refund on admin suspension | Manual review queue, no auto-proration | product owner |
| 8 | DNS / VPS sizing / RPO-RTO | Not yet chosen | ops design |

## Assumptions made while scaffolding (to be reviewed)

- Order carries a required `campaign` FK (checkout flow is campaign-scoped).
- OrderItem references Location; Placement rows are created by the settlement
  service at payment time, keyed on (campaign, location, start_at).
- Staff log into Django Admin with phone + password (OTP is for advertisers).
- Renewal provider idempotency uses `uuid5("renewal:<agreement>:<boundary>")`
  so hard-crash reruns dedupe at the provider side.
- Renewal retry policy: a failed charge sets ALERT (no automatic retry) until
  the advertiser re-enables or an admin reviews — deliberate MVP conservatism;
  timed retries can be added behind the same constraint.
