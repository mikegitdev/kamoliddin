from django.contrib import admin

from .models import FreeGrant, Placement


@admin.register(Placement)
class PlacementAdmin(admin.ModelAdmin):
    list_display = ("campaign", "location", "state", "source_type", "charge_days",
                    "start_at", "end_at")
    list_filter = ("state", "source_type")
    search_fields = ("campaign__headline", "location__name")


@admin.register(FreeGrant)
class FreeGrantAdmin(admin.ModelAdmin):
    list_display = ("campaign", "location", "start_at", "end_at", "admin", "created_at")
    search_fields = ("campaign__headline", "location__name")
