import uuid

from django.conf import settings
from django.db import models

from apps.businesses.models import Business


class Campaign(models.Model):
    """Shared ad copy + exactly one banner (spec §4, §11).

    Content lifecycle (spec §7.1): draft -> submitted -> under_review -> approved |
    rejected; rejected -> editable -> submitted (new content_version); approved ->
    published only while valid placements are active. `review_version` is bumped on
    every meaningful content edit after approval, forcing re-review.
    """

    class ReviewStatus(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        SUSPENDED = "suspended", "Suspended (admin takedown)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(Business, on_delete=models.PROTECT, related_name="campaigns")
    headline = models.CharField(max_length=200)
    body = models.TextField(blank=True, default="")
    banner_key = models.CharField(max_length=200)  # exactly one banner (storage object key)
    review_status = models.CharField(
        max_length=20, choices=ReviewStatus.choices, default=ReviewStatus.DRAFT
    )
    review_version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["business", "review_status"])]

    def __str__(self) -> str:
        return f"{self.headline} ({self.review_status})"


class CampaignEvent(models.Model):
    """Anonymous engagement counter row for a public ad (Joymee borrow #2).

    Only the kind and timestamp are stored — no visitor identity, IP or
    user agent — so advertisers get counts without any personal data.
    """

    class Kind(models.TextChoices):
        VIEW = "view", "Ad opened"
        CONTACT = "contact", "Contact or directions clicked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["campaign", "kind"])]

    def __str__(self) -> str:
        return f"{self.kind} {self.campaign_id}"


class CampaignOutcome(models.Model):
    """Post-campaign outcome survey (Joymee's "were you able to sell?" loop,
    borrow #8): asked once, after every placement of the campaign has ended.

    The answer is product telemetry for pricing/placement decisions — never
    public, never money-relevant. One row per campaign, immutable once given
    (re-asking would only measure regret, not outcomes)."""

    class Answer(models.TextChoices):
        BROUGHT_CUSTOMERS = "brought_customers", "The ad brought customers"
        OTHER_CHANNEL = "other_channel", "Customers came via another channel"
        NO_EFFECT = "no_effect", "No noticeable effect"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.OneToOneField(
        Campaign, on_delete=models.PROTECT, related_name="outcome"
    )
    answer = models.CharField(max_length=20, choices=Answer.choices)
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.answer} {self.campaign_id}"


class CampaignReview(models.Model):
    """Immutable moderation decision record (spec §5). Never updated, only appended."""

    class Decision(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(Campaign, on_delete=models.PROTECT, related_name="reviews")
    content_version = models.PositiveIntegerField()
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="campaign_reviews",
        limit_choices_to={"is_staff": True},
    )
    decision = models.CharField(max_length=10, choices=Decision.choices)
    reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.decision} v{self.content_version} @ {self.created_at:%Y-%m-%d %H:%M}"
