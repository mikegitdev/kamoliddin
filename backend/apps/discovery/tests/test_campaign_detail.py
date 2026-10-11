"""Public ad detail branch context (spec §14): a directly opened /ads/{id}
link must expose address/hours/contacts for the branches where the campaign
is CURRENTLY eligible — and nothing else. Same visibility rules as every
other public endpoint."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.campaigns.models import Campaign
from apps.discovery.views import PublicCampaignDetailView
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db


def _detail(rf, campaign_id):
    return PublicCampaignDetailView.as_view()(
        rf.get(f"/api/v1/public/campaigns/{campaign_id}"), id=str(campaign_id)
    )


def _make_eligible(campaign, location, *, state=Placement.State.ACTIVE):
    now = timezone.now()
    campaign.review_status = Campaign.ReviewStatus.APPROVED
    campaign.save(update_fields=["review_status"])
    return Placement.objects.create(
        campaign=campaign,
        location=location,
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=23),
        state=state,
        charge_days=1,
    )


def test_ad_detail_includes_eligible_branch_with_contacts(rf, campaign, location):
    _make_eligible(campaign, location)
    location.phone = "+998901234567"
    location.hours = {"mon": ["09:00", "21:00"]}
    location.save(update_fields=["phone", "hours"])

    response = _detail(rf, campaign.id)
    assert response.status_code == 200
    branches = response.data["locations"]
    assert [b["id"] for b in branches] == [str(location.id)]
    branch = branches[0]
    assert branch["name"] == location.name
    assert branch["address"] == location.address
    assert branch["phone"] == "+998901234567"
    assert branch["hours"] == {"mon": ["09:00", "21:00"]}
    assert branch["business_site"] == location.business.site
    assert branch["lon"] == pytest.approx(location.point.x)
    assert branch["lat"] == pytest.approx(location.point.y)


def test_ad_detail_dedupes_branches_and_hides_inactive_locations(
    rf, campaign, business, location
):
    from django.contrib.gis.geos import Point

    from apps.locations.models import Location

    second = Location.objects.create(
        business=business,
        name="Branch 2",
        address="Tashkent, test 2",
        point=Point(69.28, 41.30, srid=4326),
    )
    disabled = Location.objects.create(
        business=business,
        name="Branch 3",
        address="Tashkent, test 3",
        point=Point(69.29, 41.32, srid=4326),
        status=Location.Status.DISABLED,
    )
    # two placements at the same eligible location must yield one branch entry
    _make_eligible(campaign, location)
    _make_eligible(campaign, location)
    _make_eligible(campaign, second)
    _make_eligible(campaign, disabled)

    response = _detail(rf, campaign.id)
    assert response.status_code == 200
    ids = [b["id"] for b in response.data["locations"]]
    assert len(ids) == len(set(ids))  # duplicated placements yield one entry
    assert set(ids) == {str(location.id), str(second.id)}


def test_ad_detail_404_when_no_eligible_placement(rf, campaign, location):
    _make_eligible(campaign, location)
    placement = Placement.objects.get(campaign=campaign)
    placement.end_at = timezone.now() - timedelta(hours=1)  # expired
    placement.save(update_fields=["end_at"])

    response = _detail(rf, campaign.id)
    assert response.status_code == 404
