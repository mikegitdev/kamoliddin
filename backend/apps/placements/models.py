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


def promotion_active_q(now=None, prefix: str = "") -> Q:
    """SQL predicate: the placement's promotion tier is currently counting.
    Null window bounds mean the tier rides the placement interval itself
    (checkout-time add-on); recorded bounds bound a post-hoc purchase."""
    now = now or timezone.now()
    return (
        Q(**{f"{prefix}promotion_tier__isnull": False})
        & (
            Q(**{f"{prefix}promotion_started_at__isnull": True})
            | Q(**{f"{prefix}promotion_started_at__lte": now})
        )
        & (
            Q(**{f"{prefix}promotion_ends_at__isnull": True})
            | Q(**{f"{prefix}promotion_ends_at__gt": now})
        )
    )


class PromotionTier(models.TextChoices):
    """Paid visibility add-on on a placement (Joymee's subscription model:
    TOP pins the ad above organic results; RAISED lifts it into the second
    block). Tier is purchased at checkout, priced per 24h like the base rate,
    and lives exactly as long as the paid placement interval — no separate
    state machine to expire."""

    TOP = "top", "TOP (pinned above organic results)"
    RAISED = "raised", "RAISED (second promotion block)"


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
    # Paid placements link to the order that purchased them (ADR-0003):
    # exact refund/matching semantics regardless of late-moderation interval
    # shifts; grant placements stay null.
    order = models.ForeignKey(
        "billing.Order", on_delete=models.PROTECT, related_name="placements",
        null=True, blank=True,
    )
    start_at = models.DateTimeField()          # requested interval start
    end_at = models.DateTimeField()            # requested interval end
    actual_start_at = models.DateTimeField(null=True, blank=True)   # shifted on late moderation
    actual_end_at = models.DateTimeField(null=True, blank=True)     # preserves charged duration
    state = models.CharField(max_length=12, choices=State.choices, default=State.PENDING)
    source_type = models.CharField(max_length=8, choices=SourceType.choices,
                                   default=SourceType.PAID)
    charge_days = models.PositiveSmallIntegerField()  # ceil(duration/24h), >= 1 (spec §6)
    promotion_tier = models.CharField(
        max_length=8, choices=PromotionTier.choices, null=True, blank=True,
        help_text="Paid visibility add-on purchased with this placement "
                  "(Joymee-style TOP/RAISED); grants stay null.",
    )
    # Promotion window (post-hoc purchases only; null on both = the tier rides
    # the placement's own interval, i.e. it was bought at checkout time).
    # Joymee's countdown semantics without an expiry job: the tier counts only
    # while now is inside the effective window.
    promotion_started_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When a post-hoc promotion window started (settlement time).",
    )
    promotion_ends_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When a post-hoc promotion window ends (or was ended by refund).",
    )
    block_reason = models.CharField(
        max_length=40, blank=True, default="",
        help_text="Why a BLOCKED placement was blocked (e.g. capacity_conflict)",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["location", "state"]),
            models.Index(fields=["campaign", "state"]),
            models.Index(fields=["order"]),
        ]
        constraints = [
            # One placement per (order, location): checkout reservations are
            # idempotent under concurrent settlement (ADR-0003).
            models.UniqueConstraint(
                fields=["order", "location"],
                name="uniq_placement_order_location",
                condition=Q(order__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.campaign_id} @ {self.location_id} [{self.state}]"

    def promotion_active(self, now=None) -> bool:
        """Tier counts only inside the effective window: the placement's own
        interval when no window was recorded (checkout-time add-on), or the
        recorded [started, ends) window of a post-hoc purchase."""
        now = now or timezone.now()
        if not self.promotion_tier:
            return False
        if self.promotion_started_at and self.promotion_started_at > now:
            return False
        if self.promotion_ends_at and self.promotion_ends_at <= now:
            return False
        return True

    def promotion_rank(self, now=None) -> int:
        """2=TOP, 1=RAISED, 0=none — only while the window is live."""
        if not self.promotion_active(now):
            return 0
        tier = self.promotion_tier
        assert tier is not None  # promotion_active guarantees it
        if tier == PromotionTier.TOP:
            return 2
        if tier == PromotionTier.RAISED:
            return 1
        return 0


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
