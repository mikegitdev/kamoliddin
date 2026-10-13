"""Public search visibility (spec §7.2, §14): search must expose only
currently-eligible content — same rules as the map/detail endpoints — and
respect the category filter for campaigns."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.campaigns.models import Campaign
from apps.discovery.views import PublicSearchView
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db


def _make_eligible(campaign, location):
    now = timezone.now()
    campaign.review_status = Campaign.ReviewStatus.APPROVED
    campaign.save(update_fields=["review_status"])
    Placement.objects.create(
        campaign=campaign,
        location=location,
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=23),
        state=Placement.State.ACTIVE,
        charge_days=1,
    )


def _search(rf, **params):
    return PublicSearchView.as_view()(rf.get("/api/v1/public/search", params))


def test_search_returns_eligible_campaign(rf, campaign, location):
    _make_eligible(campaign, location)
    response = _search(rf, q="Test campaign")
    assert response.status_code == 200
    assert any(c["id"] == str(campaign.id) for c in response.data["campaigns"])


def test_search_hides_campaign_of_disabled_business(rf, campaign, location, business):
    _make_eligible(campaign, location)
    business.status = "disabled"
    business.save(update_fields=["status"])
    response = _search(rf, q="Test campaign")
    assert response.data["campaigns"] == []


def test_search_campaigns_respect_category_filter(rf, campaign, location):
    _make_eligible(campaign, location)
    response = _search(rf, q="Test campaign", category="nonexistent-category")
    assert response.data["campaigns"] == []
