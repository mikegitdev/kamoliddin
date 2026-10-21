"""Nearby ads feed (public list view): one card per campaign at its nearest
CURRENTLY eligible branch, distance-ordered, cursor-paginated (spec §10).

Every test re-checks the two invariants that make the feed trustworthy:
- distance is measured to the NEAREST ELIGIBLE branch only — a nearer
  blocked/expired branch must never shorten a card's distance;
- eligibility is live per request (spec §7.2, §14).

Coordinates: ~1.11 km per 0.01° of latitude around Tashkent, so 41.31/41.33
are ~1.1/~3.3 km from the origin at 41.30 — inside the default 5 km radius.
"""
from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from apps.businesses.models import Business, BusinessCategory
from apps.campaigns.models import Campaign
from apps.discovery.views import PublicNearbyAdsView
from apps.locations.models import Location
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db

ORIGIN = {"lat": 41.30, "lon": 69.27}


def _loc(business, name, lat):
    return Location.objects.create(
        business=business, name=name, address=f"Tashkent, {name}",
        point=Point(ORIGIN["lon"], lat, srid=4326),
    )


def _campaign(business, headline, body=""):
    return Campaign.objects.create(
        business=business, headline=headline, body=body,
        banner_key="banners/test.jpg",
    )


def _approve(campaign):
    campaign.review_status = Campaign.ReviewStatus.APPROVED
    campaign.save(update_fields=["review_status"])


def _place(campaign, location, *, state=Placement.State.ACTIVE, start=-1, end=23):
    now = timezone.now()
    return Placement.objects.create(
        campaign=campaign, location=location,
        start_at=now + timedelta(hours=start), end_at=now + timedelta(hours=end),
        state=state, charge_days=1,
    )


def _ads(rf, **params):
    return PublicNearbyAdsView.as_view()(rf.get("/api/v1/public/ads", params))


def _eligible(business, headline, lat, *, body=""):
    campaign = _campaign(business, headline, body)
    _approve(campaign)
    location = _loc(business, f"Branch {headline}", lat)
    _place(campaign, location)
    return campaign, location


def test_orders_by_distance_and_returns_card_fields(rf, business):
    far, far_loc = _eligible(business, "Far offer", 41.33)   # ~3.3 km
    near, near_loc = _eligible(business, "Near offer", 41.31)  # ~1.1 km

    response = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"])
    assert response.status_code == 200
    results = response.data["results"]
    assert [r["id"] for r in results] == [str(near.id), str(far.id)]

    first = results[0]
    assert first["headline"] == "Near offer"
    assert first["business_name"] == business.name
    assert first["banner_url"] == "/media/banners/test.jpg"
    assert first["location"]["id"] == str(near_loc.id)
    assert first["location"]["name"] == near_loc.name
    assert first["location"]["address"] == near_loc.address
    assert 900 < first["distance_m"] < 1300
    assert first["branches_count"] == 1
    assert response.data["has_more"] is False
    assert response.data["next_cursor"] is None


def test_one_card_per_campaign_uses_nearest_eligible_branch(rf, business):
    campaign = _campaign(business, "Multi branch")
    _approve(campaign)
    far, near = _loc(business, "Far", 41.33), _loc(business, "Near", 41.31)
    _place(campaign, far)
    _place(campaign, near)

    results = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"]).data["results"]
    assert len(results) == 1
    assert results[0]["location"]["id"] == str(near.id)
    assert results[0]["branches_count"] == 2


def test_blocked_nearer_branch_never_shortens_distance(rf, business):
    campaign = _campaign(business, "Blocked near")
    _approve(campaign)
    near, far = _loc(business, "Near", 41.31), _loc(business, "Far", 41.33)
    _place(campaign, near, state=Placement.State.BLOCKED)
    _place(campaign, far)

    results = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"]).data["results"]
    assert len(results) == 1
    assert results[0]["location"]["id"] == str(far.id)
    # Only the eligible branch is counted.
    assert results[0]["branches_count"] == 1


def test_radius_bounds_the_feed(rf, business):
    _eligible(business, "Distant offer", 41.44)  # ~15.5 km

    tight = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"], radius_m=5000)
    assert tight.data["results"] == []

    wide = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"], radius_m=20000)
    assert len(wide.data["results"]) == 1


def test_category_filter(rf, business, owner):
    other_category = BusinessCategory.objects.create(slug="other", name_ru="Др", name_uz="Boshqa")
    other_business = Business.objects.create(
        owner=owner, name="Other Business", slug="other-business",
        category=other_category,
    )
    _eligible(other_business, "Other offer", 41.31)
    keep, _ = _eligible(business, "Keep offer", 41.32)

    results = _ads(
        rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"],
        category=business.category.slug,
    ).data["results"]
    assert [r["id"] for r in results] == [str(keep.id)]


def test_q_filters_and_ranks_relevance_first(rf, business):
    # "Sushi" in the body only (relevance 1) vs headline startswith (3).
    _eligible(business, "Sushi bar open", 41.33)
    _eligible(business, "Weekend deal", 41.31, body="Come for sushi today")

    response = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"], q="sushi")
    assert [r["headline"] for r in response.data["results"]] == [
        "Sushi bar open",
        "Weekend deal",
    ]

    # Explicit sort=distance flips to proximity order despite the query.
    by_distance = _ads(
        rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"], q="sushi", sort="distance"
    )
    assert [r["headline"] for r in by_distance.data["results"]] == [
        "Weekend deal",
        "Sushi bar open",
    ]


def test_one_char_query_returns_empty_feed(rf, business):
    _eligible(business, "Pizza", 41.31)
    response = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"], q="p")
    assert response.status_code == 200
    assert response.data["results"] == []


def test_pagination_pages_through_without_duplicates(rf, business):
    ids = set()
    for lat in (41.31, 41.32, 41.33):
        campaign, _ = _eligible(business, f"Offer {lat}", lat)
        ids.add(str(campaign.id))

    seen: list[str] = []
    cursor = None
    for _ in range(3):
        params = {"lat": ORIGIN["lat"], "lon": ORIGIN["lon"], "limit": 2}
        if cursor:
            params["cursor"] = cursor
        response = _ads(rf, **params)
        seen += [r["id"] for r in response.data["results"]]
        cursor = response.data["next_cursor"]
        if not cursor:
            break

    assert set(seen) == ids
    assert len(seen) == len(set(seen))  # no duplicates across pages


def test_cursor_rejects_changed_filters(rf, business):
    _eligible(business, "First offer", 41.31)
    _eligible(business, "Second offer", 41.32)

    first = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"], limit=1)
    cursor = first.data["next_cursor"]
    assert cursor is not None
    assert first.data["has_more"] is True

    mismatch = _ads(
        rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"], limit=1,
        radius_m=10000, cursor=cursor,
    )
    assert mismatch.status_code == 400

    match = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"], limit=1, cursor=cursor)
    assert match.status_code == 200
    assert [r["headline"] for r in match.data["results"]] == ["Second offer"]


def test_ineligible_content_stays_hidden(rf, business):
    # Approved campaign but the placement is PENDING (unpaid).
    pending = _campaign(business, "Pending offer")
    _approve(pending)
    _place(pending, _loc(business, "Pending branch", 41.31), state=Placement.State.PENDING)

    # Eligible placement but the campaign never got approved.
    draft = _campaign(business, "Draft offer")
    _place(draft, _loc(business, "Draft branch", 41.31))

    # Approved + active placement, but the interval has ended.
    expired = _campaign(business, "Expired offer")
    _approve(expired)
    _place(expired, _loc(business, "Expired branch", 41.31), end=-1)

    response = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"])
    assert response.data["results"] == []


def test_validates_origin_and_radius(rf):
    missing = _ads(rf)
    assert missing.status_code == 400

    bad_radius = _ads(rf, lat=41.3, lon=69.27, radius_m=50_000)
    assert bad_radius.status_code == 400

    out_of_range = _ads(rf, lat=99, lon=69.27)
    assert out_of_range.status_code == 400
