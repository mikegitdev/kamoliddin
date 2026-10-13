"""Automatic renewal engine (spec §8 — mandatory at launch).

Agreement lifecycle:
- A paid order with auto_renew=True creates one RenewalAgreement (idempotent).
- The worker charges the SAME approved content/banner/locations/duration via
  gateway.charge_recurring with a deterministic idempotency key.
- Exactly one successful charge per renewal period — enforced by the unique
  (agreement, renewal_period_key) constraint plus transactional locking.
- Failure sets ALERT (no unpaid grace: display stops at the paid-term end
  naturally, because eligibility is interval-based).
- Cancellation disables future attempts; already-paid time is untouched.
"""
import hashlib
import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.billing.models import Order, OrderItem, Tariff
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.moderation.models import ActivityEvent
from apps.payments.gateways import get_payment_gateway
from apps.payments.models import PaymentAttempt
from apps.placements.models import Placement
from apps.placements.services import CapacityExhausted, assert_capacity

from .models import RenewalAgreement, RenewalAttempt

logger = logging.getLogger(__name__)

# Charge this long before the paid-term boundary so display stays continuous.
RENEWAL_BUFFER = timedelta(hours=1)


def content_hash(campaign: Campaign) -> str:
    raw = (f"{campaign.id}:{campaign.review_version}:{campaign.headline}:"
           f"{campaign.body}:{campaign.banner_key}")
    return hashlib.sha256(raw.encode()).hexdigest()


@transaction.atomic
def ensure_agreement_for_order(order: Order) -> RenewalAgreement | None:
    """Create (once) or re-consent the renewal agreement consented to at quote time.

    Provider token truthfulness (ADR-0005): a token reference exists ONLY for
    the fake dev/test gateway. With an unverified real provider the agreement
    is created as PENDING_TOKEN with an empty token_ref — the worker never
    charges such agreements, so no garbage token ever reaches a real gateway.

    Re-consent (ADR-0003): a NEW paid order with auto_renew=True is the latest
    explicit consent — its locations/duration snapshot wins and re-activates a
    previously disabled/alerted agreement, with an audit event."""
    if not order.auto_renew or order.interval_start_at is None or order.interval_end_at is None:
        return None
    location_ids = sorted(order.items.values_list("location_id", flat=True))
    snapshot = [str(pk) for pk in location_ids]
    charge_days = max(order.items.values_list("charge_days", flat=True))
    duration_seconds = int(
        (order.interval_end_at - order.interval_start_at).total_seconds()
    )

    existing = RenewalAgreement.objects.select_for_update().filter(
        campaign=order.campaign
    ).first()
    if existing is not None:
        if existing.status == RenewalAgreement.Status.PENDING_TOKEN and not existing.token_ref:
            # Token still absent; keep awaiting, but refresh the consent snapshot.
            pass
        changed = (
            existing.locations_snapshot != snapshot
            or existing.charge_days != charge_days
            or existing.duration_seconds != duration_seconds
        )
        resumed = existing.status in (
            RenewalAgreement.Status.DISABLED,
            RenewalAgreement.Status.ALERT,
        )
        if changed or resumed:
            existing.locations_snapshot = snapshot
            existing.charge_days = charge_days
            existing.duration_seconds = duration_seconds
            existing.content_version_hash = content_hash(order.campaign)
            existing.consent_at = timezone.now()
            existing.next_run_at = order.interval_end_at - RENEWAL_BUFFER
            if existing.status != RenewalAgreement.Status.PENDING_TOKEN:
                existing.status = RenewalAgreement.Status.ACTIVE
            existing.save(update_fields=[
                "locations_snapshot", "charge_days", "duration_seconds",
                "content_version_hash", "consent_at", "next_run_at", "status",
                "updated_at",
            ])
            ActivityEvent.objects.create(
                action="renewal.consent_refreshed",
                entity="renewal_agreement",
                entity_id=str(existing.id),
                metadata={
                    "order": str(order.id), "locations": len(snapshot),
                    "snapshot_changed": changed, "resumed": resumed,
                },
            )
        return existing

    fake_provider = settings.PAYMENT_PROVIDER == "fake"
    agreement = RenewalAgreement.objects.create(
        business=order.business,
        campaign=order.campaign,
        locations_snapshot=snapshot,
        duration_seconds=duration_seconds,
        charge_days=charge_days,
        content_version_hash=content_hash(order.campaign),
        token_ref=f"fake-token-{order.campaign_id}" if fake_provider else "",
        consent_at=timezone.now(),
        price_policy="current_tariff",
        status=RenewalAgreement.Status.ACTIVE if fake_provider
        else RenewalAgreement.Status.PENDING_TOKEN,
        next_run_at=order.interval_end_at - RENEWAL_BUFFER,
    )
    ActivityEvent.objects.create(
        action="renewal.agreement_created",
        entity="renewal_agreement",
        entity_id=str(agreement.id),
        metadata={
            "order": str(order.id), "locations": len(snapshot),
            "status": agreement.status,
        },
    )
    return agreement


def _paid_term_boundary(agreement: RenewalAgreement):
    """Start of the next purchasable term = end of the current PAID exposure.
    Derived from placements (stable per term) — never from next_run_at, which
    shifts on retries and would mint a new period key (double-charge risk)."""
    last_end = (
        Placement.objects.filter(
            campaign=agreement.campaign, source_type=Placement.SourceType.PAID
        )
        .exclude(state=Placement.State.CANCELLED)
        .order_by("-end_at")
        .values_list("end_at", flat=True)
        .first()
    )
    if last_end is None:
        # Agreement implies a paid order; fallback keeps the worker safe anyway.
        return agreement.next_run_at + RENEWAL_BUFFER
    return last_end


class RenewalFailure(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def _check_and_charge(agreement: RenewalAgreement, attempt: RenewalAttempt, boundary) -> Order:
    """Gates (spec §8 step 2) then one authorized recurring charge."""
    campaign = agreement.campaign
    if campaign.review_status != Campaign.ReviewStatus.APPROVED:
        raise RenewalFailure("campaign_not_approved")
    if content_hash(campaign) != agreement.content_version_hash:
        raise RenewalFailure("content_changed_needs_re_review")

    locations = list(
        Location.objects.filter(
            pk__in=agreement.locations_snapshot,
            business=agreement.business,
            status=Location.Status.ACTIVE,
        )
    )
    if len(locations) != len(agreement.locations_snapshot):
        raise RenewalFailure("locations_inactive")

    term_end = boundary + timedelta(days=agreement.charge_days)
    for location in locations:
        # Shared capacity predicate (ADR-0003): advisory lock per location;
        # PENDING reservations count. The agreement's current term ends AT the
        # boundary, so the overlap filter never counts the campaign's own
        # expiring ads — no self-exclusion needed (stacking still costs a slot).
        try:
            assert_capacity(
                location,
                start_at=boundary,
                end_at=term_end,
                lock=True,
            )
        except CapacityExhausted:
            raise RenewalFailure(f"capacity_exhausted:{location.id}")

    tariff = Tariff.current()
    if tariff is None:
        raise RenewalFailure("no_active_tariff")

    total = tariff.amount_per_24h * agreement.charge_days * len(locations)
    order = Order.objects.create(
        business=agreement.business,
        campaign=campaign,
        amount_total=total,
        state=Order.State.AWAITING_PAYMENT,
        interval_start_at=boundary,
        interval_end_at=term_end,
        auto_renew=True,
    )
    for location in locations:
        OrderItem.objects.create(
            order=order,
            location=location,
            unit_rate_snapshot=tariff.amount_per_24h,
            charge_days=agreement.charge_days,
            line_total=tariff.amount_per_24h * agreement.charge_days,
        )
    attempt.order = order
    attempt.save(update_fields=["order"])

    # Deterministic provider idempotency: stable per agreement+term, so a rerun
    # after a hard crash cannot double-charge at the provider (spec §8 [R]).
    idem_str = f"renewal:{agreement.pk}:{boundary:%Y%m%dT%H%M}"
    idem_key = str(uuid.uuid5(uuid.NAMESPACE_URL, idem_str))
    gateway = get_payment_gateway(settings.PAYMENT_PROVIDER)
    result = gateway.charge_recurring(
        token_ref=agreement.token_ref,
        amount_minor=total,
        currency=order.currency,
        idempotency_key=idem_key,
    )
    payment, _payment_created = PaymentAttempt.objects.get_or_create(
        order=order,
        provider=gateway.slug,
        idempotency_key=idem_key,
        defaults={
            "provider_payment_id": result.provider_payment_id,
            "amount": total,
            "status": (
                PaymentAttempt.Status.SUCCEEDED
                if result.succeeded
                else PaymentAttempt.Status.FAILED
            ),
        },
    )
    if not result.succeeded:
        order.state = Order.State.FAILED
        order.save(update_fields=["state", "updated_at"])
        raise RenewalFailure("charge_declined")

    # settle marks the order PAID and activates entitlements idempotently;
    # pre-setting PAID here would make settle skip activation.
    from apps.payments.settlement import settle_payment_attempt

    settle_payment_attempt(payment.id)
    order.refresh_from_db()
    return order


def process_agreement(agreement: RenewalAgreement) -> dict:
    """One pass over a due agreement.

    Concurrency/idempotency: the period key derives from the paid-term boundary
    (stable), so two workers — or a worker rerunning after a crash — collide on
    the unique (agreement, renewal_period_key) constraint instead of charging
    twice. Failure states are recorded in a SEPARATE transaction so they survive
    the rollback of the main attempt."""
    with transaction.atomic():
        locked = (
            RenewalAgreement.objects.select_for_update()
            .filter(pk=agreement.pk)
            .select_related("campaign")
            .first()
        )
        if locked is None or locked.status != RenewalAgreement.Status.ACTIVE:
            if locked is not None and locked.status == RenewalAgreement.Status.PENDING_TOKEN:
                return {"agreement": str(agreement.id), "result": "skipped_pending_token"}
            return {"agreement": str(agreement.id), "result": "skipped_not_active"}
        if locked.next_run_at > timezone.now():
            return {"agreement": str(locked.id), "result": "skipped_not_due"}

    boundary = _paid_term_boundary(agreement)
    period_key = f"{boundary:%Y%m%dT%H%M}-{agreement.pk.hex[:8]}"

    try:
        with transaction.atomic():
            locked = (
                RenewalAgreement.objects.select_for_update()
                .filter(pk=agreement.pk)
                .first()
            )
            if locked is None or locked.status != RenewalAgreement.Status.ACTIVE:
                return {"agreement": str(agreement.id), "result": "skipped_not_active"}
            try:
                attempt = RenewalAttempt.objects.create(
                    agreement=locked, renewal_period_key=period_key
                )
            except IntegrityError:
                return {"agreement": str(locked.id), "period": period_key,
                        "result": "already_processed"}

            order = _check_and_charge(locked, attempt, boundary)

            attempt.state = RenewalAttempt.State.SUCCEEDED
            attempt.save(update_fields=["state"])
            interval_end = order.interval_end_at
            assert interval_end is not None
            locked.next_run_at = interval_end - RENEWAL_BUFFER
            locked.save(update_fields=["next_run_at", "updated_at"])
            ActivityEvent.objects.create(
                action="renewal.succeeded",
                entity="renewal_agreement",
                entity_id=str(locked.id),
                metadata={"period": period_key, "order": str(order.id),
                          "amount_minor": order.amount_total},
            )
            return {"agreement": str(locked.id), "period": period_key,
                    "result": "charged", "order": str(order.id)}
    except RenewalFailure as exc:
        # Main attempt rolled back (provider not charged); record durably.
        with transaction.atomic():
            attempt, _ = RenewalAttempt.objects.get_or_create(
                agreement=agreement, renewal_period_key=period_key,
                defaults={"state": RenewalAttempt.State.FAILED},
            )
            attempt.state = RenewalAttempt.State.FAILED
            attempt.save(update_fields=["state"])
            RenewalAgreement.objects.filter(pk=agreement.pk).update(
                status=RenewalAgreement.Status.ALERT
            )
            ActivityEvent.objects.create(
                action="renewal.failed", entity="renewal_agreement",
                entity_id=str(agreement.id),
                metadata={"reason": exc.reason, "period": period_key},
            )
        logger.warning("Renewal %s failed: %s", agreement.id, exc.reason)
        return {"agreement": str(agreement.id), "period": period_key,
                "result": f"failed:{exc.reason}"}
    except Exception as exc:
        # Provider outcome ambiguous (charged but DB failed): reconciliation,
        # never a blind retry (spec §8 step 4, §14).
        with transaction.atomic():
            attempt, _ = RenewalAttempt.objects.get_or_create(
                agreement=agreement, renewal_period_key=period_key,
                defaults={"state": RenewalAttempt.State.RECONCILIATION},
            )
            attempt.state = RenewalAttempt.State.RECONCILIATION
            attempt.save(update_fields=["state"])
            RenewalAgreement.objects.filter(pk=agreement.pk).update(
                status=RenewalAgreement.Status.ALERT
            )
        logger.exception("Renewal %s entered reconciliation", agreement.id)
        return {"agreement": str(agreement.id), "period": period_key,
                "result": f"reconciliation:{exc}"}


def run_due_renewals() -> list[dict]:
    now = timezone.now()
    due = RenewalAgreement.objects.filter(
        status=RenewalAgreement.Status.ACTIVE, next_run_at__lte=now
    )
    return [process_agreement(a) for a in due]


@transaction.atomic
def cancel_agreement(*, user, agreement_id) -> RenewalAgreement:
    agreement = (
        RenewalAgreement.objects.select_for_update()
        .filter(pk=agreement_id, business__owner=user)
        .first()
    )
    if agreement is None:
        raise LookupError("Renewal agreement not found")
    agreement.status = RenewalAgreement.Status.DISABLED
    agreement.save(update_fields=["status", "updated_at"])
    ActivityEvent.objects.create(
        action="renewal.cancelled",
        entity="renewal_agreement",
        entity_id=str(agreement.id),
    )
    return agreement


@transaction.atomic
def enable_agreement(*, user, agreement_id) -> RenewalAgreement:
    agreement = (
        RenewalAgreement.objects.select_for_update()
        .filter(pk=agreement_id, business__owner=user)
        .first()
    )
    if agreement is None:
        raise LookupError("Renewal agreement not found")
    if agreement.status == RenewalAgreement.Status.PENDING_TOKEN:
        # No verified provider token yet — enabling would promise a charge that
        # cannot happen (ADR-0005).
        raise ValueError(
            "Auto-renewal is not available yet: recurring payments are pending "
            "provider verification. Your paid advertising is unaffected."
        )
    if agreement.status == RenewalAgreement.Status.ACTIVE:
        return agreement
    agreement.status = RenewalAgreement.Status.ACTIVE
    agreement.save(update_fields=["status", "updated_at"])
    ActivityEvent.objects.create(
        action="renewal.enabled",
        entity="renewal_agreement",
        entity_id=str(agreement.id),
    )
    return agreement
