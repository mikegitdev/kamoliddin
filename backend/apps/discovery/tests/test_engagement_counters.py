"""Public engagement counters (Joymee borrow #2) and structured report reasons.

Counts must only move for ads a visitor can actually see, and the public
endpoints must reject malformed input rather than store it."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.campaigns.models import Campaign, CampaignEvent
from apps.discovery.views import PublicCampaignEventView, PublicReportView
from apps.moderation.models import Report
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db


def _make_eligible(campaign, location):
    now = timezone.now()
    campaign.review_status = Campaign.ReviewStatus.APPROVED
    campaign.save(update_fields=["review_status"])
    return Placement.objects.create(
        campaign=campaign,
        location=location,
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=23),
        state=Placement.State.ACTIVE,
        charge_days=1,
    )


def _event(rf, campaign_id, kind):
    return PublicCampaignEventView.as_view()(
        rf.post(f"/api/v1/public/campaigns/{campaign_id}/events", {"kind": kind}),
        id=str(campaign_id),
    )


def test_event_on_live_ad_is_counted(rf, campaign, location):
    _make_eligible(campaign, location)

    assert _event(rf, campaign.id, "view").status_code == 202
    assert _event(rf, campaign.id, "contact").status_code == 202

    kinds = sorted(CampaignEvent.objects.filter(campaign=campaign).values_list("kind", flat=True))
    assert kinds == ["contact", "view"]


def test_event_on_non_live_ad_is_refused_and_not_stored(rf, campaign):
    # Draft campaign: no eligible placement, so the ad is not public.
    response = _event(rf, campaign.id, "view")

    assert response.status_code == 404
    assert not CampaignEvent.objects.filter(campaign=campaign).exists()


def test_event_rejects_unknown_kind(rf, campaign, location):
    _make_eligible(campaign, location)

    response = _event(rf, campaign.id, "visitor-id")

    assert response.status_code == 400
    assert not CampaignEvent.objects.filter(campaign=campaign).exists()


def test_report_stores_valid_category_and_rejects_unknown(rf, campaign, location):
    _make_eligible(campaign, location)
    view = PublicReportView.as_view()
    body = {"entity": "campaign", "entity_id": str(campaign.id), "reason": "Fake offer"}

    ok = view(rf.post("/api/v1/public/reports", {**body, "category": "spam"}))
    bad = view(rf.post("/api/v1/public/reports", {**body, "category": "rude"}))

    assert ok.status_code == 202
    assert bad.status_code == 400
    assert list(Report.objects.values_list("category", flat=True)) == ["spam"]
