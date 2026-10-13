"""Campaign business immutability (spec §14): a campaign must not move to a
different business after creation — placements are keyed to the original
business's locations and approval must not survive a reassignment."""
from types import SimpleNamespace

import pytest

from apps.businesses.models import Business
from apps.campaigns.serializers import CampaignSerializer

pytestmark = pytest.mark.django_db


def _serializer(user, campaign, data):
    return CampaignSerializer(
        campaign,
        data=data,
        partial=True,
        context={"request": SimpleNamespace(user=user)},
    )


def test_business_change_rejected(owner, category, business, campaign):
    other = Business.objects.create(
        owner=owner, name="Other Business", slug="other-business", category=category
    )
    serializer = _serializer(owner, campaign, {"business": str(other.id)})
    assert not serializer.is_valid()
    assert "business" in serializer.errors


def test_same_business_patch_still_allowed(owner, business, campaign):
    serializer = _serializer(
        owner, campaign, {"business": str(business.id), "headline": "New headline"}
    )
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    campaign.refresh_from_db()
    assert campaign.headline == "New headline"
    assert campaign.business == business
