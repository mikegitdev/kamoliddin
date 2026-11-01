"""Post-campaign outcome survey (Joymee's 'were you able to sell?' loop):
owner-only, opens only after every placement ended, answered exactly once."""
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.campaigns.models import CampaignOutcome
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db


def _auth(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _place(campaign, location, *, state, start=-24, end=-1):
    now = timezone.now()
    return Placement.objects.create(
        campaign=campaign, location=location,
        start_at=now + timedelta(hours=start), end_at=now + timedelta(hours=end),
        state=state, charge_days=1,
    )


def test_outcome_requires_ended_campaign(owner, business, campaign, location):
    url = reverse("campaign-outcome", kwargs={"id": campaign.id})
    client = _auth(owner)

    # Never ran -> not_ended.
    response = client.post(url, {"answer": "brought_customers"}, format="json")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "not_ended"

    # Still running -> not_ended.
    _place(campaign, location, state=Placement.State.ACTIVE, start=-1, end=23)
    response = client.post(url, {"answer": "brought_customers"}, format="json")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "not_ended"


def test_outcome_answered_once_and_exposed(owner, other_owner, staff, business,
                                           campaign, location):
    _place(campaign, location, state=Placement.State.EXPIRED)
    url = reverse("campaign-outcome", kwargs={"id": campaign.id})
    client = _auth(owner)

    # Foreign owner sees 404, never a survey.
    assert _auth(other_owner).post(
        url, {"answer": "no_effect"}, format="json"
    ).status_code == 404

    detail = client.get(reverse("campaign-detail", kwargs={"id": campaign.id})).json()
    assert detail["outcome"] is None
    assert detail["outcome_eligible"] is True

    response = client.post(
        url, {"answer": "brought_customers", "comment": "14 звонков"}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["outcome"]["answer"] == "brought_customers"
    assert response.json()["outcome_eligible"] is False

    # Exactly once: a second answer is refused with a dedicated code.
    response = client.post(url, {"answer": "no_effect"}, format="json")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "already_answered"

    assert CampaignOutcome.objects.filter(campaign=campaign).count() == 1
