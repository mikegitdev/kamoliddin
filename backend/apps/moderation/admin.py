from django.contrib import admin
from django.contrib.admin import SimpleListFilter

from apps.campaigns.models import Campaign, CampaignReview
from apps.moderation.models import ActivityEvent, PlatformSetting

from .services import approve_campaign, reject_campaign


class PendingReviewFilter(SimpleListFilter):
    title = "review queue"
    parameter_name = "queue"

    def lookups(self, request, model_admin):
        return (("pending", "Awaiting review"),)

    def queryset(self, request, queryset):
        if self.value() == "pending":
            return queryset.filter(review_status__in=["submitted", "under_review"])
        return queryset


@admin.register(Campaign)
class CampaignAdmin(admin.ModelAdmin):
    list_display = ("headline", "business", "review_status", "review_version", "created_at")
    list_filter = ("review_status", PendingReviewFilter, "business__category")
    search_fields = ("headline", "business__name", "business__owner__phone_e164")
    readonly_fields = ("created_at", "updated_at")
    actions = ["action_approve", "action_reject"]

    @admin.action(description="Approve selected campaigns (current version)")
    def action_approve(self, request, queryset):
        for campaign in queryset:
            approve_campaign(campaign=campaign, reviewer=request.user)

    @admin.action(description="Reject selected campaigns")
    def action_reject(self, request, queryset):
        for campaign in queryset:
            reject_campaign(
                campaign=campaign, reviewer=request.user,
                reason="Rejected via admin action; see campaign page for detail.",
            )


@admin.register(CampaignReview)
class CampaignReviewAdmin(admin.ModelAdmin):
    list_display = ("campaign", "content_version", "decision", "reviewer", "created_at")
    list_filter = ("decision",)
    search_fields = ("campaign__headline",)
    readonly_fields = [f.name for f in CampaignReview._meta.fields]  # immutable records
    actions = None


@admin.register(ActivityEvent)
class ActivityEventAdmin(admin.ModelAdmin):
    list_display = ("action", "entity", "entity_id", "actor", "created_at")
    list_filter = ("action", "entity")
    search_fields = ("entity_id",)
    readonly_fields = [f.name for f in ActivityEvent._meta.fields]
    actions = None


@admin.register(PlatformSetting)
class PlatformSettingAdmin(admin.ModelAdmin):
    list_display = ("key", "value_json", "changed_by", "changed_at")

    def save_model(self, request, obj, form, change):
        obj.changed_by = request.user
        super().save_model(request, obj, form, change)

    def get_changeform_initial_data(self, request):
        return {}
