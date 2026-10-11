"""Campaign list/detail expose `active_placements_count` so the cabinet can
separate PUBLICATION state (live placements) from MODERATION state
(review_status) — spec §7: approved ≠ live. Only currently eligible
placements count (same rules as the public API)."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.campaigns.models import Campaign
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/campaigns"


def _placement(campaign, location, *, active=True, **overrides):
    now = timezone.now()
    campaign.review_status = Campaign.ReviewStatus.APPROVED
    campaign.save(update_fields=["review_status"])
    defaults = dict(
        campaign=campaign,
        location=location,
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=23),
        state=Placement.State.ACTIVE if active else Placement.State.EXPIRED,
        charge_days=1,
    )
    defaults.update(overrides)
    return Placement.objects.create(**defaults)


def test_list_counts_only_currently_eligible_placements(owner, campaign, location):
    _placement(campaign, location, active=True)
    _placement(  # expired interval: same campaign+location, must not count
        campaign,
        location,
        active=True,
        start_at=timezone.now() - timedelta(hours=48),
        end_at=timezone.now() - timedelta(hours=24),
    )
    client = APIClient()
    client.force_authenticate(user=owner)

    response = client.get(LIST_URL)

    assert response.status_code == 200
    row = next(c for c in response.json() if c["id"] == str(campaign.id))
    assert row["review_status"] == "approved"
    assert row["active_placements_count"] == 1


def test_draft_without_placements_reports_zero(owner, campaign):
    client = APIClient()
    client.force_authenticate(user=owner)

    response = client.get(LIST_URL)

    row = next(c for c in response.json() if c["id"] == str(campaign.id))
    assert row["active_placements_count"] == 0


def test_owner_scoping_still_holds(other_owner, campaign):
    client = APIClient()
    client.force_authenticate(user=other_owner)

    response = client.get(LIST_URL)

    assert response.status_code == 200
    assert all(c["id"] != str(campaign.id) for c in response.json())
