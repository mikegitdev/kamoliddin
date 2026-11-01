"""Moderation service: campaign review state transitions (spec §7.1).

Every decision appends an immutable CampaignReview row and an ActivityEvent
audit entry. Approval never publishes by itself — public visibility requires
valid active placements (separate gate, spec §7.2).
"""
from django.db import transaction
from django.utils import timezone

from apps.campaigns.models import Campaign, CampaignReview
from apps.moderation.models import ActivityEvent


class ModerationError(Exception):
    pass


@transaction.atomic
def approve_campaign(*, campaign: Campaign, reviewer) -> CampaignReview:
    if campaign.review_status not in (
        Campaign.ReviewStatus.SUBMITTED,
        Campaign.ReviewStatus.UNDER_REVIEW,
    ):
        raise ModerationError(
            f"Cannot approve campaign in status {campaign.review_status!r}"
        )
    campaign.review_status = Campaign.ReviewStatus.APPROVED
    campaign.save(update_fields=["review_status", "updated_at"])
    review = CampaignReview.objects.create(
        campaign=campaign,
        content_version=campaign.review_version,
        reviewer=reviewer,
        decision=CampaignReview.Decision.APPROVED,
    )
    ActivityEvent.objects.create(
        actor=reviewer,
        action="campaign.approve",
        entity="campaign",
        entity_id=str(campaign.id),
        metadata={"content_version": campaign.review_version},
    )
    # Separate gate (spec §7.2): approval activates already-paid placements.
    from apps.placements.services import on_campaign_approved

    moved = on_campaign_approved(campaign)
    if moved:
        ActivityEvent.objects.create(
            actor=None,
            action="placement.activated_by_moderation",
            entity="campaign",
            entity_id=str(campaign.id),
            metadata={"placements": moved},
        )
    return review


@transaction.atomic
def reject_campaign(*, campaign: Campaign, reviewer, reason: str) -> CampaignReview:
    if campaign.review_status not in (
        Campaign.ReviewStatus.SUBMITTED,
        Campaign.ReviewStatus.UNDER_REVIEW,
        Campaign.ReviewStatus.APPROVED,  # takedown of already-published content
    ):
        raise ModerationError(
            f"Cannot reject campaign in status {campaign.review_status!r}"
        )
    was_approved = campaign.review_status == Campaign.ReviewStatus.APPROVED
    campaign.review_status = Campaign.ReviewStatus.REJECTED
    campaign.save(update_fields=["review_status", "updated_at"])
    review = CampaignReview.objects.create(
        campaign=campaign,
        content_version=campaign.review_version,
        reviewer=reviewer,
        decision=CampaignReview.Decision.REJECTED,
        reason=reason,
    )
    ActivityEvent.objects.create(
        actor=reviewer,
        action="campaign.reject" if not was_approved else "campaign.takedown",
        entity="campaign",
        entity_id=str(campaign.id),
        metadata={"content_version": campaign.review_version, "reason": reason},
    )
    return review


def submit_for_review(*, campaign: Campaign, actor=None) -> None:
    """draft/rejected -> submitted; bumps review_version when resubmitting edits."""
    if campaign.review_status not in (
        Campaign.ReviewStatus.DRAFT,
        Campaign.ReviewStatus.REJECTED,
    ):
        raise ModerationError(
            f"Cannot submit campaign in status {campaign.review_status!r}"
        )
    if campaign.review_status == Campaign.ReviewStatus.REJECTED:
        campaign.review_version += 1  # corrected content = new review target
    campaign.review_status = Campaign.ReviewStatus.SUBMITTED
    campaign.save(update_fields=["review_status", "review_version", "updated_at"])
    ActivityEvent.objects.create(
        actor=actor,
        action="campaign.submit",
        entity="campaign",
        entity_id=str(campaign.id),
        metadata={"content_version": campaign.review_version,
                  "at": timezone.now().isoformat()},
    )


@transaction.atomic
def suspend_campaign(*, campaign: Campaign, staff, reason: str) -> None:
    """Admin takedown (spec §7.1): approved -> suspended. Public visibility is
    computed live (approved-only), so a suspend hides every placement at once."""
    if campaign.review_status != Campaign.ReviewStatus.APPROVED:
        raise ModerationError(
            f"Cannot suspend campaign in status {campaign.review_status!r}"
        )
    campaign.review_status = Campaign.ReviewStatus.SUSPENDED
    campaign.save(update_fields=["review_status", "updated_at"])
    ActivityEvent.objects.create(
        actor=staff, action="campaign.suspend", entity="campaign",
        entity_id=str(campaign.id), metadata={"reason": reason},
    )


@transaction.atomic
def unsuspend_campaign(*, campaign: Campaign, staff, reason: str = "") -> None:
    if campaign.review_status != Campaign.ReviewStatus.SUSPENDED:
        raise ModerationError(
            f"Cannot unsuspend campaign in status {campaign.review_status!r}"
        )
    campaign.review_status = Campaign.ReviewStatus.APPROVED
    campaign.save(update_fields=["review_status", "updated_at"])
    ActivityEvent.objects.create(
        actor=staff, action="campaign.unsuspend", entity="campaign",
        entity_id=str(campaign.id), metadata={"reason": reason} if reason else {},
    )


@transaction.atomic
def set_business_status(*, business, staff, status: str, reason: str) -> None:
    """Disable/enable a business: disabling hides all its placements via the
    live eligibility filter (business__status=active) — spec §7.2."""
    if status not in {"active", "disabled"}:
        raise ModerationError(f"Unsupported status {status!r}")
    business.status = status
    business.save(update_fields=["status", "updated_at"])
    ActivityEvent.objects.create(
        actor=staff, action=f"business.{status}", entity="business",
        entity_id=str(business.id), metadata={"reason": reason},
    )


@transaction.atomic
def set_business_verified(*, business, staff, verified: bool, reason: str) -> None:
    """Award/remove the staff trust badge (Joymee's blue check). Display-only
    signal: it never changes eligibility — a disabled business stays hidden
    regardless of the badge, and the badge survives disable/enable cycles."""
    if business.is_verified == verified:
        raise ModerationError(
            f"Business is already {'verified' if verified else 'not verified'}"
        )
    business.is_verified = verified
    business.save(update_fields=["is_verified", "updated_at"])
    ActivityEvent.objects.create(
        actor=staff,
        action="business.verified" if verified else "business.unverified",
        entity="business",
        entity_id=str(business.id),
        metadata={"reason": reason},
    )


@transaction.atomic
def set_location_status(*, location, staff, status: str, reason: str) -> None:
    """Disable/enable one branch: the live eligibility filter
    (location__status=active) hides its placements. Sibling branches are
    untouched (spec §14)."""
    if status not in {"active", "disabled"}:
        raise ModerationError(f"Unsupported status {status!r}")
    location.status = status
    location.save(update_fields=["status", "updated_at"])
    ActivityEvent.objects.create(
        actor=staff, action=f"location.{status}", entity="location",
        entity_id=str(location.id), metadata={"reason": reason},
    )


@transaction.atomic
def set_user_blocked(*, user, staff, blocked: bool, reason: str) -> None:
    """Block/unblock an advertiser's login. `is_active=False` rejects OTP
    login and voids live sessions (auth backends treat inactive users as
    anonymous). Staff accounts and deleted accounts are out of scope: staff
    management stays in Django Admin, deletion is irreversible by design."""
    if user.is_staff:
        raise ModerationError("Staff accounts are managed in Django Admin")
    if user.deleted_at:
        raise ModerationError("Deleted accounts cannot be changed")
    if user.is_active != blocked:
        raise ModerationError(
            "User is already blocked" if blocked else "User is not blocked"
        )
    user.is_active = not blocked
    user.save(update_fields=["is_active", "updated_at"])
    ActivityEvent.objects.create(
        actor=staff, action="user.block" if blocked else "user.unblock",
        entity="user", entity_id=str(user.id), metadata={"reason": reason},
    )


# block_reason marker for staff takedowns — distinct from the settlement-time
# `capacity_conflict`, which belongs to the refund queue and is never unblocked.
ADMIN_BLOCK_REASON = "admin_takedown"


@transaction.atomic
def block_placement(*, placement_id, staff, reason: str):
    """Take one live/scheduled placement down (state -> BLOCKED). BLOCKED is
    excluded from public eligibility and frees its capacity slot. No money
    moves: refunds stay a separate, owner-initiated flow."""
    from apps.placements.models import Placement

    placement = Placement.objects.select_for_update().filter(pk=placement_id).first()
    if placement is None:
        raise ModerationError("Placement not found")
    if placement.state not in (Placement.State.SCHEDULED, Placement.State.ACTIVE):
        raise ModerationError(f"Cannot block placement in state {placement.state!r}")
    previous = placement.state
    placement.state = Placement.State.BLOCKED
    placement.block_reason = ADMIN_BLOCK_REASON
    placement.save(update_fields=["state", "block_reason", "updated_at"])
    ActivityEvent.objects.create(
        actor=staff, action="placement.block", entity="placement",
        entity_id=str(placement.id),
        metadata={"reason": reason, "previous_state": previous},
    )
    return placement


@transaction.atomic
def unblock_placement(*, placement_id, staff, reason: str):
    """Restore a staff-blocked placement into its original interval (not
    extended — the takedown time is not credited back). Its slot was freed
    while blocked, so capacity is re-checked under the per-location lock; a
    refunded order's placement is never resurrected."""
    from apps.billing.models import Refund
    from apps.placements.models import Placement
    from apps.placements.services import CapacityExhausted, assert_capacity

    placement = (
        Placement.objects.select_for_update()
        .select_related("location").filter(pk=placement_id).first()
    )
    if placement is None:
        raise ModerationError("Placement not found")
    if (placement.state != Placement.State.BLOCKED
            or placement.block_reason != ADMIN_BLOCK_REASON):
        raise ModerationError("Only staff-blocked placements can be unblocked")
    if placement.order_id and Refund.objects.filter(
        order_id=placement.order_id,
        state__in=[Refund.State.PROVIDER_REFUND_PROCESSING, Refund.State.REFUNDED],
    ).exists():
        raise ModerationError("The order of this placement was refunded")

    now = timezone.now()
    if placement.end_at <= now:
        placement.state = Placement.State.EXPIRED
        placement.actual_end_at = placement.actual_end_at or now
    else:
        try:
            assert_capacity(
                placement.location,
                start_at=max(placement.start_at, now),
                end_at=placement.end_at,
                lock=True,
            )
        except CapacityExhausted as exc:
            raise ModerationError(str(exc)) from exc
        if placement.start_at <= now:
            placement.state = Placement.State.ACTIVE
            placement.actual_start_at = placement.actual_start_at or now
        else:
            placement.state = Placement.State.SCHEDULED
    placement.block_reason = ""
    placement.save(update_fields=[
        "state", "block_reason", "actual_start_at", "actual_end_at", "updated_at",
    ])
    ActivityEvent.objects.create(
        actor=staff, action="placement.unblock", entity="placement",
        entity_id=str(placement.id),
        metadata={"reason": reason, "restored_state": placement.state},
    )
    return placement
