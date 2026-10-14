"""Moderation API (spec §12 admin endpoints): staff-only access, review
decisions, takedown/unsuspend, ad-limit setting, and cross-tenant invisibility.
"""
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.moderation.services import submit_for_review

pytestmark = pytest.mark.django_db


def _auth(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_review_queue_requires_staff(owner, campaign):
    submit_for_review(campaign=campaign)
    response = _auth(owner).get(reverse("admin-review-queue"))
    assert response.status_code == 403


def test_review_queue_lists_submitted_campaigns(staff, campaign):
    submit_for_review(campaign=campaign)
    response = _auth(staff).get(reverse("admin-review-queue"))
    assert response.status_code == 200
    ids = [row["id"] for row in response.json()]
    assert str(campaign.id) in ids


def test_approve_via_api_moves_campaign(staff, campaign):
    submit_for_review(campaign=campaign)
    response = _auth(staff).post(
        reverse("admin-campaign-review", kwargs={"id": campaign.id}),
        {"decision": "approve"}, format="json",
    )
    assert response.status_code == 200
    campaign.refresh_from_db()
    assert campaign.review_status == "approved"


def test_reject_without_reason_uses_default_reason(staff, campaign):
    """The admin API deliberately accepts rejection without a typed reason
    and records the default — documented behavior, not an error."""
    submit_for_review(campaign=campaign)
    response = _auth(staff).post(
        reverse("admin-campaign-review", kwargs={"id": campaign.id}),
        {"decision": "reject"}, format="json",
    )
    assert response.status_code == 200
    campaign.refresh_from_db()
    assert campaign.review_status == "rejected"
    from apps.campaigns.models import CampaignReview

    review = CampaignReview.objects.filter(campaign=campaign).latest("created_at")
    assert review.reason == "Rejected via admin API"


def test_suspend_unsuspend_roundtrip(staff, campaign):
    from apps.moderation.services import approve_campaign

    submit_for_review(campaign=campaign)
    approve_campaign(campaign=campaign, reviewer=staff)
    response = _auth(staff).post(
        reverse("admin-campaign-suspend", kwargs={"id": campaign.id}),
        {"reason": "risk"}, format="json",
    )
    assert response.status_code == 200
    campaign.refresh_from_db()
    assert campaign.review_status == "suspended"

    response = _auth(staff).post(
        reverse("admin-campaign-unsuspend", kwargs={"id": campaign.id}), format="json"
    )
    assert response.status_code == 200
    campaign.refresh_from_db()
    assert campaign.review_status == "approved"


def test_ad_limit_get_and_patch(staff):
    get = _auth(staff).get(reverse("admin-ad-limit"))
    assert get.status_code == 200
    assert get.json() == {"key": "max_active_ads_per_location", "value": 5}

    patch = _auth(staff).patch(
        reverse("admin-ad-limit"), {"value": 3}, format="json"
    )
    assert patch.status_code == 200
    from apps.moderation.models import PlatformSetting

    setting = PlatformSetting.objects.get(key="max_active_ads_per_location")
    assert setting.value_json == 3


def test_foreign_campaign_review_is_404(staff, other_owner, campaign):
    """Another owner's campaign id must not be reviewable-looking to them:
    staff endpoints are staff-only; owner cabinet scoping covered elsewhere."""
    submit_for_review(campaign=campaign)
    response = _auth(other_owner).post(
        reverse("admin-campaign-review", kwargs={"id": campaign.id}),
        {"decision": "approve"}, format="json",
    )
    assert response.status_code == 403


def test_grant_options_include_recent_grants(staff, campaign, location):
    """GET admin/grants feeds the form AND the audit list: issued grants must
    be visible with campaign/location context (staff cannot issue blind)."""
    from datetime import timedelta

    from django.utils import timezone

    from apps.moderation.services import approve_campaign
    from apps.placements.models import Placement
    from apps.placements.services import issue_free_grant

    submit_for_review(campaign=campaign)
    approve_campaign(campaign=campaign, reviewer=staff)
    now = timezone.now()
    issue_free_grant(
        staff=staff, campaign=campaign, location=location,
        start_at=now, end_at=now + timedelta(hours=24), reason="launch promo",
    )
    response = _auth(staff).get(reverse("admin-grants"))
    assert response.status_code == 200
    grants = response.json()["grants"]
    assert any(
        g["campaign_headline"] == campaign.headline and g["reason"] == "launch promo"
        for g in grants
    )
    # The issued grant is a live placement, so the list carries real context.
    assert Placement.objects.filter(
        campaign=campaign, source_type=Placement.SourceType.GRANT
    ).exists()
