"""Campaign reviews API (spec §5): advertisers read the immutable moderation
history of their own campaigns — rejection reasons drive the correction flow.
Owner scoping is the security-relevant behavior under test."""
import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.campaigns.models import CampaignReview

pytestmark = pytest.mark.django_db

REVIEWS_URL = "/api/v1/campaigns/{}/reviews"


def _reject(campaign, staff, reason, when=None):
    campaign.review_status = campaign.ReviewStatus.REJECTED
    campaign.save()
    return CampaignReview.objects.create(
        campaign=campaign,
        content_version=campaign.review_version,
        reviewer=staff,
        decision=CampaignReview.Decision.REJECTED,
        reason=reason,
        created_at=when or timezone.now(),
    )


def test_owner_sees_rejection_reason(owner, staff, business, campaign):
    _reject(campaign, staff, "Banner shows a phone number; remove it")
    client = APIClient()
    client.force_authenticate(user=owner)

    response = client.get(REVIEWS_URL.format(campaign.id))

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["decision"] == "rejected"
    assert rows[0]["reason"] == "Banner shows a phone number; remove it"
    assert rows[0]["content_version"] == campaign.review_version
    assert "reviewer" not in rows[0]  # staff identity stays private


def test_reviews_ordered_newest_first(owner, staff, business, campaign):
    old = timezone.now()
    _reject(campaign, staff, "first reason", when=old)
    CampaignReview.objects.create(
        campaign=campaign,
        content_version=1,
        reviewer=staff,
        decision=CampaignReview.Decision.APPROVED,
        created_at=timezone.now(),
    )

    client = APIClient()
    client.force_authenticate(user=owner)
    rows = client.get(REVIEWS_URL.format(campaign.id)).json()

    assert [r["decision"] for r in rows] == ["approved", "rejected"]
    assert rows[0]["created_at"] >= rows[1]["created_at"]


def test_foreign_campaign_hidden_from_other_owners(other_owner, staff, business, campaign):
    _reject(campaign, staff, "reason")
    client = APIClient()
    client.force_authenticate(user=other_owner)

    response = client.get(REVIEWS_URL.format(campaign.id))

    assert response.status_code == 200
    assert response.json() == []  # scoped to owner: foreign reviews are invisible
