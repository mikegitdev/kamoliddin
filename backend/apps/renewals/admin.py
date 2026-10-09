from django.contrib import admin

from .models import RenewalAgreement, RenewalAttempt


@admin.register(RenewalAgreement)
class RenewalAgreementAdmin(admin.ModelAdmin):
    list_display = ("campaign", "status", "charge_days", "next_run_at", "consent_at")
    list_filter = ("status",)
    search_fields = ("campaign__headline",)


@admin.register(RenewalAttempt)
class RenewalAttemptAdmin(admin.ModelAdmin):
    list_display = ("agreement", "renewal_period_key", "state", "attempted_at")
    list_filter = ("state",)
    actions = None
