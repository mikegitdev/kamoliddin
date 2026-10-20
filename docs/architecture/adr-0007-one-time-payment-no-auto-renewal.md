# ADR-0007: One-time payment per campaign order — auto-renewal removed

**Status:** Accepted · **Date:** 2026-10-20 · **Supersedes:** spec §8 [C]
"Automatic renewal — mandatory at launch", ADR-0005 §4, §5, §7 (renewal parts)

## Decision

The product owner decided that every campaign purchase is a **single one-time
payment** for the exact interval the advertiser picks. There is no recurring
billing, no stored payment token and no merchant-initiated charge.

To keep advertising longer, the owner buys again: a new quote → checkout for
the next interval (capacity semantics from ADR-0003 already allow a campaign
to extend itself at a full location).

## Consequences

- `Order.auto_renew` and the quote request's `auto_renew` field are removed
  (`billing.0003`). The `renewals` app keeps only its migration chain;
  `renewals.0004` drops `RenewalAgreement` / `RenewalAttempt`. Existing rows
  are deleted — irreversible by design (forward-only migration).
- Removed: `/api/v1/renewals*`, `/api/v1/admin/renewals`, the
  `run-due-renewals` beat task, `manage.py run_renewals`,
  `PaymentGateway.charge_recurring`, `next_renewal` in `/auth/me/summary`,
  renewal counters in `/admin/overview` and `ops_report`.
- The CLICK / fallback provider gate (spec §19 [E]) no longer needs
  recurring / tokenization capability — only one-time checkout, callbacks,
  refunds and settlement.
- The editor offers start presets (now, tomorrow 09:00, next Monday 09:00)
  and duration presets of 1, 3, 7, 14, 30, 60 and 90 days; pricing is
  unchanged (tariff × 24h slots × locations).

## Rollback

Restoring auto-renewal means re-adding the models with new migrations; the
dropped agreement/attempt rows cannot be recovered.
