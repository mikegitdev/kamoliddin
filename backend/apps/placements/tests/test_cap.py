"""Per-location ad cap (spec §14): the sixth concurrent ad cannot be purchased.

Capacity semantics (ADR-0003): a campaign extending ITSELF never
counts its own ads — so the cap test fills the location with a DIFFERENT
campaign's placements, which is also the real-world scenario (six distinct
advertisers competing for five slots)."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.billing.services import create_quote
from apps.campaigns.models import Campaign
from apps.moderation.services import submit_for_review
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db


def _fill_location(business, location, campaign, count=5):
    """`count` ACTIVE placements at `location` from OTHER campaigns."""
    now = timezone.now()
    filler = Campaign.objects.create(
        business=business,
        headline=f"Filler campaign {campaign.id}",
        body="",
        banner_key="banners/filler.jpg",
    )
    for _ in range(count):
        Placement.objects.create(
            campaign=filler,
            location=location,
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(days=2),
            charge_days=3,
            state=Placement.State.ACTIVE,
        )


def test_sixth_ad_at_location_is_rejected(owner, tariff, business, campaign, location):
    submit_for_review(campaign=campaign)
    _fill_location(business, location, campaign, count=5)
    start = timezone.now() + timedelta(hours=1)
    with pytest.raises(ValidationError) as excinfo:
        create_quote(
            user=owner,
            business_id=business.id,
            campaign_id=campaign.id,
            location_ids=[location.id],
            requested_start_at=start,
            requested_end_at=start + timedelta(hours=24),
        )
    assert "limit" in str(excinfo.value)


def test_own_campaign_extension_at_capped_location_is_allowed(
    owner, tariff, business, campaign, location
):
    """ADR-0003: extensions (a new one-time order) of the same campaign work at a full
    location because the new term starts AFTER the campaign's own current
    term ends — the overlap filter never counts the campaign's own ads.
    Stacking a SECOND simultaneous ad of the same campaign is NOT free: it
    must fit inside the cap like anyone else's (see next test)."""
    submit_for_review(campaign=campaign)
    now = timezone.now()
    for _ in range(5):
        Placement.objects.create(
            campaign=campaign,
            location=location,
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(days=2),
            charge_days=3,
            state=Placement.State.ACTIVE,
        )
    # Extension AFTER the current term ends: zero overlap with own ads, but
    # the location is full of OTHER campaigns' ads only in the stacking test —
    # here the 5 are own ads, so the extension has the location to itself.
    start = now + timedelta(days=3)
    order = create_quote(
        user=owner,
        business_id=business.id,
        campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start,
        requested_end_at=start + timedelta(hours=24),
    )
    assert order.amount_total == tariff.amount_per_24h


def test_same_campaign_stacking_overlapping_interval_is_capped(
    owner, tariff, business, campaign, location
):
    """A second SIMULTANEOUS ad of the same campaign consumes a slot: with 5
    own ads already active, an overlapping interval for the same campaign is
    the sixth ad and must be rejected (spec §14 — no self-exclusion hole)."""
    from rest_framework.exceptions import ValidationError

    submit_for_review(campaign=campaign)
    now = timezone.now()
    for _ in range(5):
        Placement.objects.create(
            campaign=campaign,
            location=location,
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(days=2),
            charge_days=3,
            state=Placement.State.ACTIVE,
        )
    start = now + timedelta(hours=1)  # overlaps the five active terms
    with pytest.raises(ValidationError):
        create_quote(
            user=owner,
            business_id=business.id,
            campaign_id=campaign.id,
            location_ids=[location.id],
            requested_start_at=start,
            requested_end_at=start + timedelta(hours=24),
        )


def test_non_overlapping_interval_is_allowed(owner, tariff, business, campaign, location):
    submit_for_review(campaign=campaign)
    _fill_location(business, location, campaign, count=5)
    start = timezone.now() + timedelta(days=10)  # far after existing terms end
    order = create_quote(
        user=owner,
        business_id=business.id,
        campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start,
        requested_end_at=start + timedelta(hours=24),
    )
    assert order.amount_total == tariff.amount_per_24h


def test_promotion_tier_propagates_to_reservation_placements(
    owner, tariff, business, campaign, location
):
    """Joymee borrow #3, entitlement path: a TOP add-on bought at quote time
    must reach the PENDING reservation placements created at checkout — that
    tier is what the public feed ranks on. Plain orders stay tier-less."""
    from apps.billing.services import create_checkout

    tariff.amount_top_per_24h = 20_000_00
    tariff.save(update_fields=["amount_top_per_24h"])
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(hours=1)
    order = create_quote(
        user=owner,
        business_id=business.id,
        campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start,
        requested_end_at=start + timedelta(hours=24),
        promotion_tier="top",
    )
    create_checkout(user=owner, order_id=order.id)

    placement = order.placements.get()
    assert placement.state == Placement.State.PENDING
    assert placement.promotion_tier == "top"


def test_promotion_order_never_consumes_capacity(owner, tariff, business, campaign,
                                                 location):
    """kind=promotion orders ride a slot the advertiser already paid for: with
    the location full (5/5), quoting AND checking out a promotion still works
    and no placement is created (Joymee tariff page, ADR-0003 intact)."""
    from apps.billing.services import create_checkout, create_promotion_quote

    tariff.amount_top_per_24h = 20_000_00
    tariff.save(update_fields=["amount_top_per_24h"])
    submit_for_review(campaign=campaign)
    now = timezone.now()
    running = Placement.objects.create(
        campaign=campaign, location=location,
        start_at=now - timedelta(hours=1), end_at=now + timedelta(days=3),
        state=Placement.State.ACTIVE, charge_days=4,
    )
    _fill_location(business, location, campaign, count=4)  # 5/5 including `running`

    order = create_promotion_quote(
        user=owner, placement_id=running.id, tier="top", days=2,
    )
    create_checkout(user=owner, order_id=order.id)  # must NOT raise capacity

    assert order.placements.count() == 0
    assert Placement.objects.filter(location=location).count() == 5


def test_settlement_applies_promotion_window_and_refund_ends_it(
    owner, tariff, business, campaign, location,
):
    """Full money path: paid promotion order stamps tier + [now, now+days) on
    the running placement; refunding that order ends the window while the
    placement itself keeps running (records never erased)."""
    from apps.billing.services import (
        create_checkout,
        create_promotion_quote,
        process_refund,
        request_refund,
    )
    from apps.campaigns.models import CampaignReview
    from apps.moderation.services import reject_campaign
    from apps.payments.models import PaymentAttempt
    from apps.payments.settlement import settle_payment_attempt

    tariff.amount_raised_per_24h = 8_000_00
    tariff.save(update_fields=["amount_raised_per_24h"])
    staff = User.objects.create_user(phone_e164="+998909990001", is_staff=True)
    submit_for_review(campaign=campaign)
    campaign.review_status = Campaign.ReviewStatus.APPROVED
    campaign.save(update_fields=["review_status"])
    now = timezone.now()
    running = Placement.objects.create(
        campaign=campaign, location=location,
        start_at=now - timedelta(hours=1), end_at=now + timedelta(days=3),
        state=Placement.State.ACTIVE, charge_days=4,
    )

    order = create_promotion_quote(
        user=owner, placement_id=running.id, tier="raised", days=3,
    )
    attempt, _ = create_checkout(user=owner, order_id=order.id)
    attempt.status = PaymentAttempt.Status.SUCCEEDED
    attempt.save(update_fields=["status", "updated_at"])
    settle_payment_attempt(attempt.id)

    running.refresh_from_db()
    assert running.promotion_tier == "raised"
    assert running.promotion_started_at is not None
    assert running.promotion_ends_at == running.promotion_started_at + timedelta(days=3)
    assert running.state == Placement.State.ACTIVE  # untouched by the promo order
    assert order.placements.count() == 0

    # Refund path: rejection unlocks it; the window ends, the ad keeps running.
    CampaignReview.objects.all().delete()
    reject_campaign(campaign=campaign, reviewer=staff, reason="test")
    refund = request_refund(user=owner, order_id=str(order.id), reason="campaign rejected")
    process_refund(staff=staff, refund_id=str(refund.id), decision="approve")

    running.refresh_from_db()
    assert running.state == Placement.State.ACTIVE
    assert running.promotion_tier == "raised"          # record kept
    assert running.promotion_ends_at <= timezone.now()  # but no longer live
    assert running.promotion_active() is False
