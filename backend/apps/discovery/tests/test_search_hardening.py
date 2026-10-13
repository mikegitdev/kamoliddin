"""Search hardening (spec §14, acceptance #12): unapproved campaign copy never
matches public search; relevance tiers order results before distance/name."""
from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone
from rest_framework.test import APIClient

from apps.businesses.models import Business
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.moderation.services import approve_campaign, reject_campaign, submit_for_review
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db

SEARCH_URL = "/api/v1/public/search"


def _eligible_placement(campaign, location):
    now = timezone.now()
    Placement.objects.create(
        campaign=campaign,
        location=location,
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(days=1),
        charge_days=1,
        state=Placement.State.ACTIVE,
    )


def test_rejected_headline_never_matches_public_search(
    owner, tariff, business, campaign, location, staff
):
    campaign.headline = "Secret Rejected Offer"
    campaign.save(update_fields=["headline"])
    submit_for_review(campaign=campaign)
    reject_campaign(campaign=campaign, reviewer=staff, reason="no")

    client = APIClient()
    response = client.get(SEARCH_URL, {"q": "Secret Rejected"})
    data = response.json()
    assert data["locations"] == []
    assert data["campaigns"] == []


def test_draft_headline_never_matches(owner, tariff, business, campaign, location):
    campaign.headline = "Draft Only Headline"
    campaign.save(update_fields=["headline"])  # stays draft

    client = APIClient()
    response = client.get(SEARCH_URL, {"q": "Draft Only"})
    assert response.json()["locations"] == []


def test_relevance_tiers_name_beats_business_beats_headline(
    owner, tariff, business, campaign, location, staff
):
    # Three matches for "pizza": location NAME, business NAME, campaign headline.
    pizzeria = Business.objects.create(
        owner=owner, name="Pizza Corp", slug="pizza-corp",
        category=business.category,
    )
    Location.objects.create(
        business=pizzeria, name="Pizza House", address="a1",
        point=Point(69.20, 41.30, srid=4326),
    )
    Location.objects.create(
        business=pizzeria, name="Downtown Branch", address="a2",
        point=Point(69.21, 41.31, srid=4326),
    )
    headline_campaign = Campaign.objects.create(
        business=pizzeria, headline="Hot Pizza Deal", body="", banner_key="banners/p.jpg",
    )
    submit_for_review(campaign=headline_campaign)
    approve_campaign(campaign=headline_campaign, reviewer=staff)
    headline_match = Location.objects.create(
        business=pizzeria, name="Suburb Branch", address="a3",
        point=Point(69.22, 41.32, srid=4326),
    )
    _eligible_placement(headline_campaign, headline_match)
    # Give the two lower-tier matches a closer origin so ONLY relevance can
    # explain the ordering.
    client = APIClient()
    response = client.get(
        SEARCH_URL,
        {"q": "pizza", "lat": 41.312, "lon": 69.210},  # nearest: business_match
    )
    names = [row["name"] for row in response.json()["locations"]]
    assert names[:3] == ["Pizza House", "Downtown Branch", "Suburb Branch"]
