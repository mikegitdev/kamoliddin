"""Per-location ad cap (spec §14): the sixth concurrent ad cannot be purchased."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.billing.services import create_quote
from apps.moderation.services import submit_for_review
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db


def _fill_location(business, location, campaign, count=5):
    now = timezone.now()
    for i in range(count):
        Placement.objects.create(
            campaign=campaign,
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
