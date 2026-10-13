import uuid

from django.conf import settings
from django.db import models


class BusinessCategory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=64, unique=True)
    name_ru = models.CharField(max_length=120)
    name_uz = models.CharField(max_length=120)
    active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("sort_order", "name_ru")
        verbose_name_plural = "business categories"

    def __str__(self) -> str:
        return self.slug


class Business(models.Model):
    """Advertiser-owned business. Name is NOT proof of legal identity (spec §5).
    One current owner per business; soft-disable only, no hard deletes."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        UNDER_REVIEW = "under_review", "Under review"
        DISABLED = "disabled", "Disabled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="businesses"
    )
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True)
    category = models.ForeignKey(
        BusinessCategory, on_delete=models.PROTECT, related_name="businesses"
    )
    logo_key = models.CharField(max_length=200, blank=True, default="")  # storage object key
    description = models.TextField(blank=True, default="")
    phone = models.CharField(max_length=24, blank=True, default="")
    telegram = models.CharField(max_length=120, blank=True, default="")
    whatsapp = models.CharField(max_length=120, blank=True, default="")
    site = models.URLField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["owner"]), models.Index(fields=["status"])]

    def __str__(self) -> str:
        return self.name
