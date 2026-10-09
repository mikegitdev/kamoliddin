import uuid

from django.db import models

from apps.billing.models import Order


class PaymentAttempt(models.Model):
    """One provider attempt for an order; retries are recorded, not overwritten
    (spec §5). A fully paid order activates entitlements exactly once."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="attempts")
    provider = models.CharField(max_length=30)  # click | fake | <fallback>
    provider_payment_id = models.CharField(max_length=200, blank=True, default="")
    idempotency_key = models.UUIDField(default=uuid.uuid4, unique=True)
    amount = models.BigIntegerField()  # minor units; verified against the order
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    response_digest = models.CharField(max_length=128, blank=True, default="",
                                       help_text="Hash of the last provider response")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "provider_payment_id"],
                condition=~models.Q(provider_payment_id=""),
                name="uniq_provider_payment_id",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.provider_payment_id or '-'} [{self.status}]"


class PaymentEvent(models.Model):
    """Raw provider callback record; deduplicated on (provider, event_id) (spec §12)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.CharField(max_length=30)
    event_id = models.CharField(max_length=200)
    payment_attempt = models.ForeignKey(
        PaymentAttempt, on_delete=models.PROTECT, related_name="events", null=True, blank=True
    )
    validated_payload_digest = models.CharField(max_length=128)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["provider", "event_id"], name="uniq_provider_event"),
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.event_id}"
