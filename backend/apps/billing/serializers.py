from rest_framework import serializers

from apps.payments.models import PaymentAttempt

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
            "interval_start_at", "interval_end_at",
            "items", "created_at", "updated_at",
        )
        read_only_fields = fields


class QuoteSerializer(OrderSerializer):
    """Quote response: the draft order plus its id under the quote alias."""

    quote_id = serializers.UUIDField(source="id", read_only=True)

    class Meta(OrderSerializer.Meta):
        fields = OrderSerializer.Meta.fields + ("quote_id",)  # type: ignore[assignment]


class CheckoutResponseSerializer(serializers.Serializer):
    order_id = serializers.UUIDField(read_only=True)
    provider = serializers.CharField(read_only=True)
    provider_payment_id = serializers.CharField(read_only=True)
    amount_minor = serializers.IntegerField(read_only=True)
    currency = serializers.CharField(read_only=True)
    redirect_url = serializers.CharField(read_only=True)
    order_state = serializers.CharField(read_only=True)


class RefundRequestResultSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    state = serializers.CharField(read_only=True)
    amount = serializers.IntegerField(read_only=True)


class PaymentAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentAttempt
        fields = ("id", "provider", "provider_payment_id", "amount", "status",
                  "created_at")
        read_only_fields = fields


class OrderDetailSerializer(OrderSerializer):
    """Detail payload: adds the payment timeline and refund state (spec §5)."""

    attempts = PaymentAttemptSerializer(many=True, read_only=True)
    refund = serializers.SerializerMethodField()

    class Meta(OrderSerializer.Meta):
        fields = OrderSerializer.Meta.fields + ("attempts", "refund")  # type: ignore[assignment]

    def get_refund(self, obj) -> dict | None:
        refund = obj.refunds.order_by("-created_at").first()
        if refund is None:
            return None
        return {"state": refund.state, "amount": refund.amount,
                "reason": refund.reason, "created_at": refund.created_at}


class QuoteRequestSerializer(serializers.Serializer):
    business_id = serializers.UUIDField()
    campaign_id = serializers.UUIDField()
    location_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=100
    )
    requested_start_at = serializers.DateTimeField()
    requested_end_at = serializers.DateTimeField()


class CheckoutRequestSerializer(serializers.Serializer):
    return_url = serializers.URLField(required=False, allow_blank=True, default="")
