import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.businesses.models import Business
from apps.campaigns.models import Campaign
from apps.locations.models import Location


def eligible_now_q(now=None, prefix: str = "") -> Q:
    """Full public eligibility filter (spec §7.2): never trust `state` alone —
    payment + approval + interval + active location/business all checked.

    `prefix` adapts the paths to the traversal context: "" filters Placement
    directly, "placements__" annotates/filters from Location."""
    now = now or timezone.now()
    return Q(
        **{
            f"{prefix}state__in": ["scheduled", "active"],
            f"{prefix}start_at__lte": now,
            f"{prefix}end_at__gt": now,
            f"{prefix}campaign__review_status": Campaign.ReviewStatus.APPROVED,
            f"{prefix}location__status": Location.Status.ACTIVE,
            f"{prefix}campaign__business__status": Business.Status.ACTIVE,
        }
    )


class Placement(models.Model):
    """Joins one campaign to one location for one paid/granted interval (spec §4).

    States (spec §7.3): pending -> scheduled -> active -> expired; abnormal blocked,
    cancelled. Public visibility requires the full eligibility check (business +
    location not suspended, campaign approved for current version, paid or granted,
    inside interval, capacity free) — never trust `state` alone. Same-business
    membership is enforced transactionally at creation time.
    """

    class State(models.TextChoices):
        PENDING = "pending", "Pending payment/approval"
        SCHEDULED = "scheduled", "Scheduled"
        ACTIVE = "active", "Active"
        EXPIRED = "expired", "Expired"
        BLOCKED = "blocked", "Blocked (risk/ban)"
        CANCELLED = "cancelled", "Cancelled"

    class SourceType(models.TextChoices):
        PAID = "paid", "Paid"
        GRANT = "grant", "Free grant"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(Campaign, on_delete=models.PROTECT, related_name="placements")
    location = models.ForeignKey(Location, on_delete=models.PROTECT, related_name="placements")
    start_at = models.DateTimeField()          # requested interval start
    end_at = models.DateTimeField()            # requested interval end
    actual_start_at = models.DateTimeField(null=True, blank=True)   # shifted on late moderation
    actual_end_at = models.DateTimeField(null=True, blank=True)     # preserves charged duration
    state = models.CharField(max_length=12, choices=State.choices, default=State.PENDING)
    source_type = models.CharField(max_length=8, choices=SourceType.choices,
                                   default=SourceType.PAID)
    charge_days = models.PositiveSmallIntegerField()  # ceil(duration/24h), >= 1 (spec §6)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["location", "state"]),
            models.Index(fields=["campaign", "state"]),
        ]

    def __str__(self) -> str:
        return f"{self.campaign_id} @ {self.location_id} [{self.state}]"


class FreeGrant(models.Model):
    """Zero-charge entitlement issued by an admin (spec §7.4). Not a payment.
    Moderation rules still apply; grants rank identically with paid placements."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(Business, on_delete=models.PROTECT, related_name="grants")
    campaign = models.ForeignKey(Campaign, on_delete=models.PROTECT, related_name="grants")
    location = models.ForeignKey(Location, on_delete=models.PROTECT, related_name="grants")
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    reason = models.TextField()
    admin = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="issued_grants",
        limit_choices_to={"is_staff": True},
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Grant {self.campaign_id} @ {self.location_id}"
