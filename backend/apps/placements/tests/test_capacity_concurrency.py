"""Capacity concurrency proofs (spec §8 [R], §14, acceptance #13).

Real threads against real PostgreSQL: two concurrent checkouts competing for
the last slot, an overbooking attempt at activation, and reservation release
on order expiry. PENDING reservations must hold their slot.
"""
import threading
from datetime import timedelta

import pytest
from django.db import close_old_connections
from django.utils import timezone

from apps.billing.services import CheckoutError, create_checkout, create_quote
from apps.campaigns.models import Campaign
from apps.moderation.services import submit_for_review
from apps.payments.settlement import settle_payment_attempt
from apps.placements.models import Placement
from apps.placements.services import refresh_states

pytestmark = pytest.mark.django_db


def _second_campaign(business):
    return Campaign.objects.create(
        business=business,
        headline="Second campaign",
        body="",
        banner_key="banners/second.jpg",
    )


def _fill(location, campaign, count):
    now = timezone.now()
    for _ in range(count):
        Placement.objects.create(
            campaign=campaign,
            location=location,
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(days=2),
            charge_days=3,
            state=Placement.State.ACTIVE,
        )


def _run_in_threads(fn, n=2):
    """Run fn(i) in n threads, each with its own DB connection; return outcomes."""
    results: list = []

    def wrapper(i):
        close_old_connections()
        try:
            results.append(("ok", fn(i)))
        except Exception as exc:  # noqa: BLE001 — record the race outcome
            results.append(("exc", exc))
        finally:
            close_old_connections()

    threads = [threading.Thread(target=wrapper, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


@pytest.mark.django_db(transaction=True)
def test_concurrent_checkouts_last_slot_exactly_one_wins(
    owner, tariff, business, campaign, location
):
    """Acceptance #13: two owners race for the final ad slot at a location —
    the advisory-locked reservation lets exactly one checkout proceed."""
    submit_for_review(campaign=campaign)
    other = _second_campaign(business)
    submit_for_review(campaign=other)
    _fill(location, campaign, count=4)  # 4 taken, cap 5, one slot left

    start = timezone.now() + timedelta(hours=1)
    order_a = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start, requested_end_at=start + timedelta(hours=24),
    )
    order_b = create_quote(
        user=owner, business_id=business.id, campaign_id=other.id,
        location_ids=[location.id],
        requested_start_at=start, requested_end_at=start + timedelta(hours=24),
    )

    outcomes = _run_in_threads(
        lambda i: create_checkout(user=owner, order_id=order_a.id if i == 0 else order_b.id)
    )
    errors = [exc for kind, exc in outcomes if kind == "exc"]
    successes = [res for kind, res in outcomes if kind == "ok"]
    assert len(successes) == 1
    assert len(errors) == 1 and isinstance(errors[0], CheckoutError)

    reservations = Placement.objects.filter(
        location=location, state=Placement.State.PENDING
    ).count()
    assert reservations == 1  # exactly one order holds the last slot


def test_pending_reservation_blocks_sixth_quote(owner, tariff, business, campaign, location):
    """A checked-out (unpaid) order reserves its slot: the next quote for the
    same interval sees capacity exhausted (ADR-0003)."""
    submit_for_review(campaign=campaign)
    _fill(location, campaign, count=4)
    start = timezone.now() + timedelta(hours=1)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start, requested_end_at=start + timedelta(hours=24),
    )
    create_checkout(user=owner, order_id=order.id)

    from rest_framework.exceptions import ValidationError

    other = _second_campaign(business)
    submit_for_review(campaign=other)
    with pytest.raises(ValidationError):
        create_quote(
            user=owner, business_id=business.id, campaign_id=other.id,
            location_ids=[location.id],
            requested_start_at=start, requested_end_at=start + timedelta(hours=24),
        )


def test_expired_order_releases_reservation(owner, tariff, business, campaign, location):
    """Quote TTL + grace: an abandoned checkout stops squatting its slot."""
    from apps.billing.models import Order

    submit_for_review(campaign=campaign)
    start = timezone.now() + timedelta(hours=1)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start, requested_end_at=start + timedelta(hours=24),
    )
    create_checkout(user=owner, order_id=order.id)
    assert Placement.objects.filter(order=order, state=Placement.State.PENDING).exists()

    order.quote_expires_at = timezone.now() - timedelta(hours=3)  # past TTL + grace
    order.save(update_fields=["quote_expires_at"])
    refresh_states()

    order.refresh_from_db()
    assert order.state == Order.State.EXPIRED
    assert not Placement.objects.filter(order=order, state=Placement.State.PENDING).exists()


def test_activation_blocks_instead_of_overbooking(
    owner, tariff, business, campaign, location
):
    """If capacity vanished between checkout and settlement (here: an admin
    grant fills the slot first), the paid placement is BLOCKED with an audit
    event — never silently overbooked, public eligibility ignores BLOCKED."""
    from apps.accounts.models import User
    from apps.moderation.models import ActivityEvent
    from apps.moderation.services import approve_campaign

    staff = User.objects.create_user(phone_e164="+998901000099", password="x", is_staff=True)
    submit_for_review(campaign=campaign)
    approve_campaign(campaign=campaign, reviewer=staff)

    start = timezone.now() + timedelta(hours=2)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start, requested_end_at=start + timedelta(hours=24),
    )
    attempt, _ = create_checkout(user=owner, order_id=order.id)
    # Reserve, then free the reservation's slot by cancelling it and filling
    # capacity with another campaign's placements before settlement.
    Placement.objects.filter(order=order).update(state=Placement.State.CANCELLED)
    _fill(location, _second_campaign(business), count=5)

    attempt.status = "succeeded"
    attempt.save()
    # Settlement re-creates the placement; capacity is gone -> BLOCKED.
    from apps.billing.models import Order

    order.state = Order.State.AWAITING_PAYMENT
    order.save(update_fields=["state"])
    settle_payment_attempt(attempt.id)

    blocked = Placement.objects.filter(order=order, state=Placement.State.BLOCKED)
    assert blocked.exists()
    assert blocked.get().block_reason == "capacity_conflict"
    assert ActivityEvent.objects.filter(action="placement.capacity_conflict").exists()


@pytest.mark.django_db(transaction=True)
def test_settlement_of_reserved_order_promotes_once(
    owner, tariff, business, campaign, location
):
    """The normal path: reserve at checkout, settle once, promote once —
    duplicate settlement with a different webhook event id changes nothing."""
    from apps.accounts.models import User
    from apps.moderation.services import approve_campaign

    staff = User.objects.create_user(phone_e164="+998901000098", password="x", is_staff=True)
    submit_for_review(campaign=campaign)
    approve_campaign(campaign=campaign, reviewer=staff)

    start = timezone.now() + timedelta(hours=2)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id],
        requested_start_at=start, requested_end_at=start + timedelta(hours=24),
    )
    attempt, _ = create_checkout(user=owner, order_id=order.id)
    attempt.status = "succeeded"
    attempt.save()

    import json

    from apps.payments.gateways import get_payment_gateway
    from apps.payments.views import _apply_verified_event

    gateway = get_payment_gateway("fake")

    def deliver(event_id):
        payload = json.dumps({
            "event_id": event_id,
            "provider_payment_id": attempt.provider_payment_id,
            "amount_minor": attempt.amount,
            "currency": order.currency,
            "succeeded": True,
        }).encode()
        _apply_verified_event("fake", gateway.verify_webhook(payload=payload, headers={}))

    outcomes = _run_in_threads(lambda i: deliver(f"evt-{i}-{attempt.id}"))
    assert all(kind == "ok" for kind, _ in outcomes)

    order.refresh_from_db()
    assert order.state == "paid"
    assert Placement.objects.filter(order=order).count() == 1
    reserved = Placement.objects.get(order=order)
    assert reserved.state == Placement.State.SCHEDULED
