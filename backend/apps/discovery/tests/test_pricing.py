"""Public pricing endpoint (spec §6): exposes the current Tariff so the
campaign editor can show a live cost estimate. The quote endpoint remains
the source of truth for charged amounts."""
import pytest

from apps.discovery.views import PublicPricingView

pytestmark = pytest.mark.django_db


def _get(rf):
    return PublicPricingView.as_view()(rf.get("/api/v1/public/pricing"))


def test_pricing_returns_current_tariff(rf, tariff):
    response = _get(rf)
    assert response.status_code == 200
    body = response.data["tariff"]
    assert body["amount_per_24h"] == tariff.amount_per_24h
    assert body["currency"] == "UZS"


def test_pricing_without_tariff_returns_null(rf, db):
    response = _get(rf)
    assert response.status_code == 200
    assert response.data["tariff"] is None
