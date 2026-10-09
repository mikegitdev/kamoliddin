import uuid

from django.contrib.gis.db import models as gis_models
from django.contrib.postgres.indexes import GistIndex
from django.db import models

from apps.businesses.models import Business


class Location(models.Model):
    """A business branch point on the map (spec §5).

    Owner-entered address text and coordinates stay independent from any map
    provider (spec §10). Risk-flagged locations can be suppressed from
    advertising without touching sibling branches (spec §14).
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        UNDER_REVIEW = "under_review", "Under review"
        DISABLED = "disabled", "Disabled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(Business, on_delete=models.PROTECT, related_name="locations")
    name = models.CharField(max_length=200)
    address = models.CharField(max_length=300)
    city = models.CharField(max_length=100, default="Tashkent")
    point = gis_models.PointField(srid=4326, geography=True)  # GiST index via Meta
    phone = models.CharField(max_length=24, blank=True, default="")
    telegram = models.CharField(max_length=120, blank=True, default="")
    whatsapp = models.CharField(max_length=120, blank=True, default="")
    hours = models.JSONField(blank=True, default=dict)  # e.g. {"mon": ["09:00", "21:00"], ...}
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    risk_flags = models.JSONField(blank=True, default=list)  # e.g. ["duplicate_claim"]
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["business"]),
            GistIndex(fields=["point"]),
        ]

    def __str__(self) -> str:
        return f"{self.business.name} — {self.name}"
