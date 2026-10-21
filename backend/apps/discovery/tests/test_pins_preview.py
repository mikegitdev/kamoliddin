"""Pin preview fields (public map payload): every pin may carry a deterministic
preview (headline + banner URL) of the first eligible ad at that location.

Invariants (spec §7.2, §14):
- the preview comes from the SAME live eligibility predicate as the count —
  expired/blocked/unapproved ads never preview;
- deterministic selection: earliest start_at (the detail sheet's order), so
  the preview always matches the first ad the visitor sees on the pin;
- headline and banner always come from the SAME campaign.
"""
from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.placements.models import Placement

from .test_nearby_ads import _approve, _campaign, _loc, _place

pytestmark = pytest.mark.django_db

# Tashkent center bbox used by the pins endpoint.
BBOX = "69.20,41.25,69.35,41.35"


def _pins(rf, **params):
    from apps.discovery.views import PublicLocationListView

    params.setdefault("bbox", BBOX)
    return PublicLocationListView.as_view()(rf.get("/api/v1/public/locations", params))


def test_pin_previews_first_eligible_ad_deterministically(rf, business):
    later = _campaign(business, "Later offer", body="")
    later.banner_key = "banners/later.jpg"
    later.save(update_fields=["banner_key"])
    _approve(later)
    first = _campaign(business, "First offer")
    first.banner_key = "banners/first.jpg"
    first.save(update_fields=["banner_key"])
    _approve(first)

    loc = _loc(business, "Branch", 41.30)
    # Same creation-free window; "first" starts EARLIER -> detail sheet order.
    now = timezone.now()
    Placement.objects.create(
        campaign=later, location=loc, charge_days=1, state=Placement.State.ACTIVE,
        start_at=now + timedelta(hours=-1), end_at=now + timedelta(hours=23),
    )
    Placement.objects.create(
        campaign=first, location=loc, charge_days=1, state=Placement.State.ACTIVE,
        start_at=now + timedelta(hours=-5), end_at=now + timedelta(hours=23),
    )

    response = _pins(rf)
    assert response.status_code == 200
    pin = next(p for p in response.data if str(p["id"]) == str(loc.id))
    assert pin["active_ads_count"] == 2
    # Earliest start_at wins, and both fields name the SAME campaign.
    assert pin["preview_headline"] == "First offer"
    assert pin["preview_banner_url"] == "/media/banners/first.jpg"


def test_pin_without_eligible_ads_has_no_preview(rf, business, owner):
    loc = _loc(business, "Quiet branch", 41.30)
    unapproved = _campaign(business, "Draft offer")
    _place(unapproved, loc)  # never approved -> never public

    expired = _campaign(business, "Old offer")
    _approve(expired)
    _place(expired, loc, start=-48, end=-24)  # window already closed

    response = _pins(rf)
    pin = next(p for p in response.data if str(p["id"]) == str(loc.id))
    assert pin["active_ads_count"] == 0
    assert pin["preview_headline"] is None
    assert pin["preview_banner_url"] is None


def test_blocked_placement_never_previews(rf, business):
    campaign = _campaign(business, "Blocked offer")
    _approve(campaign)
    loc = _loc(business, "Blocked branch", 41.30)
    _place(campaign, loc, state=Placement.State.BLOCKED)

    response = _pins(rf)
    pin = next(p for p in response.data if str(p["id"]) == str(loc.id))
    assert pin["active_ads_count"] == 0
    assert pin["preview_headline"] is None


def test_search_locations_carry_previews_too(rf, business):
    campaign = _campaign(business, "Searchable offer")
    _approve(campaign)
    loc = _loc(business, "Searchable branch", 41.30)
    _place(campaign, loc)

    from apps.discovery.views import PublicSearchView

    response = PublicSearchView.as_view()(rf.get("/api/v1/public/search", {"q": "Searchable"}))
    assert response.status_code == 200
    pin = next(p for p in response.data["locations"] if str(p["id"]) == str(loc.id))
    assert pin["preview_headline"] == "Searchable offer"
    assert pin["preview_banner_url"] == "/media/banners/test.jpg"


def test_preview_always_matches_first_ad_in_detail_sheet(rf, business):
    """The card thumbnail and the detail sheet must name the SAME first ad,
    including the tie: two placements with an identical start_at are broken
    by pk in both the preview subquery and the sheet. Ids are UUIDs, so WHICH
    campaign wins the tie is arbitrary — the invariant under test is that
    both surfaces always agree, and headline/banner come from one campaign."""
    tie_a = _campaign(business, "Tie offer A")
    tie_a.banner_key = "banners/a.jpg"
    tie_a.save(update_fields=["banner_key"])
    _approve(tie_a)
    tie_b = _campaign(business, "Tie offer B")
    tie_b.banner_key = "banners/b.jpg"
    tie_b.save(update_fields=["banner_key"])
    _approve(tie_b)

    loc = _loc(business, "Tie branch", 41.30)
    now = timezone.now()
    for campaign in (tie_a, tie_b):
        Placement.objects.create(
            campaign=campaign, location=loc, charge_days=1,
            state=Placement.State.ACTIVE,
            start_at=now + timedelta(hours=-2),  # identical start: the tie
            end_at=now + timedelta(hours=22),
        )

    from apps.discovery.views import PublicLocationDetailView

    pin = next(p for p in _pins(rf).data if str(p["id"]) == str(loc.id))
    detail = PublicLocationDetailView.as_view()(
        rf.get(f"/api/v1/public/locations/{loc.id}"), id=str(loc.id)
    )
    assert detail.status_code == 200

    # Agreement across surfaces — the invariant a visitor experiences.
    first_ad = detail.data["active_ads"][0]
    assert pin["preview_headline"] == first_ad["headline"]

    # Headline and banner belong to the SAME campaign (never mixed).
    banner_by_headline = {c.headline: f"/media/{c.banner_key}" for c in (tie_a, tie_b)}
    assert pin["preview_headline"] in banner_by_headline
    assert pin["preview_banner_url"] == banner_by_headline[pin["preview_headline"]]
