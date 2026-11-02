"""Public-endpoint input hardening: bbox guard branches, cursor tampering,
origin range validation, short-query mirroring, promo-first sheet slicing and
the eligible-only text-match contract. These are unauthenticated surfaces —
every malformed input must 400 cleanly, never 500."""
import base64
import json
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.campaigns.models import Campaign
from apps.moderation.services import approve_campaign, submit_for_review
from apps.placements.models import Placement, PromotionTier

from .test_search_hardening import _eligible_placement

pytestmark = pytest.mark.django_db

PINS_URL = "/api/v1/public/locations"
NEARBY_URL = "/api/v1/public/ads"
SEARCH_URL = "/api/v1/public/search"

# Tashkent-centred, well under MAX_BBOX_AREA (1.0 deg²).
GOOD_BBOX = "69.20,41.25,69.35,41.35"


class TestBboxGuard:
    def test_valid_bbox_passes(self):
        assert APIClient().get(PINS_URL, {"bbox": GOOD_BBOX}).status_code == 200

    @pytest.mark.parametrize(
        "bbox",
        [
            "69.2",                          # wrong arity
            "69.2,41.2,69.3",                # wrong arity
            "69.2,41.2,69.3,41.3,69.4",      # wrong arity
            "garbage",                       # non-numeric
            "69.2,abc,69.3,41.3",            # non-numeric corner
            "69.3,41.3,69.2,41.2",           # reversed corners (lon/lat)
            "69.2,41.3,69.3,41.2",           # reversed lat
            "0.0,0.0,5.0,5.0",               # area > 1 deg²
            "nan,41.2,69.3,41.3",            # NaN parses as float
            "inf,41.2,69.3,41.3",
        ],
    )
    def test_malformed_or_oversized_bbox_rejected(self, bbox):
        response = APIClient().get(PINS_URL, {"bbox": bbox})
        assert response.status_code == 400

    def test_missing_bbox_rejected(self):
        assert APIClient().get(PINS_URL).status_code == 400


class TestCursorTampering:
    def _first_cursor(self, client, campaign, location, staff):
        # Two distinct campaigns (the feed's unit) + limit=1 → a real page
        # boundary with a next_cursor.
        second = Campaign.objects.create(
            business=campaign.business,
            headline="Cursor fixture second ad",
            body="",
            banner_key="banners/cur.jpg",
        )
        for c in (campaign, second):
            submit_for_review(campaign=c)
            approve_campaign(campaign=c, reviewer=staff)
            _eligible_placement(c, location)
        page = client.get(
            NEARBY_URL, {"lat": "41.31", "lon": "69.27", "radius_m": "5000", "limit": "1"}
        ).json()
        assert page["next_cursor"], "fixture: expected a second page"
        return page["next_cursor"]

    @pytest.mark.parametrize(
        "cursor",
        [
            "!!!not-base64!!!",
            # valid base64, but not the expected JSON shape
            "YWJjZGVm",  # "abcdef"
        ],
    )
    def test_garbage_cursor_rejected(self, cursor):
        response = APIClient().get(
            NEARBY_URL,
            {"lat": "41.31", "lon": "69.27", "radius_m": "5000", "cursor": cursor},
        )
        assert response.status_code == 400

    def test_wrong_shape_json_cursor_rejected(self):
        payload = base64.urlsafe_b64encode(json.dumps([1, 2]).encode()).decode()
        response = APIClient().get(
            NEARBY_URL,
            {"lat": "41.31", "lon": "69.27", "radius_m": "5000", "cursor": payload},
        )
        assert response.status_code == 400

    def test_cursor_rejected_when_filters_change(self, campaign, location, staff):
        client = APIClient()
        cursor = self._first_cursor(client, campaign, location, staff)
        # Same cursor, different radius: the fingerprint no longer matches.
        response = client.get(
            NEARBY_URL,
            {
                "lat": "41.31", "lon": "69.27", "radius_m": "3000",
                "limit": "1", "cursor": cursor,
            },
        )
        assert response.status_code == 400


class TestSearchOriginValidation:
    def test_out_of_range_lat_rejected(self):
        response = APIClient().get(
            SEARCH_URL, {"q": "test", "lat": "999", "lon": "69.27"}
        )
        assert response.status_code == 400

    def test_out_of_range_lon_rejected(self):
        response = APIClient().get(
            SEARCH_URL, {"q": "test", "lat": "41.31", "lon": "-181"}
        )
        assert response.status_code == 400

    def test_non_numeric_origin_rejected(self):
        response = APIClient().get(
            SEARCH_URL, {"q": "test", "lat": "abc", "lon": "69.27"}
        )
        assert response.status_code == 400

    def test_missing_origin_still_searches_by_name(self):
        assert APIClient().get(SEARCH_URL, {"q": "Branch"}).status_code == 200


class TestShortQueryMirroring:
    def test_pins_one_char_query_returns_empty(self):
        response = APIClient().get(PINS_URL, {"bbox": GOOD_BBOX, "q": "x"})
        assert response.status_code == 200
        assert response.json() == []


class TestSheetPromoFirstSlicing:
    def test_paid_top_ad_survives_the_20_slice_regardless_of_start(
        self, owner, tariff, business, campaign, location, staff
    ):
        """The branch sheet's [:20] must cut by DISPLAY order (TOP first), not
        start_at — an organic ad with an earlier start must never push a paid
        TOP ad out of the window (and the pin preview must agree)."""
        now = timezone.now()
        submit_for_review(campaign=campaign)
        approve_campaign(campaign=campaign, reviewer=staff)
        # 20 organic placements with progressively earlier starts.
        for i in range(20):
            Placement.objects.create(
                campaign=campaign,
                location=location,
                start_at=now - timedelta(hours=20 - i),
                end_at=now + timedelta(days=1),
                charge_days=1,
                state=Placement.State.ACTIVE,
            )
        # The TOP ad starts LAST by start_at: a naive [:20] would cut it.
        top_campaign = Campaign.objects.create(
            business=business,
            headline="TOP paid offer",
            body="",
            banner_key="banners/top.jpg",
        )
        submit_for_review(campaign=top_campaign)
        approve_campaign(campaign=top_campaign, reviewer=staff)
        Placement.objects.create(
            campaign=top_campaign,
            location=location,
            start_at=now,
            end_at=now + timedelta(days=1),
            charge_days=1,
            state=Placement.State.ACTIVE,
            promotion_tier=PromotionTier.TOP,
        )

        sheet = APIClient().get(f"{PINS_URL}/{location.id}").json()
        ads = sheet["active_ads"]
        assert len(ads) == 20
        assert ads[0]["headline"] == "TOP paid offer"
        assert ads[0]["promotion"] == "top"


class TestEligibleOnlyTextMatch:
    def test_approved_but_not_live_headline_does_not_match(
        self, owner, tariff, business, campaign, location, staff
    ):
        """Module contract: ONLY currently-eligible content surfaces — an
        approved campaign with zero live placements must not match its branch
        into search either."""
        campaign.headline = "Approved But Never Aired Headline"
        campaign.save(update_fields=["headline"])
        submit_for_review(campaign=campaign)
        approve_campaign(campaign=campaign, reviewer=staff)  # no placement

        data = APIClient().get(SEARCH_URL, {"q": "Never Aired"}).json()
        assert data["locations"] == []

    def test_live_headline_still_matches(
        self, owner, tariff, business, campaign, location, staff
    ):
        campaign.headline = "Live Headline Offer"
        campaign.save(update_fields=["headline"])
        submit_for_review(campaign=campaign)
        approve_campaign(campaign=campaign, reviewer=staff)
        _eligible_placement(campaign, location)

        data = APIClient().get(SEARCH_URL, {"q": "Live Headline"}).json()
        assert any(loc["id"] == str(location.id) for loc in data["locations"])
