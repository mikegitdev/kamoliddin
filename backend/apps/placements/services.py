"""Placement state transitions (spec §7.3) and paid-entitlement activation.

Payment and moderation are separate gates (spec §7.2): a paid order whose
campaign is unapproved creates PENDING placements only; approval then moves
them to scheduled/active. Activation is idempotent.
"""
import logging

from django.db import transaction
from django.utils import timezone

from apps.billing.models import Order, compute_charge_days
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.moderation.models import ActivityEvent

from .models import FreeGrant, Placement

logger = logging.getLogger(__name__)


@transaction.atomic
def activate_order_entitlements(order: Order) -> list[Placement]:
    """Create placements for a PAID order — exactly once per (campaign,
    location, interval). Idempotent under retries and duplicate callbacks."""
    now = timezone.now()
    campaign = order.campaign
    if campaign.review_status != Campaign.ReviewStatus.APPROVED:
        initial_state = Placement.State.PENDING
    else:
        initial_state = (
            Placement.State.SCHEDULED
            if order.interval_start_at and order.interval_start_at > now
            else Placement.State.ACTIVE
        )

    placements = []
    for item in order.items.select_related("location"):
        placement, _created = Placement.objects.get_or_create(
            campaign=campaign,
            location=item.location,
            start_at=order.interval_start_at,
            defaults={
                "end_at": order.interval_end_at,
                "charge_days": item.charge_days,
                "source_type": Placement.SourceType.PAID,
                "state": initial_state,
                "actual_start_at": now if initial_state == Placement.State.ACTIVE else None,
            },
        )
        placements.append(placement)
    return placements


@transaction.atomic
def on_campaign_approved(campaign: Campaign) -> int:
    """Move pending placements of an approved campaign to scheduled/active.

    Late moderation (spec §6 [C]): if the requested interval already fully
    passed, shift it forward from now, preserving the charged duration."""
    from datetime import timedelta

    now = timezone.now()
    moved = 0
    for placement in campaign.placements.filter(state=Placement.State.PENDING).select_related(
        "campaign"
    ):
        # Late moderation (spec §6 [C]): the paid interval was never displayed,
        # so shift it to start now, preserving the charged duration in full.
        if placement.start_at <= now:
            placement.start_at = now
            placement.end_at = now + timedelta(days=placement.charge_days)
            placement.state = Placement.State.ACTIVE
            if placement.actual_start_at is None:
                placement.actual_start_at = now
        else:
            placement.state = Placement.State.SCHEDULED
        placement.save()
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
        raise ValueError("Only approved campaigns can receive free grants")
    if location.business_id != campaign.business_id:
        raise ValueError("Location does not belong to the campaign's business")
    now = timezone.now()
    charge_days = compute_charge_days(start_at, end_at)
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
    end; also expires stale draft quotes. Also exposed as a management command
    so dev works without a Celery worker."""
    now = timezone.now()
    activated = Placement.objects.filter(
        state=Placement.State.SCHEDULED, start_at__lte=now
    ).update(state=Placement.State.ACTIVE, actual_start_at=now)
    expired = Placement.objects.filter(state=Placement.State.ACTIVE, end_at__lte=now).update(
        state=Placement.State.EXPIRED, actual_end_at=now
    )
    quotes_expired = Order.objects.filter(
        state=Order.State.DRAFT_QUOTE, quote_expires_at__lt=now
    ).update(state=Order.State.EXPIRED)
    result = {"activated": activated, "expired": expired, "quotes_expired": quotes_expired}
    if any(result.values()):
        logger.info("placement refresh: %s", result)
    return result
