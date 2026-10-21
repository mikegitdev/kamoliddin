# ADR-0005: Payment, refund and moderation state-machine deviations

**Status:** Accepted · **Date:** 2026-10-13 · **Scope:** maintainer-owned
financial invariants (repo AGENTS.md rule 3) — read before editing billing,
payments, renewals or moderation services.

> **Partially superseded by ADR-0007 (2026-10-20):** auto-renewal was removed;
> the renewal items below (§4, §5, §7 and renewal parts of §8) are history only.

## Context

Spec §7 defines the order/payment and campaign lifecycles. Implementation
reality required several explicit deviations, previously undocumented while
repo ground rule 2 pretended an ADR existed.

## Decisions & deviations

1. **Order state `payment_processing` is vestigial.** The provider flow goes
   `awaiting_payment → (provider-hosted page) → webhook`; we never observe a
   moment where *we* can truthfully set `processing`. It remains in the enum
   for forward compatibility; nothing sets it.
2. **`failed` is entered by the webhook failure path** and releases the
   order's capacity reservations (ADR-0003).
3. **Refunds never fabricate provider outcomes** (repo rule 4). With the fake
   provider, `refund_charge` executes and returns its reference. With an
   unverified real provider, an admin must supply the provider console's
   transaction reference (`provider_ref`) — without it, `process_refund`
   raises and the refund stays `refund_requested`. The unverified gateway is
   deliberately not instantiated on the staff-reference path.
4. **Renewal agreements under an unverified provider are `pending_token`
   with an empty `token_ref`.** `ensure_agreement_for_order` only mints the
   fake token when `PAYMENT_PROVIDER == "fake"`. The worker skips
   `pending_token` agreements (`skipped_pending_token`); enabling them via the
   API is refused with an explanatory error. When a recurring-capable
   provider is verified, a migration/backfill materializes real tokens.
5. **Re-consent semantics:** a NEW paid order with `auto_renew=True` is the
   latest explicit consent — its location set/duration refreshes the
   agreement snapshot (`renewal.consent_refreshed` audit event) and
   re-activates a disabled/alerted agreement. Ignoring the new consent was
   the prior, silently-wrong behavior.
6. **Moderation takedown has two routes:** `reject_campaign` accepts
   APPROVED (takedown → REJECTED, unlocking the edit/resubmit + refund flow)
   *and* `suspend_campaign` (APPROVED → SUSPENDED, no user edit path until
   admin unsuspend). Spec §7.1 only draws the suspend route; the reject-from-
   approved route is the one that drives the refund workflow in §7.2.
7. **One-shot renewal retry (deliberate, documented in
   open-questions.md):** a failed charge sets ALERT with no automatic retry;
   timed retries can be added behind the same `(agreement, period)`
   uniqueness when the provider is real.
8. **Reconciliation sweep shipped (2026-10-21):** `manage.py reconcile_payments`
   (+ `apps.payments.tasks.reconcile_payments_task`, beat every 5 min) resolves
   the webhook crash windows: (A) succeeded-but-unsettled attempts are re-run
   through `settle_payment_attempt` (idempotent, row-locked); (B) stale PENDING
   attempts (webhook lost) get **one authoritative** `get_payment_status` query —
   never a blind retry — and apply the same terminal transitions the webhook
   would have, including rescuing money that succeeded just before quote expiry
   (released reservations are resurrected by `activate_order_entitlements` or
   BLOCKED with a capacity-conflict audit event). Verified webhook payloads
   always win over a later status string; gateways that raise
   `NotImplementedError` (CLICK pending merchant verification) leave attempts
   untouched in the unresolved queue — the command exits non-zero and
   `ops_report` keeps alerting. **Forward note:** the `get_payment_status ->
   str` contract cannot re-verify the charged amount the way webhook payloads
   do; when a real provider's status API lands, extend it to return the amount
   and check it against the attempt before settling. *History (ADR-0007):* the renewal-side
   `renewalattempt.reconciliation` state was retired with auto-renewal.

## Consequences

- Any change to these flows requires updating this ADR in the same PR.
- `ops_report` exits non-zero on reconciliation/blocked/unsettled items so
  cron alerts.
