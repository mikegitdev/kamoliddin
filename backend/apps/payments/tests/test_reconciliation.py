"""Reconciliation sweep invariants (ADR-0005 note 8): the two webhook crash
windows heal idempotently; provider queries never fabricate or downgrade
outcomes; unqueryable gateways land in the manual queue, not in guesses."""
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.billing.models import Order
from apps.billing.services import create_checkout, create_quote
from apps.moderation.services import submit_for_review
from apps.payments.gateways import FakePaymentGateway
from apps.payments.models import PaymentAttempt
from apps.payments.reconciliation import reconcile_payments
from apps.payments.settlement import settle_payment_attempt
from apps.placements.models import Placement
from apps.placements.services import refresh_states

pytestmark = pytest.mark.django_db


def _checkout_attempt(owner, tariff, business, campaign, location, *, stale=False):
    """Order checked out (attempt PENDING, capacity reserved); optionally
    aged past STALE_PENDING_AFTER so the sweep will query the provider."""
    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(minutes=30)
    end = start + timedelta(hours=24)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id], requested_start_at=start, requested_end_at=end,
    )
    attempt, _redirect = create_checkout(user=owner, order_id=order.id)
    if stale:
        PaymentAttempt.objects.filter(pk=attempt.pk).update(
            updated_at=timezone.now() - timedelta(minutes=31)
        )
    return order, attempt


def _succeeded_unsettled_attempt(owner, tariff, business, campaign, location):
    """Crash-window A fixture: webhook committed SUCCEEDED, settlement never ran."""
    order, attempt = _checkout_attempt(owner, tariff, business, campaign, location)
    PaymentAttempt.objects.filter(pk=attempt.pk).update(status="succeeded")
    return order, attempt


def test_sweep_settles_succeeded_but_unsettled(owner, tariff, business, campaign,
                                               location):
    order, attempt = _succeeded_unsettled_attempt(
        owner, tariff, business, campaign, location)

    result = reconcile_payments()

    order.refresh_from_db()
    assert result["settled"] == 1
    assert order.state == Order.State.PAID
    assert Placement.objects.get(campaign=campaign).state == Placement.State.PENDING

    second = reconcile_payments()  # idempotent: nothing left to do
    assert second["settled"] == 0 and second["unresolved"] == 0


def _provider_reports_succeeded(monkeypatch):
    monkeypatch.setattr(
        FakePaymentGateway, "get_payment_status",
        lambda self, *, provider_payment_id: "succeeded",
    )


def test_sweep_resolves_stale_pending_success(owner, tariff, business, campaign,
                                              location, monkeypatch):
    order, attempt = _checkout_attempt(
        owner, tariff, business, campaign, location, stale=True)
    _provider_reports_succeeded(monkeypatch)

    result = reconcile_payments()

    attempt.refresh_from_db()
    order.refresh_from_db()
    assert result["settled"] == 1
    assert attempt.status == PaymentAttempt.Status.SUCCEEDED
    # Provenance marker: digest set by the sweep (sha256 hex), not a webhook payload
    assert len(attempt.response_digest) == 64
    assert order.state == Order.State.PAID
    assert Placement.objects.get(campaign=campaign).state == Placement.State.PENDING


def test_sweep_fails_stale_pending_on_provider_failure(
    owner, tariff, business, campaign, location, monkeypatch
):
    order, attempt = _checkout_attempt(
        owner, tariff, business, campaign, location, stale=True)
    monkeypatch.setattr(
        FakePaymentGateway, "get_payment_status",
        lambda self, *, provider_payment_id: "failed",
    )

    result = reconcile_payments()

    attempt.refresh_from_db()
    order.refresh_from_db()
    assert attempt.status == PaymentAttempt.Status.FAILED
    assert order.state == Order.State.FAILED
    assert result["orders_failed"] == 1
    assert Placement.objects.get(campaign=campaign).state == Placement.State.CANCELLED


def test_sweep_leaves_fresh_pending_alone(owner, tariff, business, campaign,
                                          location):
    _checkout_attempt(owner, tariff, business, campaign, location, stale=False)

    result = reconcile_payments()

    assert result == {
        "settled": 0, "failed_attempts": 0, "orders_failed": 0,
        "still_pending": 0, "unresolved": 0, "unresolved_detail": [],
    }


def test_unimplemented_gateway_goes_to_manual_queue(
    owner, tariff, business, campaign, location, monkeypatch
):
    order, attempt = _checkout_attempt(
        owner, tariff, business, campaign, location, stale=True)

    def boom(provider_slug):
        raise NotImplementedError("CLICK pending merchant verification")

    monkeypatch.setattr("apps.payments.reconciliation.get_payment_gateway", boom)
    result = reconcile_payments()

    attempt.refresh_from_db()
    order.refresh_from_db()
    assert result["unresolved"] == 1 and result["settled"] == 0
    assert attempt.status == PaymentAttempt.Status.PENDING  # untouched, no guesses
    assert order.state == Order.State.AWAITING_PAYMENT

    with pytest.raises(SystemExit):
        call_command("reconcile_payments")


def test_status_query_never_downgrades_webhook_success(
    owner, tariff, business, campaign, location, monkeypatch
):
    """Race: the webhook settles the attempt while the sweep sits between its
    status query and its terminal write. The verified outcome must win."""
    order, attempt = _checkout_attempt(
        owner, tariff, business, campaign, location, stale=True)

    def racing_status(self, *, provider_payment_id):
        row = PaymentAttempt.objects.get(pk=attempt.pk)
        row.status = PaymentAttempt.Status.SUCCEEDED
        row.save()
        settle_payment_attempt(attempt.id)
        return "failed"  # stale provider answer must not flip the terminal state

    monkeypatch.setattr(FakePaymentGateway, "get_payment_status", racing_status)
    result = reconcile_payments()

    attempt.refresh_from_db()
    order.refresh_from_db()
    assert attempt.status == PaymentAttempt.Status.SUCCEEDED
    assert order.state == Order.State.PAID
    assert result["settled"] == 1 and result["failed_attempts"] == 0


def test_sweep_rescues_paid_but_expired_order(owner, tariff, business, campaign,
                                              location, monkeypatch):
    """Provider succeeded just before quote expiry and the webhook was lost:
    refresh_states already EXPIRED the order and released reservations — the
    sweep must still deliver the paid entitlement (resurrected reservation)."""
    order, attempt = _checkout_attempt(
        owner, tariff, business, campaign, location, stale=True)
    _provider_reports_succeeded(monkeypatch)
    Order.objects.filter(pk=order.pk).update(
        quote_expires_at=timezone.now() - timedelta(hours=3)
    )
    refresh_states()
    order.refresh_from_db()
    assert order.state == Order.State.EXPIRED  # precondition

    result = reconcile_payments()

    order.refresh_from_db()
    attempt.refresh_from_db()
    assert result["settled"] == 1
    assert attempt.status == PaymentAttempt.Status.SUCCEEDED
    assert order.state == Order.State.PAID
    placement = Placement.objects.get(campaign=campaign)
    assert placement.state == Placement.State.PENDING  # resurrected, not cancelled
