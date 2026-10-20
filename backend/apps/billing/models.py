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
    """One purchase of placements. Server-generated totals; immutable once paid."""

    class State(models.TextChoices):
        DRAFT_QUOTE = "draft_quote", "Draft quote"
        AWAITING_PAYMENT = "awaiting_payment", "Awaiting payment"
        PAYMENT_PROCESSING = "payment_processing", "Payment processing"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(Business, on_delete=models.PROTECT, related_name="orders")
    campaign = models.ForeignKey(Campaign, on_delete=models.PROTECT, related_name="orders")
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

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "location"], name="uniq_order_location"),
        ]

    def __str__(self) -> str:
        return f"{self.order_id} / {self.location_id} / {self.charge_days}d"


def quote_order_lines(
    *,
    campaign: Campaign,
    locations: list[Location],
    start_at: datetime,
    end_at: datetime,
) -> tuple[list[OrderItem], int, Tariff]:
    """Build (unsaved) order items from the current tariff. The caller validates
    ownership, per-location capacity and interval conflicts transactionally
    (spec §6, §12)."""
    tariff = Tariff.current()
    if tariff is None:
        raise ValueError("No active tariff configured")
    if not locations:
        raise ValueError("At least one location is required")
    if any(loc.business_id != campaign.business_id for loc in locations):
        raise ValueError("All locations must belong to the campaign's business")

    days = compute_charge_days(start_at, end_at)
    items = [
        OrderItem(
            location=loc,
            unit_rate_snapshot=tariff.amount_per_24h,
            charge_days=days,
            line_total=tariff.amount_per_24h * days,
        )
        for loc in locations
    ]
    total = sum(item.line_total for item in items)
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
