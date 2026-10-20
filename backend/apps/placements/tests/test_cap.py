"""Per-location ad cap (spec §14): the sixth concurrent ad cannot be purchased.

Capacity semantics (ADR-0003): a campaign extending ITSELF never
counts its own ads — so the cap test fills the location with a DIFFERENT
campaign's placements, which is also the real-world scenario (six distinct
advertisers competing for five slots)."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError

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
