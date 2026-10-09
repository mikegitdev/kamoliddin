from django.contrib import admin

from .models import Business, BusinessCategory


@admin.register(BusinessCategory)
class BusinessCategoryAdmin(admin.ModelAdmin):
    list_display = ("slug", "name_ru", "name_uz", "active", "sort_order")
    list_editable = ("active", "sort_order")
    search_fields = ("slug", "name_ru", "name_uz")


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "category", "status", "created_at")
    list_filter = ("status", "category")
    search_fields = ("name", "slug", "owner__phone_e164")
    readonly_fields = ("created_at", "updated_at")
