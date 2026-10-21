"""Payment reconciliation sweep (spec §7.2/§12, ADR-0005 note 8).

Closes the two crash windows the webhook flow cannot heal by itself:

A. **Succeeded-but-unsettled** — the webhook committed ``attempt.status =
   succeeded`` but the process died before ``settle_payment_attempt`` ran.
   Money moved at the provider while the order still shows unpaid. The sweep
   re-runs settlement; it is atomic, row-locked and idempotent, so this leg
   needs no provider call at all.

B. **Stale PENDING attempts** — the provider's webhook never arrived (lost
   callback). After ``STALE_PENDING_AFTER`` the sweep asks the gateway for the
   authoritative status via ``get_payment_status`` — a *query*, never a blind
   retry — and applies the same terminal transitions the webhook would have.
   Orders already EXPIRED by ``refresh_states`` are included: money that
   succeeded at the provider right before quote expiry must still deliver its
   entitlement (``activate_order_entitlements`` resurrects released
   reservations under a fresh capacity check, or BLOCKS with an audit event
   for the refund queue).

Invariants:
- Idempotent: a second run is a no-op (terminal attempt states and PAID
  orders are excluded from the queries).
- Verified webhook payloads always win over a later status-query string: the
  terminal write is row-locked and refuses to downgrade an attempt a webhook
  already moved (a local ``failed`` vs authoritative ``succeeded`` conflict
  is reported for manual resolution instead of being auto-flipped).
- No fabricated provider outcomes (repo rule 4): gateways that raise
  ``NotImplementedError``/``LookupError`` (e.g. CLICK pending merchant
  verification) leave the attempt untouched in the unresolved queue — surfaced
  by the command's non-zero exit and ``ops_report``.
"""
import hashlib
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.billing.models import Order

from .gateways import get_payment_gateway
from .models import PaymentAttempt
from .settlement import settle_payment_attempt

logger = logging.getLogger(__name__)

# A pending attempt older than this gets an authoritative provider status
# query. Must stay well below QUOTE_TTL + AWAITING_PAYMENT_GRACE (1h + 2h)
# so the sweep can rescue a paid-but-expired order before anyone refunds it.
STALE_PENDING_AFTER = timedelta(minutes=30)

# Provider status strings treated as terminal failure (mirrors webhook path).
_FAILURE_STATUSES = frozenset({"failed", "expired", "cancelled"})


def _reconcile_digest(attempt: PaymentAttempt, outcome: str) -> str:
    """Audit marker: this terminal state came from a reconciliation status
    query, not from a verified webhook payload."""
    raw = f"reconcile:{attempt.provider}:{attempt.provider_payment_id}:{outcome}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _mark_terminal(attempt_id, outcome: str) -> str:
    """Move a PENDING attempt to its reconciled terminal state under a row
    lock. If a verified webhook already moved it, that state wins and is
    returned unchanged. Returns the attempt's resulting status."""
    terminal = (
        PaymentAttempt.Status.SUCCEEDED
        if outcome == "succeeded"
        else PaymentAttempt.Status.FAILED
    )
    with transaction.atomic():
        row = PaymentAttempt.objects.select_for_update().get(pk=attempt_id)
        if row.status == PaymentAttempt.Status.PENDING:
            row.status = terminal
            row.response_digest = _reconcile_digest(row, outcome)
            row.save(update_fields=["status", "response_digest", "updated_at"])
        return row.status


def _fail_unpaid_order(order_id) -> bool:
    """Webhook failure-path equivalent: fail an AWAITING_PAYMENT order and
    release its capacity reservations (spec §7.2, ADR-0003). EXPIRED orders
    keep their state — refresh_states already released their reservations."""
    from apps.placements.services import release_order_reservations

    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        if order.state != Order.State.AWAITING_PAYMENT:
            return False
        order.state = Order.State.FAILED
        order.save(update_fields=["state", "updated_at"])
        release_order_reservations(order)
        return True


def reconcile_payments(*, now=None) -> dict:
    """One reconciliation pass. Returns counters plus ``unresolved_detail``
    (human-readable reasons) — callers surface them; nothing here fabricates
    provider outcomes."""
    now = now or timezone.now()
    settled = failed_attempts = orders_failed = still_pending = 0
    unresolved: list[str] = []

    # A) Succeeded at the provider, never settled onto the order.
    unsettled = (
        PaymentAttempt.objects.select_related("order")
        .filter(status=PaymentAttempt.Status.SUCCEEDED)
        .exclude(order__state=Order.State.PAID)
    )
    for attempt in unsettled:
        order_state = settle_payment_attempt(attempt.id)
        if order_state == Order.State.PAID:
            settled += 1
        else:
            unresolved.append(
                f"attempt {attempt.id} ({attempt}) succeeded but settlement "
                f"returned {order_state!r} — manual resolution required"
            )

    # B) Webhook never arrived: one authoritative status query per stale attempt.
    stale = (
        PaymentAttempt.objects.select_related("order")
        .filter(
            status=PaymentAttempt.Status.PENDING,
            provider_payment_id__gt="",
            updated_at__lt=now - STALE_PENDING_AFTER,
            order__state__in=(Order.State.AWAITING_PAYMENT, Order.State.EXPIRED),
        )
    )
    for attempt in stale:
        try:
            gateway = get_payment_gateway(attempt.provider)
            provider_status = gateway.get_payment_status(
                provider_payment_id=attempt.provider_payment_id
            )
        except (LookupError, NotImplementedError) as exc:
            unresolved.append(
                f"attempt {attempt.id} ({attempt}) cannot be queried: {exc}"
            )
            continue

        if provider_status == "succeeded":
            status_now = _mark_terminal(attempt.id, "succeeded")
            if status_now == PaymentAttempt.Status.FAILED:
                # Webhook failure path won the race — do not resurrect money
                # movement from a bare status string; a human decides.
                unresolved.append(
                    f"attempt {attempt.id} ({attempt}) failed locally but "
                    f"provider reports succeeded — manual resolution required"
                )
                continue
            order_state = settle_payment_attempt(attempt.id)
            if order_state == Order.State.PAID:
                settled += 1
            else:
                unresolved.append(
                    f"attempt {attempt.id} ({attempt}) reconciled succeeded "
                    f"but settlement returned {order_state!r}"
                )
        elif provider_status in _FAILURE_STATUSES:
            status_now = _mark_terminal(attempt.id, "failed")
            if status_now == PaymentAttempt.Status.SUCCEEDED:
                # Webhook succeeded it between query and write — settle instead.
                order_state = settle_payment_attempt(attempt.id)
                if order_state == Order.State.PAID:
                    settled += 1
            elif status_now == PaymentAttempt.Status.FAILED:
                failed_attempts += 1
                if _fail_unpaid_order(attempt.order_id):
                    orders_failed += 1
        else:  # still "pending" (or unrecognized) at the provider — next pass
            still_pending += 1

    result = {
        "settled": settled,
        "failed_attempts": failed_attempts,
        "orders_failed": orders_failed,
        "still_pending": still_pending,
        "unresolved": len(unresolved),
        "unresolved_detail": unresolved,
    }
    if settled or failed_attempts or unresolved:
        logger.info("payment reconciliation: %s", result)
    if unresolved:
        logger.warning("payment reconciliation needs manual action: %s", unresolved)
    return result
