"""Auto-renewal agreements and attempts (spec §8 — mandatory at launch).

Key invariants:
- Renewal re-publishes the SAME approved content, banner, frozen location set and
  paid duration; no content edits, no volume discounts.
- Exactly one successful charge per renewal period; enforced by the unique
  (agreement, renewal_period_key) constraint plus transactional locking.
- Failed renewal hides placement exactly at the paid-term end; no unpaid grace.
- Cancellation disables future attempts but never removes remaining paid time.
- token_ref is an opaque provider token reference — never card PAN/CVV.
"""
import uuid

from django.db import models

from apps.billing.models import Order
from apps.businesses.models import Business
from apps.campaigns.models import Campaign


class RenewalAgreement(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ALERT = "alert", "Alert (last charge failed)"
        DISABLED = "disabled", "Disabled (cancelled by advertiser)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        Business, on_delete=models.PROTECT, related_name="renewal_agreements"
    )
    campaign = models.ForeignKey(Campaign, on_delete=models.PROTECT,
                                 related_name="renewal_agreements")
    locations_snapshot = models.JSONField(help_text="Frozen location id list for renewal")
    duration_seconds = models.BigIntegerField()  # originally paid duration
    charge_days = models.PositiveSmallIntegerField()
    content_version_hash = models.CharField(
        max_length=64, help_text="Hash of approved content+banner; changes force re-review"
    )
    token_ref = models.CharField(max_length=200, help_text="Provider payment token reference")
    consent_at = models.DateTimeField()
    price_policy = models.CharField(
        max_length=20, default="current_tariff",
        help_text="current_tariff | locked_price — must be shown and consented to (spec §8 [O])",
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    next_run_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Renewal {self.campaign_id} [{self.status}]"


class RenewalAttempt(models.Model):
    class State(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        RECONCILIATION = "reconciliation", "Ambiguous — reconciliation required"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agreement = models.ForeignKey(RenewalAgreement, on_delete=models.PROTECT,
                                  related_name="attempts")
    renewal_period_key = models.CharField(max_length=40,
                                          help_text="e.g. 2026-W43; one charge per period")
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="renewal_attempts",
                              null=True, blank=True)
    state = models.CharField(max_length=16, choices=State.choices, default=State.PENDING)
    attempted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["agreement", "renewal_period_key"],
                                    name="uniq_agreement_period"),
        ]

    def __str__(self) -> str:
        return f"{self.agreement_id} {self.renewal_period_key} [{self.state}]"
