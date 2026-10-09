"""Staff-only admin REST API (spec §12 admin block). Django Admin remains the
primary moderation UI; these endpoints serve the same operations over REST.

- POST /admin/campaigns/{id}/review   approve|reject
- POST /admin/grants                  issue zero-charge placement grant
- GET  /admin/refunds                 refund queue
- POST /admin/refunds/{id}/process    approve|reject refund
- PATCH /admin/settings/ad-limit      max simultaneous ads per location
"""
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import OrderItem, Refund
from apps.billing.services import RefundError, process_refund
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.moderation.models import ActivityEvent, PlatformSetting
from apps.moderation.services import ModerationError, approve_campaign, reject_campaign
from apps.placements.services import issue_free_grant


class IsAdminUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


class QueueCampaignSerializer(serializers.ModelSerializer):
    """Campaign awaiting review, with the context a moderator needs (spec §12)."""

    business_name = serializers.CharField(source="business.name", read_only=True)
    owner_phone = serializers.CharField(source="business.owner.phone_e164", read_only=True)
    banner_url = serializers.SerializerMethodField()
    locations = serializers.SerializerMethodField()

    class Meta:
        model = Campaign
        fields = ("id", "headline", "body", "banner_url", "review_status",
                  "review_version", "business_name", "owner_phone", "locations",
                  "updated_at")

    def get_banner_url(self, obj) -> str:
        return f"/media/{obj.banner_key}" if obj.banner_key else ""

    def get_locations(self, obj) -> list[str]:
        return list(
            OrderItem.objects.filter(order__campaign=obj)
            .values_list("location__name", flat=True)
            .distinct()
        )


class ReviewQueueView(ListAPIView):
    """GET /admin/review-queue — campaigns submitted/under_review, oldest first."""

    serializer_class = QueueCampaignSerializer
    permission_classes = [IsAdminUser]
    pagination_class = None
    queryset = Campaign.objects.select_related("business", "business__owner").filter(
        review_status__in=(Campaign.ReviewStatus.SUBMITTED, Campaign.ReviewStatus.UNDER_REVIEW)
    ).order_by("updated_at")


class ReviewSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approve", "reject"])
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class CampaignReviewView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Approve/reject a campaign version",
                   request=ReviewSerializer)
    def post(self, request, id):
        serializer = ReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        campaign = Campaign.objects.filter(pk=id).first()
        if campaign is None:
            return Response(
                {"error": {"code": "not_found", "message": "Campaign not found", "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            if serializer.validated_data["decision"] == "approve":
                approve_campaign(campaign=campaign, reviewer=request.user)
            else:
                reject_campaign(
                    campaign=campaign, reviewer=request.user,
                    reason=serializer.validated_data["reason"] or "Rejected via admin API",
                )
        except ModerationError as exc:
            return Response(
                {"error": {"code": "invalid_transition", "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"id": str(campaign.id),
                         "review_status": campaign.review_status,
                         "review_version": campaign.review_version})


class GrantSerializer(serializers.Serializer):
    campaign_id = serializers.UUIDField()
    location_id = serializers.UUIDField()
    start_at = serializers.DateTimeField()
    end_at = serializers.DateTimeField()
    reason = serializers.CharField()


class GrantView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Issue a zero-charge placement grant",
                   request=GrantSerializer)
    def post(self, request):
        serializer = GrantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        campaign = Campaign.objects.filter(pk=data["campaign_id"]).first()
        location = Location.objects.filter(pk=data["location_id"]).first()
        if campaign is None or location is None:
            return Response(
                {"error": {"code": "not_found", "message": "Campaign or location not found",
                           "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            grant = issue_free_grant(
                staff=request.user, campaign=campaign, location=location,
                start_at=data["start_at"], end_at=data["end_at"], reason=data["reason"],
            )
        except ValueError as exc:
            return Response(
                {"error": {"code": "validation_error", "message": str(exc), "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"id": str(grant.id)}, status=status.HTTP_201_CREATED)

    @extend_schema(tags=["Admin"], summary="Options for the grant form")
    def get(self, request):
        campaigns = Campaign.objects.filter(
            review_status=Campaign.ReviewStatus.APPROVED
        ).order_by("-updated_at")[:100]
        locations = Location.objects.select_related("business").order_by("name")[:500]
        return Response({
            "campaigns": [
                {"id": str(c.id), "headline": c.headline,
                 "business_name": c.business.name}
                for c in campaigns
            ],
            "locations": [
                {"id": str(loc.id), "name": loc.name, "business_name": loc.business.name}
                for loc in locations
            ],
        })


class RefundSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order.id", read_only=True)
    campaign_headline = serializers.CharField(
        source="order.campaign.headline", read_only=True
    )
    business_name = serializers.CharField(source="order.business.name", read_only=True)

    class Meta:
        model = Refund
        fields = ("id", "order", "order_number", "campaign_headline", "business_name",
                  "amount", "reason", "state", "provider_ref", "operator",
                  "completed_at", "created_at")


class RefundListView(ListAPIView):
    serializer_class = RefundSerializer
    permission_classes = [IsAdminUser]
    pagination_class = None
    queryset = Refund.objects.select_related(
        "order", "order__campaign", "order__business", "operator"
    ).order_by("-created_at")


class RefundProcessSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approve", "reject"])
    provider_ref = serializers.CharField(required=False, allow_blank=True, default="")
    amount = serializers.IntegerField(required=False, min_value=0)


class RefundProcessView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Manually process a refund request",
                   request=RefundProcessSerializer)
    def post(self, request, id):
        serializer = RefundProcessSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            refund = process_refund(
                staff=request.user,
                refund_id=id,
                decision=serializer.validated_data["decision"],
                provider_ref=serializer.validated_data["provider_ref"],
                amount=serializer.validated_data.get("amount"),
            )
        except RefundError as exc:
            return Response(
                {"error": {"code": "refund_error", "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(RefundSerializer(refund).data)


class AdLimitSerializer(serializers.Serializer):
    value = serializers.IntegerField(min_value=1, max_value=50)


class AdLimitView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Current max simultaneous ads per location")
    def get(self, request):
        setting = PlatformSetting.objects.filter(key="max_active_ads_per_location").first()
        return Response({"key": "max_active_ads_per_location",
                         "value": setting.value_json if setting else 5})

    @extend_schema(tags=["Admin"], summary="Change max simultaneous ads per location",
                   request=AdLimitSerializer)
    def patch(self, request):
        serializer = AdLimitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        value = serializer.validated_data["value"]
        setting, _ = PlatformSetting.objects.update_or_create(
            key="max_active_ads_per_location", defaults={"value_json": value}
        )
        setting.changed_by = request.user
        setting.save()
        ActivityEvent.objects.create(
            actor=request.user, action="setting.ad_limit_changed",
            entity="platform_setting", entity_id="max_active_ads_per_location",
            metadata={"value": value},
        )
        return Response({"key": setting.key, "value": setting.value_json})
