"""Payment settlement: a succeeded attempt marks its order PAID exactly once and
activates the purchased entitlements idempotently (spec §7.2)."""
import logging

from django.db import transaction

from apps.billing.models import Order

from .models import PaymentAttempt

logger = logging.getLogger(__name__)


@transaction.atomic
def settle_payment_attempt(attempt_id) -> str:
    """Apply a SUCCEEDED attempt to its order. Returns the resulting order state."""
    attempt = (
        PaymentAttempt.objects.select_for_update()
        .select_related("order", "order__campaign")
        .filter(pk=attempt_id)
        .first()
    )
    if attempt is None:
        return "unknown_attempt"
    order = attempt.order
    if attempt.status != PaymentAttempt.Status.SUCCEEDED:
        return order.state

    if order.state == Order.State.PAID:
        return "paid"  # idempotent: duplicate callbacks stop here

    order.state = Order.State.PAID
    order.save(update_fields=["state", "updated_at"])

    from apps.placements.services import activate_order_entitlements

    created = activate_order_entitlements(order)
    logger.info("Order %s paid; %d placements ensured", order.id, len(created))

    # Renewal consent captured at quote time -> agreement (spec §8, idempotent).
    from apps.renewals.services import ensure_agreement_for_order

    if order.auto_renew:
        ensure_agreement_for_order(order)
    return order.state
