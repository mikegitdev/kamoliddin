"""Staff control-room API: staff-only access, user blocking, placement
takedown round-trip, and the renewal gate that stops charging taken-down ads."""
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.moderation.models import ActivityEvent
from apps.moderation.services import approve_campaign, submit_for_review
from apps.placements.models import Placement
from apps.placements.services import issue_free_grant
from apps.renewals.services import process_agreement
from apps.renewals.tests.test_renewals import _active_agreement

pytestmark = pytest.mark.django_db


def _auth(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.parametrize("name", [
    "admin-users", "admin-businesses", "admin-locations", "admin-placements",
    "admin-activity", "admin-activity-export", "admin-payments",
    "admin-payment-events", "admin-renewals",
])
def test_control_lists_require_staff(owner, name):
    assert _auth(owner).get(reverse(name)).status_code == 403


def test_block_user_and_refuse_staff_targets(staff, owner):
    client = _auth(staff)
    response = client.post(reverse("admin-user-block", kwargs={"id": owner.id}),
                           {"reason": "fraud"}, format="json")
    assert response.status_code == 200
    owner.refresh_from_db()
    assert owner.is_active is False
    assert ActivityEvent.objects.filter(action="user.block",
                                        entity_id=str(owner.id)).exists()
    # Staff accounts (incl. self) are out of reach from the console.
    response = client.post(reverse("admin-user-block", kwargs={"id": staff.id}),
                           {"reason": "x"}, format="json")
    assert response.status_code == 409


def test_placement_block_unblock_roundtrip(staff, campaign, location):
    submit_for_review(campaign=campaign)
    approve_campaign(campaign=campaign, reviewer=staff)
    now = timezone.now()
    issue_free_grant(staff=staff, campaign=campaign, location=location,
                     start_at=now - timedelta(minutes=1),
                     end_at=now + timedelta(days=1), reason="test")
    placement = Placement.objects.get(campaign=campaign)
    assert placement.state == Placement.State.ACTIVE
    client = _auth(staff)

    response = client.post(reverse("admin-placement-block", kwargs={"id": placement.id}),
                           {"reason": "misleading"}, format="json")
    assert response.status_code == 200
    visible = client.get(reverse("admin-placements"), {"visible": "1"}).json()
    assert visible["count"] == 0

    response = client.post(reverse("admin-placement-unblock", kwargs={"id": placement.id}),
                           {"reason": "fixed"}, format="json")
    assert response.status_code == 200
    placement.refresh_from_db()
    assert placement.state == Placement.State.ACTIVE
    assert placement.block_reason == ""


def test_disabled_business_stops_renewal_charges(owner, tariff, business, campaign,
                                                 location, staff):
    agreement = _active_agreement(owner, tariff, business, campaign, location, staff)
    response = _auth(staff).post(
        reverse("admin-business-status", kwargs={"id": business.id}),
        {"status": "disabled", "reason": "fraud"}, format="json",
    )
    assert response.status_code == 200
    assert process_agreement(agreement)["result"] == "failed:business_disabled"
