"""Pricing invariants (spec §6): whole-day ceil billing, server-side totals."""
from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.billing.models import compute_charge_days
from apps.billing.services import create_quote
from apps.businesses.models import Business
from apps.locations.models import Location
from apps.moderation.services import submit_for_review

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    "hours,expected_days",
    [
        (24, 1),
        (25, 2),  # spec acceptance #4: 25h rounds to 2
        (1, 1),
        (48, 2),
        (0.5, 1),
    ],
)
def test_compute_charge_days(hours, expected_days):
    start = timezone.now()
    end = start + timedelta(hours=hours)
    assert compute_charge_days(start, end) == expected_days


def test_compute_charge_days_rejects_bad_interval():
    now = timezone.now()
    with pytest.raises(ValueError):
        compute_charge_days(now, now)
    with pytest.raises(ValueError):
        compute_charge_days(now, now - timedelta(seconds=1))


def test_quote_total_is_rate_times_days_times_locations(owner, tariff, business, campaign,
                                                         location):
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(hours=1)
    end = start + timedelta(hours=25)  # 2 billable days
    order = create_quote(
        user=owner,
        business_id=business.id,
        campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start,
        requested_end_at=end,
    )
    assert order.items.first().charge_days == 2
    assert order.items.first().unit_rate_snapshot == tariff.amount_per_24h
    assert order.amount_total == tariff.amount_per_24h * 2


def test_quote_rejects_foreign_locations(owner, tariff, business, campaign, other_owner,
                                         category):
    foreign = Business.objects.create(
        owner=other_owner, name="Foreign", slug="foreign", category=category
    )
    foreign_loc = Location.objects.create(
        business=foreign, name="F", address="F",
        point=Point(69.2, 41.3, srid=4326),
    )
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(hours=1)
    with pytest.raises(ValidationError):
        create_quote(
            user=owner,
            business_id=business.id,
            campaign_id=campaign.id,
            location_ids=[foreign_loc.id],
            requested_start_at=start,
            requested_end_at=start + timedelta(hours=24),
        )


def test_quote_rejects_other_users_business(other_owner, tariff, business, campaign, location):
    start = timezone.now() + timedelta(hours=1)
    with pytest.raises(PermissionDenied):
        create_quote(
            user=other_owner,
            business_id=business.id,
            campaign_id=campaign.id,
            location_ids=[location.id],
            requested_start_at=start,
            requested_end_at=start + timedelta(hours=24),
        )
