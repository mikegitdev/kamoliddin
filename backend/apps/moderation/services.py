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


def submit_for_review(*, campaign: Campaign) -> None:
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
        actor=None,
        action="campaign.submit",
        entity="campaign",
        entity_id=str(campaign.id),
        metadata={"content_version": campaign.review_version,
                  "at": timezone.now().isoformat()},
    )
