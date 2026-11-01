"""Pricing invariants (spec §6): whole-day ceil billing, server-side totals."""
from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.billing.models import compute_charge_days
from apps.billing.services import create_promotion_quote, create_quote
from apps.businesses.models import Business
from apps.locations.models import Location
from apps.moderation.services import submit_for_review
from apps.placements.models import Placement

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
    item = order.items.first()
    assert item is not None
    assert item.charge_days == 2
    assert item.unit_rate_snapshot == tariff.amount_per_24h
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


# --- Joymee-style promotion add-ons (TOP / RAISED) ---------------------------


def test_quote_with_top_addon_locks_promotion_snapshot(owner, tariff, business, campaign,
                                                        location):
    """TOP add-on: its own locked per-line surcharge and a total that is the
    base plus the surcharge — never a server-side recomputation later."""
    tariff.amount_top_per_24h = 20_000_00
    tariff.save(update_fields=["amount_top_per_24h"])
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
        promotion_tier="top",
    )
    item = order.items.first()
    assert item is not None
    assert item.promotion_tier == "top"
    assert item.promotion_line_total == 20_000_00 * 2
    assert order.amount_total == 30_000_00 * 2 + 20_000_00 * 2


def test_quote_promotion_addon_applies_per_location(owner, tariff, business, campaign,
                                                     location):
    """The add-on is priced per location per day, exactly like the base rate."""
    tariff.amount_raised_per_24h = 8_000_00
    tariff.save(update_fields=["amount_raised_per_24h"])
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(hours=1)
    second = Location.objects.create(
        business=business, name="Second", address="T",
        point=Point(69.21, 41.31, srid=4326),
    )
    order = create_quote(
        user=owner,
        business_id=business.id,
        campaign_id=campaign.id,
        location_ids=[location.id, second.id],
        requested_start_at=start,
        requested_end_at=start + timedelta(hours=24),
        promotion_tier="raised",
    )
    assert order.items.count() == 2
    assert all(i.promotion_tier == "raised" for i in order.items.all())
    assert order.amount_total == (30_000_00 + 8_000_00) * 2


def test_quote_rejects_unpriced_promotion_tier(owner, tariff, business, campaign, location):
    """A tier without a price in the current tariff is refused with a
    dedicated code so the editor can hide the option."""
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(hours=1)
    with pytest.raises(ValidationError) as exc:
        create_quote(
            user=owner,
            business_id=business.id,
            campaign_id=campaign.id,
            location_ids=[location.id],
            requested_start_at=start,
            requested_end_at=start + timedelta(hours=24),
            promotion_tier="top",
        )
    assert exc.value.get_codes() == {"promotion_tier": "promotion_unavailable"}


def test_quote_without_promotion_keeps_zero_surcharge(owner, tariff, business, campaign,
                                                       location):
    """Plain quotes stay byte-identical to the pre-promotion contract."""
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(hours=1)
    order = create_quote(
        user=owner,
        business_id=business.id,
        campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start,
        requested_end_at=start + timedelta(hours=24),
    )
    item = order.items.first()
    assert item is not None
    assert item.promotion_tier is None
    assert item.promotion_line_total == 0
    assert order.amount_total == 30_000_00


# --- Post-hoc promotion orders (Joymee tariff-page equivalent) ----------------


def _running_placement(business, campaign, location):
    from django.utils import timezone as tz

    from apps.campaigns.models import Campaign
    from apps.placements.models import Placement

    submit_for_review(campaign=campaign)
    campaign.review_status = Campaign.ReviewStatus.APPROVED
    campaign.save(update_fields=["review_status"])
    now = tz.now()
    return Placement.objects.create(
        campaign=campaign, location=location,
        start_at=now - timedelta(hours=1), end_at=now + timedelta(days=5),
        state=Placement.State.ACTIVE, charge_days=6,
    )


def test_promotion_quote_prices_running_placement(owner, tariff, business, campaign,
                                                   location):
    tariff.amount_top_per_24h = 20_000_00
    tariff.save(update_fields=["amount_top_per_24h"])
    placement = _running_placement(business, campaign, location)


    order = create_promotion_quote(
        user=owner, placement_id=placement.id, tier="top", days=3,
    )
    assert order.kind == "promotion"
    assert order.promoted_placement == placement
    assert order.amount_total == 20_000_00 * 3
    item = order.items.get()
    assert item.line_total == 0            # no display time bought
    assert item.promotion_line_total == 20_000_00 * 3
    assert item.charge_days == 3


def test_promotion_quote_refusals(owner, other_owner, tariff, business, campaign,
                                  location):

    tariff.amount_raised_per_24h = 8_000_00
    tariff.save(update_fields=["amount_raised_per_24h"])
    placement = _running_placement(business, campaign, location)

    # Foreign owner.
    with pytest.raises(PermissionDenied):
        create_promotion_quote(
            user=other_owner, placement_id=placement.id, tier="raised", days=2,
        )
    # Inactive placement.
    placement.state = Placement.State.PENDING
    placement.save(update_fields=["state"])
    with pytest.raises(ValidationError) as exc:
        create_promotion_quote(
            user=owner, placement_id=placement.id, tier="raised", days=2,
        )
    assert exc.value.get_codes() == {"placement_id": "placement_not_active"}
    placement.state = Placement.State.ACTIVE
    placement.save(update_fields=["state"])
    # Tier not priced by the current tariff.
    with pytest.raises(ValidationError) as exc:
        create_promotion_quote(user=owner, placement_id=placement.id, tier="top", days=2)
    assert exc.value.get_codes() == {"tier": "promotion_unavailable"}
    # Already actively promoted.
    placement.promotion_tier = "top"
    placement.promotion_started_at = timezone.now() - timedelta(hours=1)
    placement.promotion_ends_at = timezone.now() + timedelta(days=2)
    placement.save(update_fields=[
        "promotion_tier", "promotion_started_at", "promotion_ends_at",
    ])
    with pytest.raises(ValidationError) as exc:
        create_promotion_quote(
            user=owner, placement_id=placement.id, tier="raised", days=2,
        )
    assert exc.value.get_codes() == {"placement_id": "already_promoted"}


