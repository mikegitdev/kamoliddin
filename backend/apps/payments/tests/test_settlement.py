"""Settlement invariants (spec §7.2, §14): paid order activates entitlements
exactly once; payment and moderation stay separate gates."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.billing.services import create_checkout, create_quote
from apps.moderation.services import approve_campaign, submit_for_review
from apps.payments.settlement import settle_payment_attempt
from apps.placements.models import Placement, eligible_now_q

pytestmark = pytest.mark.django_db


def _paid_order(owner, tariff, business, campaign, location, **quote_kwargs):
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(minutes=30)
    end = start + timedelta(hours=24)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id], requested_start_at=start, requested_end_at=end,
        **quote_kwargs,
    )
    attempt, _redirect = create_checkout(user=owner, order_id=order.id)
    attempt.status = "succeeded"
    attempt.save()
    return order, attempt


def test_duplicate_settlement_activates_once(owner, tariff, business, campaign, location):
    order, attempt = _paid_order(owner, tariff, business, campaign, location)
    settle_payment_attempt(attempt.id)
    settle_payment_attempt(attempt.id)  # duplicate callback
    assert Placement.objects.filter(campaign=campaign).count() == 1
    order.refresh_from_db()
    assert order.state == "paid"


def test_paid_but_unapproved_is_not_public(owner, tariff, business, campaign, location):
    order, attempt = _paid_order(owner, tariff, business, campaign, location)
    settle_payment_attempt(attempt.id)
    order.refresh_from_db()
    assert order.state == "paid"
    assert Placement.objects.get(campaign=campaign).state == Placement.State.PENDING
    assert not Placement.objects.filter(campaign=campaign).filter(eligible_now_q()).exists()


def test_approval_activates_paid_placements(owner, tariff, business, campaign, location, staff):
    order, attempt = _paid_order(owner, tariff, business, campaign, location)
    settle_payment_attempt(attempt.id)
    approve_campaign(campaign=campaign, reviewer=staff)
    placement = Placement.objects.get(campaign=campaign)
    assert placement.state == Placement.State.SCHEDULED  # starts in 30 min


def test_late_approval_preserves_charged_duration(owner, tariff, business, campaign, location,
                                                  staff):
    submit_for_review(campaign=campaign)
    start = timezone.now() - timedelta(hours=2)
    end = start + timedelta(hours=24)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id], requested_start_at=start, requested_end_at=end,
    )
    attempt, _ = create_checkout(user=owner, order_id=order.id)
    attempt.status = "succeeded"
    attempt.save()
    settle_payment_attempt(attempt.id)

    # Interval already started -> approve now: activate immediately, full term kept.
    approve_campaign(campaign=campaign, reviewer=staff)
    placement = Placement.objects.get(campaign=campaign)
    assert placement.state == Placement.State.ACTIVE
    assert placement.actual_start_at is not None
    remaining = placement.end_at - timezone.now()
    assert remaining >= timedelta(hours=23, minutes=50)  # ~full 24h from now


def test_auto_renew_consent_creates_agreement(owner, tariff, business, campaign, location):
    order, attempt = _paid_order(owner, tariff, business, campaign, location, auto_renew=True)
    settle_payment_attempt(attempt.id)
    from apps.renewals.models import RenewalAgreement

    agreement = RenewalAgreement.objects.get(campaign=campaign)
    assert agreement.status == RenewalAgreement.Status.ACTIVE
    assert agreement.next_run_at == order.interval_end_at - timedelta(hours=1)
