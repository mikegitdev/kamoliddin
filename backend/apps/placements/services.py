"""Placement state transitions (spec §7.3), paid-entitlement activation, and
the per-location capacity engine (spec §14 "sixth ad cannot activate", ADR-0003).

Payment and moderation are separate gates (spec §7.2): a paid order whose
campaign is unapproved keeps PENDING placements only; approval then moves
them to scheduled/active. Activation is idempotent.

Capacity model (ADR-0003):
- Capacity usage counts PENDING + SCHEDULED + ACTIVE placements. PENDING
  counts because checkout RESERVES capacity: `create_checkout` creates the
  order's placements as PENDING before any money moves, so an unpaid basket
  cannot silently squat forever — reservations are released when the order
  expires, fails, or is refunded.
- Decisions serialize per location via a Postgres advisory transaction lock,
  closing the two-concurrent-checkouts race (acceptance #13).
- Settlement promotes the order's reservations; if capacity vanished in
  between (race, admin cap change), the losing placement is BLOCKED with
  `block_reason` and an audit event — a paid order never silently overbooks
  and public eligibility never counts BLOCKED.
"""
import logging
import uuid
from datetime import datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.billing.models import Order, compute_charge_days
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.moderation.models import ActivityEvent, PlatformSetting

from .models import FreeGrant, Placement

logger = logging.getLogger(__name__)

# States that occupy a capacity slot at a location (ADR-0003): a checked-out
# order's PENDING reservation holds its slot until it expires/fails/refunds.
CAPACITY_STATES = (Placement.State.PENDING, Placement.State.SCHEDULED, Placement.State.ACTIVE)

# Grace past quote expiry before an AWAITING_PAYMENT order expires and its
# reservations are released (in-flight provider callbacks must still settle).
AWAITING_PAYMENT_GRACE = timedelta(hours=2)


class CapacityExhausted(Exception):
    """Location has no free simultaneous-ad slot for the requested interval."""

    def __init__(self, *, location, max_ads: int, usage: int):
        self.location = location
        self.max_ads = max_ads
        self.usage = usage
        super().__init__(
            f"Location {location.name!r} reached the limit of {max_ads} "
            f"simultaneous active ads for this interval (usage={usage})"
        )


class GrantError(ValueError):
    """Free grant refused; `code` is the machine-readable error.code."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


def max_active_ads() -> int:
    setting = PlatformSetting.objects.filter(key="max_active_ads_per_location").first()
    if setting is None:
        return settings.MAX_ACTIVE_ADS_PER_LOCATION
    return int(setting.value_json)


def _location_lock_key(location_id) -> int:
    """Stable 63-bit key for pg_advisory_xact_lock from the location UUID."""
    return uuid.UUID(str(location_id)).int & 0x7FFF_FFFF_FFFF_FFFF


def _advisory_lock_location(location_id) -> None:
    """Serialize capacity decisions for one location within this transaction."""
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [_location_lock_key(location_id)])


def capacity_usage(location: Location, *, start_at, end_at, exclude_id=None) -> int:
    """Placements occupying a capacity slot overlapping [start_at, end_at).

    No own-campaign exclusion: the overlap filter already gives extensions a
    free hand (a new term starts at the old term's end — zero overlap), while
    stacking a second simultaneous ad of the SAME campaign at a location must
    consume a slot like anyone else's (ADR-0003). `exclude_id` leaves out only
    the placement being re-checked (its old interval must not count against
    its own new one)."""
    qs = Placement.objects.filter(
        location=location,
        state__in=CAPACITY_STATES,
        start_at__lt=end_at,
        end_at__gt=start_at,
    )
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    return qs.count()


def assert_capacity(
    location: Location,
    *,
    start_at,
    end_at,
    lock: bool = False,
    exclude_id=None,
) -> int:
    """Raise CapacityExhausted if `location` has no free slot for the interval.

    With lock=True, takes the per-location advisory lock first so concurrent
    checkouts serialize their decision (acceptance #13)."""
    if lock:
        _advisory_lock_location(location.id)
    usage = capacity_usage(location, start_at=start_at, end_at=end_at, exclude_id=exclude_id)
    limit = max_active_ads()
    if usage >= limit:
        raise CapacityExhausted(location=location, max_ads=limit, usage=usage)
    return usage


def order_placements(order: Order):
    return Placement.objects.filter(order=order)


def _order_interval(order: Order) -> tuple[datetime, datetime]:
    """Non-None (start, end) for orders that purchase intervals (mypy narrow)."""
    start, end = order.interval_start_at, order.interval_end_at
    assert start is not None and end is not None
    return start, end


@transaction.atomic
def reserve_order_capacity(order: Order) -> list[Placement]:
    """Checkout-time reservation (ADR-0003): advisory-lock each location,
    verify capacity, create PENDING placements linked to the order.

    Called before the provider session is created — no money has moved, so
    exhaustion simply refuses checkout. Idempotent per order; the
    (order, location) unique constraint backstops concurrent double-checkout.

    Promotion orders (kind=promotion) buy a visibility window for an EXISTING
    placement: they never reserve slots or create placements — the boost rides
    a slot the advertiser already paid for.
    """
    if order.kind == Order.Kind.PROMOTION:
        return list(order_placements(order))  # empty: promotion orders own none
    existing = list(order_placements(order).select_related("location"))
    if existing:
        return existing
    campaign = order.campaign
    start_at, end_at = _order_interval(order)
    for item in order.items.select_related("location"):
        assert_capacity(
            item.location,
            start_at=start_at,
            end_at=end_at,
            lock=True,
        )
        Placement.objects.create(
            campaign=campaign,
            location=item.location,
            order=order,
            start_at=start_at,
            end_at=end_at,
            charge_days=item.charge_days,
            promotion_tier=item.promotion_tier,
            source_type=Placement.SourceType.PAID,
            state=Placement.State.PENDING,
        )
    return list(order_placements(order).select_related("location"))


def release_order_reservations(order: Order) -> int:
    """Cancel an order's PENDING reservations (expiry/failure/refund).

    Already-live paid exposure is never touched here — refunds cancel live
    placements explicitly via `cancel_order_placements`."""
    return Placement.objects.filter(order=order, state=Placement.State.PENDING).update(
        state=Placement.State.CANCELLED
    )


def cancel_order_placements(order: Order) -> int:
    """Refund path: stop every not-yet-expired placement purchased by `order`
    (PENDING/SCHEDULED/ACTIVE). Historical rows and accounting stay intact.

    For kind=promotion orders the paid promotion window is ENDED now — the
    placement itself keeps running on its original purchase."""
    if order.kind == Order.Kind.PROMOTION:
        now = timezone.now()
        assert order.promoted_placement_id is not None  # promotion orders carry it
        placement = (
            Placement.objects.select_for_update()
            .filter(pk=order.promoted_placement_id)
            .first()
        )
        if placement is None or not placement.promotion_ends_at:
            return 0
        if placement.promotion_ends_at <= now:
            return 0  # already expired — nothing to end
        placement.promotion_ends_at = now
        placement.save(update_fields=["promotion_ends_at", "updated_at"])
        ActivityEvent.objects.create(
            action="promotion.ended",
            entity="placement",
            entity_id=str(placement.id),
            metadata={"order": str(order.id), "reason": "refund"},
        )
        return 1
    return Placement.objects.filter(
        order=order,
        state__in=[Placement.State.PENDING, Placement.State.SCHEDULED, Placement.State.ACTIVE],
    ).update(state=Placement.State.CANCELLED)


def _record_capacity_conflict(order: Order, placement: Placement, exc: CapacityExhausted) -> None:
    ActivityEvent.objects.create(
        action="placement.capacity_conflict",
        entity="placement",
        entity_id=str(placement.id),
        metadata={
            "order": str(order.id),
            "location": str(placement.location_id),
            "max_ads": exc.max_ads,
            "usage": exc.usage,
            "resolution": "blocked_pending_admin_refund",
        },
    )
    logger.error(
        "Capacity conflict on order %s at location %s: blocked for admin review",
        order.id, placement.location_id,
    )


def _promote(placement: Placement, *, now) -> None:
    """PENDING -> SCHEDULED/ACTIVE in place (spec §6 [C] late start: shift the
    whole interval forward, preserving the charged duration).

    The shifted interval is time the checkout reservation never covered, so
    it is capacity-checked again under the location lock. On conflict the
    placement is BLOCKED for the admin refund queue, exactly as at activation
    (ADR-0003): a late start must not overbook a location that filled up in
    the meantime. Callers save `block_reason` along with the state."""
    if placement.start_at <= now:
        start_at = now
        end_at = now + timedelta(days=placement.charge_days)
        try:
            assert_capacity(
                placement.location,
                start_at=start_at,
                end_at=end_at,
                lock=True,
                exclude_id=placement.pk,
            )
        except CapacityExhausted as exc:
            order = placement.order
            assert order is not None  # only paid reservations are promoted
            placement.state = Placement.State.BLOCKED
            placement.block_reason = "capacity_conflict"
            _record_capacity_conflict(order, placement, exc)
            return
        placement.start_at = start_at
        placement.end_at = end_at
        placement.state = Placement.State.ACTIVE
        if placement.actual_start_at is None:
            placement.actual_start_at = now
    else:
        placement.state = Placement.State.SCHEDULED


def _apply_promotion_window(order: Order, *, now) -> Placement:
    """Settlement of a kind=promotion order: stamp tier + [now, now+days) on
    the promoted placement. Idempotent — a duplicate webhook re-stamps the
    same window derived from the paid order's snapshot, never extends it.
    Refunds end the window via `cancel_order_placements`; records are never
    erased."""
    assert order.promoted_placement_id is not None  # promotion orders carry it
    placement = (
        Placement.objects.select_for_update()
        .select_related("campaign")
        .filter(pk=order.promoted_placement_id)
        .first()
    )
    if placement is None:  # PROTECT FK keeps the row; defensive only
        raise LookupError("promoted placement vanished")
    item = order.items.first()
    tier = item.promotion_tier if item else None
    days = item.charge_days if item else 0
    if not tier or days <= 0:
        raise ValueError("promotion order has no purchasable tier/days snapshot")
    placement.promotion_tier = tier
    placement.promotion_started_at = now
    placement.promotion_ends_at = now + timedelta(days=days)
    placement.save(update_fields=[
        "promotion_tier", "promotion_started_at", "promotion_ends_at", "updated_at",
    ])
    ends_at = placement.promotion_ends_at
    assert ends_at is not None
    ActivityEvent.objects.create(
        action="promotion.applied",
        entity="placement",
        entity_id=str(placement.id),
        metadata={
            "order": str(order.id), "tier": tier, "days": days,
            "until": ends_at.isoformat(),
        },
    )
    return placement


@transaction.atomic
def activate_order_entitlements(order: Order) -> list[Placement]:
    """Apply a PAID order to its placements — exactly once per order, idempotent
    under retries and duplicate callbacks.

    Promotion orders (kind=promotion) apply their tier and a fresh promotion
    window to `order.promoted_placement` instead — no capacity is involved.

    The order's checkout reservations are promoted; orders without
    reservations (legacy rows) get placements created here under the
    capacity lock. If capacity vanished in between, the placement is BLOCKED
    with an audit event for the admin refund queue — never silently overbooked."""
    now = timezone.now()
    if order.kind == Order.Kind.PROMOTION:
        return [_apply_promotion_window(order, now=now)]
    campaign = order.campaign
    approved = campaign.review_status == Campaign.ReviewStatus.APPROVED
    start_at, end_at = _order_interval(order)
    placements = []
    # Location order = advisory-lock order: concurrent multi-location
    # activations/approvals always lock in the same sequence (no deadlock).
    for item in order.items.select_related("location").order_by("location_id"):
        placement = (
            Placement.objects.select_for_update()
            .filter(order=order, location=item.location)
            .first()
        )
        # No placement yet (legacy orders), or a reservation that was
        # released (CANCELLED) before the payment actually succeeded — a late
        # webhook for real money must still deliver its entitlement, so the
        # released row is resurrected under a fresh capacity check.
        needs_slot = placement is None or placement.state == Placement.State.CANCELLED
        if needs_slot:
            try:
                assert_capacity(
                    item.location,
                    start_at=start_at,
                    end_at=end_at,
                    lock=True,
                )
            except CapacityExhausted as exc:
                if placement is None:
                    placement = Placement.objects.create(
                        campaign=campaign,
                        location=item.location,
                        order=order,
                        start_at=start_at,
                        end_at=end_at,
                        charge_days=item.charge_days,
                        source_type=Placement.SourceType.PAID,
                        state=Placement.State.BLOCKED,
                        block_reason="capacity_conflict",
                    )
                else:
                    placement.state = Placement.State.BLOCKED
                    placement.block_reason = "capacity_conflict"
                    placement.save(update_fields=["state", "block_reason", "updated_at"])
                _record_capacity_conflict(order, placement, exc)
                placements.append(placement)
                continue
            if placement is None:
                placement = Placement.objects.create(
                    campaign=campaign,
                    location=item.location,
                    order=order,
                    start_at=start_at,
                    end_at=end_at,
                    charge_days=item.charge_days,
                    source_type=Placement.SourceType.PAID,
                    state=Placement.State.PENDING,
                )
            else:  # resurrect the released reservation
                placement.state = Placement.State.PENDING
                placement.start_at = start_at
                placement.end_at = end_at
                placement.save(update_fields=["state", "start_at", "end_at", "updated_at"])

        assert placement is not None  # needs_slot covered the None case
        if placement.state == Placement.State.PENDING and approved:
            _promote(placement, now=now)
            placement.save(update_fields=[
                "state", "start_at", "end_at", "actual_start_at", "block_reason", "updated_at",
            ])
        placements.append(placement)
    return placements


@transaction.atomic
def on_campaign_approved(campaign: Campaign) -> int:
    """Move PENDING placements of an approved campaign to scheduled/active.

    Late moderation (spec §6 [C]): if the requested interval already fully
    passed, shift it forward from now, preserving the charged duration in full.

    Only placements whose order is PAID are promoted: PENDING reservations of
    unpaid orders (checked out but not yet settled) must not become public
    exposure (ADR-0003)."""
    now = timezone.now()
    moved = 0
    for placement in (
        campaign.placements.filter(state=Placement.State.PENDING, order__state=Order.State.PAID)
        .select_for_update()
        .select_related("campaign")
        .order_by("location_id")  # advisory-lock order, as in activation
    ):
        _promote(placement, now=now)
        placement.save(update_fields=[
            "state", "start_at", "end_at", "actual_start_at", "block_reason", "updated_at",
        ])
        moved += 1
    return moved


@transaction.atomic
def issue_free_grant(
    *,
    staff,
    campaign: Campaign,
    location: Location,
    start_at,
    end_at,
    reason: str,
) -> FreeGrant:
    """Zero-charge entitlement issued by an admin (spec §7.4). Moderation rules
    still apply: only an APPROVED campaign can be granted. The grant creates a
    placement with source_type=grant ranked identically with paid ones; the
    financial amount is exactly zero."""
    if campaign.review_status != Campaign.ReviewStatus.APPROVED:
        raise GrantError(
            "Only approved campaigns can receive free grants", code="campaign_not_approved"
        )
    if location.business_id != campaign.business_id:
        raise GrantError(
            "Location does not belong to the campaign's business", code="location_mismatch"
        )
    now = timezone.now()
    charge_days = compute_charge_days(start_at, end_at)
    # Grants occupy a slot like paid placements: the per-location cap holds.
    try:
        assert_capacity(location, start_at=start_at, end_at=end_at, lock=True)
    except CapacityExhausted as exc:
        raise GrantError(str(exc), code="capacity_exhausted") from exc
    state = Placement.State.SCHEDULED if start_at > now else Placement.State.ACTIVE
    Placement.objects.get_or_create(
        campaign=campaign,
        location=location,
        start_at=start_at,
        defaults={
            "end_at": end_at,
            "charge_days": charge_days,
            "source_type": Placement.SourceType.GRANT,
            "state": state,
            "actual_start_at": now if state == Placement.State.ACTIVE else None,
        },
    )
    grant = FreeGrant.objects.create(
        business=campaign.business,
        campaign=campaign,
        location=location,
        start_at=start_at,
        end_at=end_at,
        reason=reason,
        admin=staff,
    )
    ActivityEvent.objects.create(
        actor=staff,
        action="grant.issued",
        entity="campaign",
        entity_id=str(campaign.id),
        metadata={"location": str(location.id), "grant": str(grant.id),
                  "start": start_at.isoformat(), "end": end_at.isoformat()},
    )
    return grant


def refresh_states() -> dict[str, int]:
    """Periodic transition pass: scheduled->active at start, active->expired at
    end; expires stale quotes and releases their capacity reservations; also
    expires long-stuck awaiting-payment orders. Exposed as a management command
    so dev works without a Celery worker."""
    now = timezone.now()
    activated = Placement.objects.filter(
        state=Placement.State.SCHEDULED, start_at__lte=now
    ).update(state=Placement.State.ACTIVE, actual_start_at=now)
    expired = Placement.objects.filter(state=Placement.State.ACTIVE, end_at__lte=now).update(
        state=Placement.State.EXPIRED, actual_end_at=now
    )

    released = 0
    expired_orders = 0
    stale_orders = list(
        Order.objects.filter(
            state__in=[Order.State.DRAFT_QUOTE, Order.State.AWAITING_PAYMENT],
            quote_expires_at__lt=now - AWAITING_PAYMENT_GRACE,
        )
    )
    for order in stale_orders:
        released += release_order_reservations(order)
        order.state = Order.State.EXPIRED
        order.save(update_fields=["state", "updated_at"])
        expired_orders += 1

    result = {
        "activated": activated,
        "expired": expired,
        "orders_expired": expired_orders,
        "reservations_released": released,
    }
    if any(result.values()):
        logger.info("placement refresh: %s", result)
    return result
