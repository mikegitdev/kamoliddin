"""Shared factories for the focused financial test suite (spec §17).

Runs against real PostgreSQL+PostGIS via config.settings.test — never SQLite.
"""
from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from apps.accounts.models import User
from apps.billing.models import Tariff
from apps.businesses.models import Business, BusinessCategory
from apps.campaigns.models import Campaign
from apps.locations.models import Location


@pytest.fixture
def tariff(db):
    return Tariff.objects.create(amount_per_24h=30_000_00)  # 30,000 UZS / 24h


@pytest.fixture
def owner(db):
    return User.objects.create_user(phone_e164="+998901000001")


@pytest.fixture
def other_owner(db):
    return User.objects.create_user(phone_e164="+998901000002")


@pytest.fixture
def staff(db):
    return User.objects.create_user(
        phone_e164="+998901000003", password="staffpass123", is_staff=True
    )


@pytest.fixture
def category(db):
    return BusinessCategory.objects.create(slug="test-cat", name_ru="Тест", name_uz="Test")


@pytest.fixture
def business(owner, category):
    return Business.objects.create(
        owner=owner, name="Test Business", slug="test-business", category=category
    )


@pytest.fixture
def location(business):
    return Location.objects.create(
        business=business,
        name="Branch 1",
        address="Tashkent, test 1",
        point=Point(69.27, 41.31, srid=4326),
    )


@pytest.fixture
def campaign(business):
    return Campaign.objects.create(
        business=business,
        headline="Test campaign",
        body="Body",
        banner_key="banners/test.jpg",
    )


@pytest.fixture
def interval():
    now = timezone.now()
    return now + timedelta(hours=1), now + timedelta(hours=25)  # 24h -> 1 day
