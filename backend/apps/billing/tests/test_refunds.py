"""Refund flow (spec §7.2, ADR-0003): truthfulness of provider references,
exact placement cancellation via the Placement->order link (immune to
late-moderation interval shifts), and the no-adapter guard.
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.billing.services import (
    RefundError,
    create_checkout,
    create_quote,
    process_refund,
    request_refund,
)
from apps.moderation.services import approve_campaign, reject_campaign, submit_for_review
from apps.payments.settlement import settle_payment_attempt
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db


def _paid_order_with_shifted_placement(owner, tariff, business, campaign, location, staff):
    """Paid order whose placement was shifted forward by LATE moderation —
    the case the old start_at-matching refund path missed: payment settles
    while the campaign is still under review, approval afterwards shifts the
    interval to start now, preserving the charged duration (spec §6 [C])."""
    submit_for_review(campaign=campaign)  # stays under review during payment
    # Must stay within QUOTE_START_GRACE (15 min) — create_quote rejects starts
    # further in the past. 10 min back still models "interval already started
    # when payment settles / approval lands late".
    start = timezone.now() - timedelta(minutes=10)  # start already passed
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start, requested_end_at=start + timedelta(hours=24),
    )
    attempt, _ = create_checkout(user=owner, order_id=order.id)
    attempt.status = "succeeded"
    attempt.save()
    settle_payment_attempt(attempt.id)  # paid while under review -> PENDING
    approve_campaign(campaign=campaign, reviewer=staff)  # late approval shifts
    return order, attempt


def test_refund_cancels_shifted_placements_and_never_fakes_provider_ref(
    owner, tariff, business, campaign, location, staff
):
    order, _attempt = _paid_order_with_shifted_placement(
        owner, tariff, business, campaign, location, staff
    )
    placement = Placement.objects.get(order=order)
    assert placement.start_at != order.interval_start_at  # shifted by late approval

    # Admin takedown of already-published content -> refund becomes available.
    reject_campaign(campaign=campaign, reviewer=staff, reason="takedown test")

    refund = request_refund(user=owner, order_id=order.id, reason="please")
    processed = process_refund(
        staff=staff, refund_id=str(refund.id), decision="approve"
    )
    # Fake gateway returns a real (fake-namespace) reference — never fabricated.
    assert processed.provider_ref.startswith("fake-refund-")
    assert processed.state == "refunded"

    placement.refresh_from_db()
    assert placement.state == Placement.State.CANCELLED  # exact order link worked


def test_unverified_provider_refund_requires_manual_reference(
    owner, tariff, business, campaign, location, staff, settings
):
    order, _ = _paid_order_with_shifted_placement(
        owner, tariff, business, campaign, location, staff
    )
    reject_campaign(campaign=campaign, reviewer=staff, reason="takedown")
    refund = request_refund(user=owner, order_id=order.id, reason="please")

    settings.PAYMENT_PROVIDER = "click"  # unverified adapter — raises on init
    with pytest.raises(RefundError):
        process_refund(staff=staff, refund_id=str(refund.id), decision="approve")
    refund.refresh_from_db()
    assert refund.state == "refund_requested"  # untouched — never fabricated

    # Staff-supplied provider-console reference completes the flow.
    processed = process_refund(
        staff=staff, refund_id=str(refund.id), decision="approve",
        provider_ref="click-console-txn-123",
    )
    assert processed.state == "refunded"
    assert processed.provider_ref == "click-console-txn-123"


def test_reject_refund_keeps_payment_records(
    owner, tariff, business, campaign, location, staff
):
    order, _ = _paid_order_with_shifted_placement(
        owner, tariff, business, campaign, location, staff
    )
    reject_campaign(campaign=campaign, reviewer=staff, reason="takedown")
    refund = request_refund(user=owner, order_id=order.id, reason="please")
    processed = process_refund(staff=staff, refund_id=str(refund.id), decision="reject")
    assert processed.state == "refund_failed"
    # Order and attempt rows are intact (accounting never erased).
    order.refresh_from_db()
    assert order.state == "paid"
    assert Placement.objects.filter(order=order).exists()


def test_refunded_order_cannot_be_refunded_again_or_over_its_total(
    owner, tariff, business, campaign, location, staff
):
    order, _ = _paid_order_with_shifted_placement(
        owner, tariff, business, campaign, location, staff
    )
    reject_campaign(campaign=campaign, reviewer=staff, reason="takedown")
    refund = request_refund(user=owner, order_id=order.id, reason="please")
    with pytest.raises(RefundError):  # more than the customer paid
        process_refund(staff=staff, refund_id=str(refund.id), decision="approve",
                       amount=order.amount_total + 1)
    process_refund(staff=staff, refund_id=str(refund.id), decision="approve")

    with pytest.raises(RefundError):  # order stays PAID, but money already went back
        request_refund(user=owner, order_id=order.id, reason="again")
