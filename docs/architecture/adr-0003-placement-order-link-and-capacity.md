# ADR-0003: Placement↔Order linkage, capacity engine, and reservation semantics

**Status:** Accepted · **Date:** 2026-10-13 · **Supersedes:** implicit behavior before this ADR

## Context

Spec §14 requires "six concurrent active ads with limit five → sixth cannot
activate" *under concurrent publishing and renewal attempts*, and refunds must
stop display of exactly the purchased placements. The pre-ADR implementation
checked capacity only at quote creation (advisory), did not link placements to
the order that purchased them, and matched refund cancellations by
`start_at = order.interval_start_at` — which late-moderation interval shifts
(spec §6 [C]) silently broke.

## Decisions

1. **`Placement.order` FK (nullable; grants stay null).** Refunds cancel
   `Placement.objects.filter(order=refund.order, state__in=[pending,
   scheduled, active])` — exact, immune to interval shifts. A data migration
   backfills legacy rows by `(campaign, interval start)` with a
   charged-duration fallback for shifted placements.
2. **Capacity is a shared predicate with three states counted:**
   `pending + scheduled + active`. A checked-out order *reserves* its slots by
   creating its placements as PENDING at checkout, before any provider session
   exists — so exhaustion refuses checkout while no money has moved.
3. **Decisions serialize per location** via `pg_advisory_xact_lock` on a
   stable 63-bit key derived from the location UUID. The lock is
   transaction-scoped, so it is held until the outermost checkout/settlement
   transaction commits — closing the two-concurrent-checkouts race that
   per-statement row locks cannot (phantom inserts).
4. **No own-campaign exclusion.** An earlier draft excluded the purchasing
   campaign from the count; concurrency testing proved that unsound — a
   campaign could stack its own ads past the location cap while every
   individual check passed. The overlap filter already gives renewals a free
   hand: a new term starts at the old term's end (zero overlap), so extending
   or renewing oneself at a full location works *without* any exclusion, while
   a second simultaneous ad of the same campaign consumes a slot like anyone
   else's.
5. **Reservations are released, never squatted:** order expiry (quote TTL +
   2h grace for in-flight callbacks), payment failure (order → FAILED), and
   refunds all cancel the order's PENDING placements.
6. **Settlement is the final guard:** a PAID order whose slot vanished in
   between (race, admin cap change) gets a BLOCKED placement with
   `block_reason="capacity_conflict"` plus an audit event for the admin refund
   queue. A paid order never silently overbooks; public eligibility
   (`eligible_now_q`) never counts BLOCKED. A reservation released before a
   late successful webhook is resurrected under a fresh capacity check.
7. **Only PAID orders' pending placements are promoted by moderation
   approval** (`on_campaign_approved` filters `order__state=PAID`) — an
   unpaid-but-checked-out reservation must not become public exposure when an
   admin approves the campaign early.

## Consequences

- `payment_processing` remains unused in the order state machine (documented
  in ADR-0005); FAILED is entered by the webhook failure path.
- Acceptance #13 is proven by threaded tests against real PostgreSQL
  (`apps/placements/tests/test_capacity_concurrency.py`).
