"""Pricing + orders (spec §6).

charge_days = max(1, ceil((end - start) / 86400s)) per location.
All money is integer minor units (tiyin), currency UZS. Quotes are calculated on
the server, snapshotted into OrderItem, and immutable once the order is paid.
"""
import uuid
from datetime import datetime

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.businesses.models import Business
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.placements.models import PromotionTier

CURRENCY_UZS = "UZS"
SECONDS_PER_DAY = 86_400


def compute_charge_days(start_at: datetime, end_at: datetime) -> int:
    """Whole 24-hour units billed for a requested interval; a 25h request bills 2 days."""
    if end_at <= start_at:
        raise ValueError("end_at must be after start_at")
    seconds = (end_at - start_at).total_seconds()
    return max(1, -(-int(seconds) // SECONDS_PER_DAY))  # ceil division


class Tariff(models.Model):
    """Date-effective uniform daily price per location (admin-editable only)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    currency = models.CharField(max_length=3, default=CURRENCY_UZS)
    amount_per_24h = models.BigIntegerField(help_text="Minor units (tiyin) per 24h per location")
    # Optional paid visibility add-ons (Joymee-style TOP/RAISED), priced per
    # 24h on top of the base rate. NULL = the tier is not offered in this
    # tariff period, so checkout cannot select it at all.
    amount_top_per_24h = models.BigIntegerField(
        null=True, blank=True, help_text="Minor units per 24h for the TOP add-on"
    )
    amount_raised_per_24h = models.BigIntegerField(
        null=True, blank=True, help_text="Minor units per 24h for the RAISED add-on"
    )
    valid_from = models.DateTimeField(default=timezone.now)
    valid_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-valid_from",)

    def __str__(self) -> str:
        return f"{self.amount_per_24h} {self.currency}/24h from {self.valid_from:%Y-%m-%d}"

    @classmethod
    def current(cls, at: datetime | None = None) -> "Tariff | None":
        at = at or timezone.now()
        return (
            cls.objects.filter(valid_from__lte=at)
            .filter(models.Q(valid_until__isnull=True) | models.Q(valid_until__gt=at))
            .first()
        )


class Order(models.Model):
    """One purchase. Server-generated totals; immutable once paid.

    kind=placement (default): buys display intervals at locations —
    checkout reserves capacity, settlement activates placements.
    kind=promotion: buys a Joymee-style TOP/RAISED window for ONE
    already-running placement (`promoted_placement`) — no capacity is
    consumed and settlement applies the tier+window instead of creating
    placements."""

    class State(models.TextChoices):
        DRAFT_QUOTE = "draft_quote", "Draft quote"
        AWAITING_PAYMENT = "awaiting_payment", "Awaiting payment"
        PAYMENT_PROCESSING = "payment_processing", "Payment processing"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired"

    class Kind(models.TextChoices):
        PLACEMENT = "placement", "Placement intervals"
        PROMOTION = "promotion", "Promotion of a running placement"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(Business, on_delete=models.PROTECT, related_name="orders")
    campaign = models.ForeignKey(Campaign, on_delete=models.PROTECT, related_name="orders")
    kind = models.CharField(max_length=12, choices=Kind.choices,
                            default=Kind.PLACEMENT)
    # Set only for kind=promotion: the running placement this order boosts.
    promoted_placement = models.ForeignKey(
        "placements.Placement", on_delete=models.PROTECT,
        related_name="promotion_orders", null=True, blank=True,
    )
    amount_total = models.BigIntegerField()  # minor units
    currency = models.CharField(max_length=3, default=CURRENCY_UZS)
    state = models.CharField(max_length=20, choices=State.choices, default=State.DRAFT_QUOTE)
    quote_expires_at = models.DateTimeField(null=True, blank=True)
    interval_start_at = models.DateTimeField(
        null=True, blank=True, help_text="Requested advertising interval start (quote snapshot)"
    )
    interval_end_at = models.DateTimeField(
        null=True, blank=True, help_text="Requested advertising interval end (quote snapshot)"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["business", "state"])]

    def __str__(self) -> str:
        return f"Order {self.id} [{self.state}]"


class OrderItem(models.Model):
    """Locked financial snapshot for one location line (spec §5)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="items")
    location = models.ForeignKey(Location, on_delete=models.PROTECT)
    unit_rate_snapshot = models.BigIntegerField(help_text="Tariff minor units at quote time")
    charge_days = models.PositiveSmallIntegerField()
    line_total = models.BigIntegerField()  # unit_rate_snapshot * charge_days
    # Promotion add-on snapshot (spec §6 immutability applies here too): the
    # tier chosen at quote time and its own locked line amount, so refunds and
    # audits read the exact paid promotion without re-deriving prices.
    promotion_tier = models.CharField(
        max_length=8, choices=PromotionTier.choices, null=True, blank=True
    )
    promotion_line_total = models.BigIntegerField(
        default=0, help_text="Locked promotion surcharge for this line (minor units)"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "location"], name="uniq_order_location"),
        ]

    def __str__(self) -> str:
        return f"{self.order_id} / {self.location_id} / {self.charge_days}d"


def promotion_price_per_24h(tariff: Tariff, tier: str) -> int | None:
    """Per-24h price of a promotion tier under `tariff`; None when the tier
    is not offered in this tariff period."""
    if tier == PromotionTier.TOP:
        return tariff.amount_top_per_24h
    if tier == PromotionTier.RAISED:
        return tariff.amount_raised_per_24h
    return None


def quote_order_lines(
    *,
    campaign: Campaign,
    locations: list[Location],
    start_at: datetime,
    end_at: datetime,
    promotion_tier: str | None = None,
) -> tuple[list[OrderItem], int, Tariff]:
    """Build (unsaved) order items from the current tariff, optionally with a
    Joymee-style promotion add-on applied to every line. The caller validates
    ownership, per-location capacity and interval conflicts transactionally
    (spec §6, §12)."""
    tariff = Tariff.current()
    if tariff is None:
        raise ValueError("No active tariff configured")
    if not locations:
        raise ValueError("At least one location is required")
    if any(loc.business_id != campaign.business_id for loc in locations):
        raise ValueError("All locations must belong to the campaign's business")

    promo_rate: int | None = None
    if promotion_tier:
        if promotion_tier not in PromotionTier.values:
            raise ValueError("Unknown promotion tier")
        promo_rate = promotion_price_per_24h(tariff, promotion_tier)
        if promo_rate is None:
            raise ValueError(f"Promotion tier {promotion_tier!r} is not priced "
                             "in the current tariff")

    days = compute_charge_days(start_at, end_at)
    items = [
        OrderItem(
            location=loc,
            unit_rate_snapshot=tariff.amount_per_24h,
            charge_days=days,
            line_total=tariff.amount_per_24h * days,
            promotion_tier=promotion_tier or None,
            promotion_line_total=(promo_rate * days) if promo_rate is not None else 0,
        )
        for loc in locations
    ]
    total = sum(item.line_total + item.promotion_line_total for item in items)
    return items, total, tariff


class Refund(models.Model):
    """Manual-review refund workflow (spec §7.2). Never erases payment records."""

    class State(models.TextChoices):
        REFUND_REQUESTED = "refund_requested", "Refund requested"
        ADMIN_REVIEW = "admin_review", "Admin review"
        PROVIDER_REFUND_PROCESSING = "provider_refund_processing", "Provider refund processing"
        REFUNDED = "refunded", "Refunded"
        REFUND_FAILED = "refund_failed", "Refund failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="refunds")
    amount = models.BigIntegerField()
    reason = models.TextField(blank=True, default="")
    state = models.CharField(max_length=30, choices=State.choices,
                             default=State.REFUND_REQUESTED)
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="processed_refunds",
        null=True, blank=True, limit_choices_to={"is_staff": True},
    )
    provider_ref = models.CharField(max_length=200, blank=True, default="")
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Refund {self.order_id} [{self.state}]"
