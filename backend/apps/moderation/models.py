import uuid

from django.conf import settings
from django.db import models


class ActivityEvent(models.Model):
    """Append-only administrative audit trail (spec §5, §11). Never edited or deleted."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="activity_events",
        null=True, blank=True,  # null = system action
    )
    action = models.CharField(max_length=100)   # e.g. campaign.approve, location.takedown
    entity = models.CharField(max_length=60)    # e.g. campaign, location, refund
    entity_id = models.CharField(max_length=64)
    metadata = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["entity", "entity_id"])]

    def __str__(self) -> str:
        return f"{self.action} {self.entity}:{self.entity_id}"


class PlatformSetting(models.Model):
    """Admin-editable runtime settings; seeded with max_active_ads_per_location = 5
    (spec §5, §12 PATCH /admin/settings/ad-limit)."""

    key = models.CharField(max_length=100, unique=True)
    value_json = models.JSONField()
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="setting_changes",
        null=True, blank=True,
    )
    changed_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.key


DEFAULT_SETTINGS = {
    "max_active_ads_per_location": 5,
    "map_bbox_max_area_deg2": 1.0,   # bbox guard for /public/locations (spec §12)
    "public_locations_max_limit": 200,
}
