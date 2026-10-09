from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import OTPChallenge, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("-created_at",)
    list_display = ("phone_e164", "is_active", "is_staff", "created_at")
    list_filter = ("is_staff", "is_active", "is_superuser")
    search_fields = ("phone_e164",)
    fieldsets = (
        (None, {"fields": ("phone_e164", "password")}),
        ("Flags", {"fields": ("is_active", "is_staff", "is_superuser", "groups",
                              "user_permissions")}),
        ("Dates", {"fields": ("last_login", "created_at", "updated_at")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("phone_e164", "password1", "password2")}),
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(OTPChallenge)
class OTPChallengeAdmin(admin.ModelAdmin):
    list_display = ("phone_e164", "purpose", "attempts", "expires_at", "consumed_at",
                    "created_at")
    list_filter = ("purpose",)
    search_fields = ("phone_e164",)
    readonly_fields = [f.name for f in OTPChallenge._meta.fields]  # append-only; never editable
    actions = None
