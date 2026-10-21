"""ops_report surfacing of the reconciliation manual queue (ADR-0005 note 8).

A PENDING attempt on a still-live order is normal checkout traffic; the same
attempt on an EXPIRED order is money-state-unknown — the report must count it
and exit non-zero so cron alerts."""
from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.billing.services import create_checkout, create_quote
from apps.moderation.services import submit_for_review
from apps.placements.services import refresh_states

pytestmark = pytest.mark.django_db


def _checked_out_order(owner, business, campaign, location):
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(minutes=30)
    end = start + timedelta(hours=24)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id], requested_start_at=start, requested_end_at=end,
    )
    create_checkout(user=owner, order_id=order.id)
    return order


def _report() -> str:
    out = StringIO()
    with pytest.raises(SystemExit) as exc:
        call_command("ops_report", stdout=out)
    assert exc.value.code == 1  # something critical: at least no worker heartbeat
    return out.getvalue()


def test_pending_on_live_order_is_not_the_reconciliation_queue(
    owner, tariff, business, campaign, location
):
    _checked_out_order(owner, business, campaign, location)

    text = _report()

    assert "reconciliation queue (pending on expired orders): 0" in text


def test_pending_attempt_on_expired_order_is_reported(
    owner, tariff, business, campaign, location
):
    from apps.billing.models import Order

    order = _checked_out_order(owner, business, campaign, location)
    Order.objects.filter(pk=order.pk).update(
        quote_expires_at=timezone.now() - timedelta(hours=3)
    )
    refresh_states()  # expires the order, releases reservations
    order.refresh_from_db()
    assert order.state == Order.State.EXPIRED  # precondition

    text = _report()

    assert "reconciliation queue (pending on expired orders): 1" in text
