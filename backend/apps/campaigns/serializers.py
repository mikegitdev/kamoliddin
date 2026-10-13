from rest_framework import serializers

from apps.businesses.models import Business

from .models import Campaign, CampaignReview


class CampaignReviewSerializer(serializers.ModelSerializer):
    """Read-only moderation decisions shown to the advertiser (spec §5):
    immutable rows, no reviewer identity exposed."""

    class Meta:
        model = CampaignReview
        fields = ("id", "decision", "reason", "content_version", "created_at")
        read_only_fields = fields

class CampaignSerializer(serializers.ModelSerializer):
    business = serializers.SlugRelatedField(
        slug_field="id",
        queryset=Business.objects.none(),
    )
    business_name = serializers.CharField(source="business.name", read_only=True)
    banner_url = serializers.SerializerMethodField()
    # Publication status must stay separate from review_status (spec §7):
    # an approved campaign is NOT necessarily live. Populated by a queryset
    # annotation; unannotated instances (create/submit responses) report 0.
    active_placements_count = serializers.SerializerMethodField()

    class Meta:
        model = Campaign
        fields = (
            "id", "business", "business_name", "headline", "body", "banner_key",
            "banner_url", "review_status", "review_version", "active_placements_count",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "review_status", "review_version",
                            "active_placements_count", "created_at", "updated_at",
                            "business_name")

    def __init__(self, *args: object, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            self.fields["business"].queryset = Business.objects.filter(owner=request.user)

    def get_banner_url(self, obj) -> str:
        return f"/media/{obj.banner_key}" if obj.banner_key else ""

    def get_active_placements_count(self, obj) -> int:
        return getattr(obj, "active_placements_count", 0) or 0

    def validate_headline(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Headline cannot be empty")
        return value.strip()

    def validate(self, attrs):
        # Business reassignment is blocked (spec §14): placements are keyed to
        # the original business's locations, and a moved campaign would keep its
        # approval without re-review. Create a new campaign instead.
        if self.instance is not None:
            new_business = attrs.get("business")
            if new_business is not None and new_business != self.instance.business:
                raise serializers.ValidationError(
                    {"business": "Campaign cannot move to another business after creation; "
                                 "create a new campaign instead."}
                )
            attrs.pop("business", None)  # same value — drop, never rewritten
        return attrs

    # Content edits after approval force a re-review (spec §7.1 [R]):
    # approved + meaningful change -> submitted with a bumped review_version.
    CONTENT_FIELDS = ("headline", "body", "banner_key")

    def update(self, instance, validated_data):
        locked = instance.review_status in (
            Campaign.ReviewStatus.SUBMITTED,
            Campaign.ReviewStatus.UNDER_REVIEW,
            Campaign.ReviewStatus.SUSPENDED,
        )
        if locked:
            raise serializers.ValidationError(
                {"review_status": "Campaign is locked while under review"}
            )
        content_changed = any(field in validated_data for field in self.CONTENT_FIELDS)
        if instance.review_status == Campaign.ReviewStatus.APPROVED and content_changed:
            validated_data["review_version"] = instance.review_version + 1
            validated_data["review_status"] = Campaign.ReviewStatus.SUBMITTED
        return super().update(instance, validated_data)
