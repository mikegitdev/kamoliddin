from rest_framework import serializers

from .models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    location_name = serializers.CharField(source="location.name", read_only=True)

    class Meta:
        model = OrderItem
        fields = ("location", "location_name", "unit_rate_snapshot", "charge_days", "line_total")


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    campaign_headline = serializers.CharField(source="campaign.headline", read_only=True)
    campaign_status = serializers.CharField(
        source="campaign.review_status", read_only=True
    )
    business_name = serializers.CharField(source="business.name", read_only=True)

    class Meta:
        model = Order
        fields = (
            "id", "business", "business_name", "campaign", "campaign_headline",
            "campaign_status", "amount_total", "currency", "state", "quote_expires_at",
            "interval_start_at", "interval_end_at", "auto_renew",
            "items", "created_at", "updated_at",
        )
        read_only_fields = fields


class QuoteRequestSerializer(serializers.Serializer):
    business_id = serializers.UUIDField()
    campaign_id = serializers.UUIDField()
    location_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=100
    )
    requested_start_at = serializers.DateTimeField()
    requested_end_at = serializers.DateTimeField()
    auto_renew = serializers.BooleanField(default=False)


class CheckoutRequestSerializer(serializers.Serializer):
    return_url = serializers.URLField(required=False, allow_blank=True, default="")
