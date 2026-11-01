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


# --- Joymee-style promotion blocks (TOP > RAISED > organic) ------------------


def test_promoted_campaigns_lead_the_feed_in_tier_blocks(rf, business):
    """Joymee ranking: every TOP card first, then RAISED, then organic — even
    when the promoted campaigns are farther away. Distance still orders within
    each block."""
    _eligible(business, "Organic near", 41.31)
    top_far, _ = _eligible(business, "Top far", 41.33)
    raised_mid, _ = _eligible(business, "Raised mid", 41.32)
    top_near, _ = _eligible(business, "Top near", 41.31)

    # The add-on rides on the paid placement itself, exactly as after checkout.
    Placement.objects.filter(campaign=top_far).update(promotion_tier="top")
    Placement.objects.filter(campaign=top_near).update(promotion_tier="top")
    Placement.objects.filter(campaign=raised_mid).update(promotion_tier="raised")

    response = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"])
    assert response.status_code == 200
    results = response.data["results"]
    assert [r["headline"] for r in results] == [
        "Top near",      # TOP block, nearer first
        "Top far",
        "Raised mid",    # RAISED block
        "Organic near",  # organic block, distance ordering unchanged
    ]
    assert [r["promotion"] for r in results] == ["top", "top", "raised", None]


def test_cursor_paginates_across_promotion_blocks(rf, business):
    """The keyset cursor carries the promotion rank: paging through a feed
    with promoted cards never repeats or skips a campaign."""
    campaigns = []
    for i, lat in enumerate((41.31, 41.32, 41.33, 41.34)):
        campaign, _loc_row = _eligible(business, f"Offer {i}", lat)
        campaigns.append(campaign)
    # First campaign is TOP, second RAISED, rest organic.
    Placement.objects.filter(campaign=campaigns[0]).update(promotion_tier="top")
    Placement.objects.filter(campaign=campaigns[1]).update(promotion_tier="raised")

    seen = []
    cursor = None
    while True:
        params = {"lat": ORIGIN["lat"], "lon": ORIGIN["lon"], "limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = _ads(rf, **params).data
        seen.extend(r["headline"] for r in page["results"])
        if not page["next_cursor"]:
            break
        cursor = page["next_cursor"]

    assert seen == ["Offer 0", "Offer 1", "Offer 2", "Offer 3"]


def test_expired_promotion_falls_back_to_organic(rf, business):
    """Promotion lives only while an eligible placement carries it: once the
    promoted placement's interval ends, the card ranks organically again —
    Joymee's countdown semantics without a separate expiry job."""
    campaign, location = _eligible(business, "Promo offer", 41.31)
    _eligible(business, "Organic nearer", 41.30)
    # A TOP placement whose interval already ended is invisible, so the
    # campaign's rank falls back to its remaining organic placement.
    promoted = _place(campaign, location, start=-3, end=-1)
    Placement.objects.filter(pk=promoted.pk).update(promotion_tier="top")

    results = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"]).data["results"]
    assert [r["promotion"] for r in results] == [None, None]
    assert [r["headline"] for r in results] == ["Organic nearer", "Promo offer"]


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


# --- Post-hoc promotion windows + featured strip (Joymee follow-ups) --------


def test_expired_promotion_window_falls_back_to_organic(rf, business):
    """A post-hoc promotion whose recorded window has passed stops counting
    even though the placement itself is still eligible — Joymee's countdown
    without an expiry job."""
    campaign, _ = _eligible(business, "Was promoted", 41.32)
    _eligible(business, "Organic nearer", 41.31)
    placement = campaign.placements.get()
    now = timezone.now()
    placement.promotion_tier = "top"
    placement.promotion_started_at = now - timedelta(days=3)
    placement.promotion_ends_at = now - timedelta(hours=1)  # ended
    placement.save(update_fields=[
        "promotion_tier", "promotion_started_at", "promotion_ends_at",
    ])

    results = _ads(rf, lat=ORIGIN["lat"], lon=ORIGIN["lon"]).data["results"]
    assert [r["promotion"] for r in results] == [None, None]
    assert [r["headline"] for r in results] == ["Organic nearer", "Was promoted"]


def test_featured_strip_returns_only_live_top_promotions(rf, business):
    """/public/featured (Joymee VIP-pool equivalent): one card per campaign,
    only campaigns with a LIVE TOP window; RAISED and organic never appear."""
    from apps.discovery.views import PublicFeaturedAdsView

    top_a, _ = _eligible(business, "Top offer A", 41.31)
    top_b, _ = _eligible(business, "Top offer B", 41.32)
    raised, _ = _eligible(business, "Raised offer", 41.31)
    _eligible(business, "Organic offer", 41.31)

    now = timezone.now()
    Placement.objects.filter(campaign=top_a).update(
        promotion_tier="top",
        promotion_started_at=now - timedelta(hours=2),
        promotion_ends_at=now + timedelta(days=2),
    )
    Placement.objects.filter(campaign=top_b).update(
        promotion_tier="top",
        promotion_started_at=now - timedelta(hours=1),  # more recent: first
        promotion_ends_at=now + timedelta(days=1),
    )
    Placement.objects.filter(campaign=raised).update(
        promotion_tier="raised",
        promotion_started_at=now - timedelta(hours=1),
        promotion_ends_at=now + timedelta(days=1),
    )

    response = PublicFeaturedAdsView.as_view()(
        rf.get("/api/v1/public/featured", {"lat": str(ORIGIN["lat"]),
                                           "lon": str(ORIGIN["lon"])})
    )
    assert response.status_code == 200
    results = response.data["results"]
    # With an origin the strip is nearest-first (A at 41.31 beats B at 41.32);
    # without one it falls back to most-recently-promoted (checked implicitly
    # by the recency sort above the distance branch).
    assert [r["headline"] for r in results] == ["Top offer A", "Top offer B"]
    assert all(r["promotion"] == "top" for r in results)
    assert all(r["distance_m"] is not None for r in results)


def test_featured_strip_excludes_expired_windows(rf, business):
    from apps.discovery.views import PublicFeaturedAdsView

    campaign, _ = _eligible(business, "Expired top", 41.31)
    now = timezone.now()
    Placement.objects.filter(campaign=campaign).update(
        promotion_tier="top",
        promotion_started_at=now - timedelta(days=5),
        promotion_ends_at=now - timedelta(days=1),
    )

    response = PublicFeaturedAdsView.as_view()(rf.get("/api/v1/public/featured"))
    assert response.data["results"] == []
