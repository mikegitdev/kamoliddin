"""Renewal invariants (spec §8, §14): one charge per period under concurrency,
content change forces alert, cancellation stops future charges."""
from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from apps.billing.services import create_checkout, create_quote
from apps.locations.models import Location
from apps.moderation.services import approve_campaign, submit_for_review
from apps.payments.settlement import settle_payment_attempt
from apps.renewals.models import RenewalAgreement, RenewalAttempt
from apps.renewals.services import (
    cancel_agreement,
    process_agreement,
    run_due_renewals,
)

pytestmark = pytest.mark.django_db


def _active_agreement(owner, tariff, business, campaign, location, staff):
    submit_for_review(campaign=campaign)
    approve_campaign(campaign=campaign, reviewer=staff)
    start = timezone.now() + timedelta(minutes=5)
    end = start + timedelta(hours=24)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id], requested_start_at=start, requested_end_at=end,
        auto_renew=True,
    )
    attempt, _ = create_checkout(user=owner, order_id=order.id)
    attempt.status = "succeeded"
    attempt.save()
    settle_payment_attempt(attempt.id)
    agreement = RenewalAgreement.objects.get(campaign=campaign)
    agreement.next_run_at = timezone.now()  # force due
    agreement.save(update_fields=["next_run_at"])
    return agreement


@pytest.mark.django_db(transaction=True)
def test_renewal_charges_once_per_period(owner, tariff, business, campaign, location, staff):
    """Two workers racing on the same due agreement: exactly one charge, exactly
    one reserved term (spec §8 concurrency proof, §14 'Renewal worker runs twice')."""
    import threading

    agreement = _active_agreement(owner, tariff, business, campaign, location, staff)
    results: list[dict] = []

    def run():
        results.append(process_agreement(agreement))

    t1, t2 = threading.Thread(target=run), threading.Thread(target=run)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    outcomes = sorted(r["result"] for r in results)
    assert outcomes == ["already_processed", "charged"]
    assert RenewalAttempt.objects.filter(agreement=agreement).count() == 1
    from apps.billing.models import Order

    # original purchase + exactly one renewal
    assert Order.objects.filter(campaign=campaign, state=Order.State.PAID).count() == 2


def test_content_change_stops_renewal(owner, tariff, business, campaign, location, staff):
    agreement = _active_agreement(owner, tariff, business, campaign, location, staff)
    campaign.headline = "Changed headline"
    campaign.save(update_fields=["headline"])
    result = process_agreement(agreement)
    assert result["result"].startswith("failed:content_changed")
    agreement.refresh_from_db()
    assert agreement.status == RenewalAgreement.Status.ALERT
    # No successful charge, no new paid order
    assert not RenewalAttempt.objects.filter(
        agreement=agreement, state=RenewalAttempt.State.SUCCEEDED
    ).exists()


def test_cancelled_agreement_never_charges(owner, tariff, business, campaign, location, staff):
    agreement = _active_agreement(owner, tariff, business, campaign, location, staff)
    cancel_agreement(user=owner, agreement_id=agreement.id)
    agreement.refresh_from_db()
    assert agreement.status == RenewalAgreement.Status.DISABLED
    results = run_due_renewals()  # disabled agreements are not even selected
    assert results == []


def test_successful_renewal_reserves_exactly_one_next_term(
    owner, tariff, business, campaign, location, staff
):
    from apps.placements.models import Placement

    agreement = _active_agreement(owner, tariff, business, campaign, location, staff)
    before = Placement.objects.filter(campaign=campaign, source_type="paid").count()
    result = process_agreement(agreement)
    assert result["result"] == "charged"
    after = Placement.objects.filter(campaign=campaign, source_type="paid").count()
    assert after == before + 1  # exactly one new term reserved


def test_pending_token_agreement_never_charges(
    owner, tariff, business, campaign, location, staff, settings
):
    """ADR-0005: with an unverified provider the agreement carries NO token;
    the worker skips it instead of charging a garbage reference."""
    agreement = _active_agreement(owner, tariff, business, campaign, location, staff)
    agreement.status = RenewalAgreement.Status.PENDING_TOKEN
    agreement.token_ref = ""
    agreement.save(update_fields=["status", "token_ref"])

    result = process_agreement(agreement)
    assert result["result"] == "skipped_pending_token"
    assert not RenewalAttempt.objects.filter(agreement=agreement).exists()

    results = run_due_renewals()  # not even selected when due
    assert agreement.id not in [r.get("agreement") for r in results if r.get("agreement")]


def test_new_consent_with_unverified_provider_creates_pending_token(
    owner, tariff, business, campaign, location, staff, settings
):
    """A paid auto-renew order under an unverified provider creates the
    agreement as PENDING_TOKEN with an empty token_ref (never a fake token)."""
    submit_for_review(campaign=campaign)
    approve_campaign(campaign=campaign, reviewer=staff)
    start = timezone.now() + timedelta(minutes=5)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id], requested_start_at=start,
        requested_end_at=start + timedelta(hours=24), auto_renew=True,
    )
    attempt, _ = create_checkout(user=owner, order_id=order.id)  # fake provider
    attempt.status = "succeeded"
    attempt.save()
    # Provider switched to an unverified one before settlement: the agreement
    # must NOT receive a fabricated token (ADR-0005).
    settings.PAYMENT_PROVIDER = "click"
    settle_payment_attempt(attempt.id)

    agreement = RenewalAgreement.objects.get(campaign=campaign)
    assert agreement.token_ref == ""
    assert agreement.status == RenewalAgreement.Status.PENDING_TOKEN


def test_changed_consent_refreshes_agreement_snapshot(
    owner, tariff, business, campaign, location, staff
):
    """ADR-0003: a new paid auto-renew order with a different location set is
    the latest explicit consent — snapshot and next_run_at follow it."""
    from apps.moderation.models import ActivityEvent

    agreement = _active_agreement(owner, tariff, business, campaign, location, staff)

    second_location = Location.objects.create(
        business=business, name="Branch 2", address="Tashkent, test 2",
        point=Point(69.28, 41.32, srid=4326),
    )
    start = timezone.now() + timedelta(hours=48)
    order = create_quote(
        user=owner, business_id=business.id, campaign_id=campaign.id,
        location_ids=[location.id, second_location.id],
        requested_start_at=start, requested_end_at=start + timedelta(hours=48),
        auto_renew=True,
    )
    attempt, _ = create_checkout(user=owner, order_id=order.id)
    attempt.status = "succeeded"
    attempt.save()
    settle_payment_attempt(attempt.id)

    agreement.refresh_from_db()
    assert sorted(agreement.locations_snapshot) == sorted(
        [str(location.id), str(second_location.id)]
    )
    assert agreement.charge_days == 2
    assert ActivityEvent.objects.filter(action="renewal.consent_refreshed").exists()
