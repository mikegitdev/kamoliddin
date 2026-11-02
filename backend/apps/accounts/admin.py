from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import OTPChallenge, PhoneChangeRecord, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("-created_at",)
    list_display = ("phone_e164", "is_active", "is_staff", "deleted_at", "created_at")
    list_filter = ("is_staff", "is_active", "is_superuser")
    search_fields = ("phone_e164",)
    fieldsets = (
        (None, {"fields": ("phone_e164", "password")}),
        ("Flags", {"fields": ("is_active", "is_staff", "is_superuser", "groups",
                              "user_permissions")}),
        ("Dates", {"fields": ("last_login", "created_at", "updated_at", "deleted_at")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("phone_e164", "password1", "password2")}),
    )
    readonly_fields = ("created_at", "updated_at", "deleted_at")


@admin.register(PhoneChangeRecord)
class PhoneChangeRecordAdmin(admin.ModelAdmin):
    """Audit trail for recovery identity checks (docs/runbooks/account-recovery.md).
    Append-only: staff may inspect, never edit."""

    list_display = ("user", "old_phone_e164", "new_phone_e164",
                    "old_phone_blocked_until", "created_at")
    search_fields = ("old_phone_e164", "new_phone_e164", "user__phone_e164")
    readonly_fields = [f.name for f in PhoneChangeRecord._meta.fields]
    actions = None


@admin.register(OTPChallenge)
class OTPChallengeAdmin(admin.ModelAdmin):
    """Append-only challenge inspection. No plaintext phone is stored on the
    row — search by typing the phone number; the query is hashed to
    phone_hash server-side (same digest the OTP service uses)."""

    list_display = ("purpose", "attempts", "expires_at", "consumed_at", "created_at")
    list_filter = ("purpose",)
    readonly_fields = [f.name for f in OTPChallenge._meta.fields]  # append-only; never editable
    actions = None

    def get_search_results(self, request, queryset, search_term):
        from apps.accounts.services import _hash, normalize_phone

        term = search_term.strip()
        if term:
            try:
                term = normalize_phone(term)
            except Exception:
                return queryset.none(), False
            queryset = queryset.filter(phone_hash=_hash(term))
            return queryset, False
        return super().get_search_results(request, queryset, search_term)
