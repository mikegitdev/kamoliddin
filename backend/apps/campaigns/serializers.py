from rest_framework import serializers

from apps.businesses.models import Business

from .models import Campaign


class CampaignSerializer(serializers.ModelSerializer):
    business = serializers.SlugRelatedField(
        slug_field="id",
        queryset=Business.objects.none(),
    )
    business_name = serializers.CharField(source="business.name", read_only=True)
    banner_url = serializers.SerializerMethodField()

    class Meta:
        model = Campaign
        fields = (
            "id", "business", "business_name", "headline", "body", "banner_key",
            "banner_url", "review_status", "review_version", "created_at", "updated_at",
        )
        read_only_fields = ("id", "review_status", "review_version",
                            "created_at", "updated_at", "business_name")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            self.fields["business"].queryset = Business.objects.filter(owner=request.user)

    def get_banner_url(self, obj) -> str:
        return f"/media/{obj.banner_key}" if obj.banner_key else ""

    def validate_headline(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Headline cannot be empty")
        return value.strip()

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
