from rest_framework import serializers

from .models import RenewalAgreement, RenewalAttempt


class RenewalAgreementSerializer(serializers.ModelSerializer):
    campaign_headline = serializers.CharField(source="campaign.headline", read_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)
    locations_count = serializers.SerializerMethodField()

    class Meta:
        model = RenewalAgreement
        fields = (
            "id", "business", "business_name", "campaign", "campaign_headline",
            "locations_snapshot", "locations_count", "charge_days", "duration_seconds",
            "status", "price_policy", "consent_at", "next_run_at", "created_at", "updated_at",
        )
        read_only_fields = fields

    def get_locations_count(self, obj) -> int:
        return len(obj.locations_snapshot)


class RenewalAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = RenewalAttempt
        fields = ("id", "agreement", "renewal_period_key", "order", "state", "attempted_at")


class RenewalEnableSerializer(serializers.Serializer):
    agreement_id = serializers.UUIDField()
