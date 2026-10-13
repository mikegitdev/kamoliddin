"""Webhook edge cases (spec §12 [R]): amount/currency mismatch leaves the
attempt untouched, unknown payments are recorded-not-crashed, unverified
providers return 503, and a failed payment fails the order + releases its
capacity reservation (ADR-0003)."""
import json
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.billing.services import create_checkout, create_quote
from apps.moderation.services import submit_for_review
from apps.payments.models import PaymentAttempt, PaymentEvent
from apps.placements.models import Placement

pytestmark = pytest.mark.django_db

WEBHOOK_URL = reverse("payment-webhook", kwargs={"provider": "fake"})


def _event(attempt, *, event_id, amount, currency="UZS", succeeded=True):
    return json.dumps({
        "event_id": event_id,
        "provider_payment_id": attempt.provider_payment_id,
        "amount_minor": amount,
        "currency": currency,
        "succeeded": succeeded,
    }).encode()


def _checkout(owner, tariff, business, campaign, location):
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(hours=2)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start, requested_end_at=start + timedelta(hours=24),
    )
    attempt, _ = create_checkout(user=owner, order_id=order.id)
    return order, attempt


def test_amount_mismatch_leaves_attempt_untouched(
    client, owner, tariff, business, campaign, location
):
    order, attempt = _checkout(owner, tariff, business, campaign, location)
    body = _event(attempt, event_id="evt-wrong-amount", amount=attempt.amount + 1)
    response = client.post(WEBHOOK_URL, data=body, content_type="application/json")
    assert response.status_code == 200
    attempt.refresh_from_db()
    assert attempt.status == PaymentAttempt.Status.PENDING
    order.refresh_from_db()
    assert order.state != "paid"


def test_currency_mismatch_rejected(client, owner, tariff, business, campaign, location):
    order, attempt = _checkout(owner, tariff, business, campaign, location)
    body = _event(attempt, event_id="evt-wrong-ccy", amount=attempt.amount, currency="USD")
    response = client.post(WEBHOOK_URL, data=body, content_type="application/json")
    assert response.status_code == 200
    order.refresh_from_db()
    assert order.state != "paid"


def test_unknown_payment_is_recorded_not_crashed(
    client, owner, tariff, business, campaign, location
):
    body = json.dumps({
        "event_id": "evt-ghost",
        "provider_payment_id": "fake-does-not-exist",
        "amount_minor": 100,
        "currency": "UZS",
        "succeeded": True,
    }).encode()
    response = client.post(WEBHOOK_URL, data=body, content_type="application/json")
    assert response.status_code == 200
    assert PaymentEvent.objects.filter(event_id="evt-ghost").exists()


def test_unverified_provider_returns_503(client, owner, tariff, business, campaign, location):
    response = client.post(
        reverse("payment-webhook", kwargs={"provider": "click"}),
        data="{}", content_type="application/json",
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"


def test_failed_payment_fails_order_and_releases_reservation(
    client, owner, tariff, business, campaign, location
):
    from apps.billing.models import Order

    order, attempt = _checkout(owner, tariff, business, campaign, location)
    assert Placement.objects.filter(order=order, state=Placement.State.PENDING).exists()

    body = _event(attempt, event_id="evt-fail-1", amount=attempt.amount, succeeded=False)
    response = client.post(WEBHOOK_URL, data=body, content_type="application/json")
    assert response.status_code == 200

    order.refresh_from_db()
    assert order.state == Order.State.FAILED
    assert not Placement.objects.filter(order=order, state=Placement.State.PENDING).exists()
