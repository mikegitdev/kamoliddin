from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import Location


@admin.register(Location)
class LocationAdmin(GISModelAdmin):
    list_display = ("name", "business", "city", "status", "created_at")
    list_filter = ("status", "city")
    search_fields = ("name", "address", "business__name")
    readonly_fields = ("created_at", "updated_at")
    default_lon = 69.2401
    default_lat = 41.2995
    default_zoom = 11
