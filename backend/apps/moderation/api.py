"""Staff-only admin REST API (spec §12 admin block). Django Admin remains the
primary moderation UI; these endpoints serve the same operations over REST.

- POST /admin/campaigns/{id}/review   approve|reject
- POST /admin/campaigns/{id}/suspend   takedown (approved -> suspended)
- POST /admin/campaigns/{id}/unsuspend restore
- GET  /admin/campaigns               searchable oversight list
- GET  /admin/reports                 complaints queue; POST .../{id}/process
- POST /admin/grants                  issue zero-charge placement grant
- GET  /admin/refunds                 refund queue
- POST /admin/refunds/{id}/process    approve|reject refund
- GET  /admin/orders                  recent orders (oversight)
- GET  /admin/activity                audit trail tail
- GET  /admin/overview                dashboard counters
- PATCH /admin/settings/ad-limit      max simultaneous ads per location
"""
from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import Order, OrderItem, Refund
from apps.billing.services import RefundError, process_refund
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.moderation.models import ActivityEvent, PlatformSetting, Report
from apps.moderation.services import (
    ModerationError,
    approve_campaign,
    reject_campaign,
    suspend_campaign,
    unsuspend_campaign,
)
from apps.placements.models import FreeGrant, Placement
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

    @extend_schema(tags=["Admin"], summary="Grant form options and recent grants")
    def get(self, request):
        campaigns = Campaign.objects.filter(
            review_status=Campaign.ReviewStatus.APPROVED
        ).order_by("-updated_at")[:100]
        locations = Location.objects.select_related("business").order_by("name")[:500]
        grants = (
            FreeGrant.objects.select_related(
                "campaign", "location", "location__business", "admin"
            ).order_by("-created_at")[:100]
        )
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
            "grants": [
                {
                    "id": str(g.id),
                    "campaign_headline": g.campaign.headline,
                    "business_name": g.location.business.name,
                    "location_name": g.location.name,
                    "start_at": g.start_at,
                    "end_at": g.end_at,
                    "reason": g.reason,
                    "admin_phone": g.admin.phone_e164 if g.admin else None,
                    "created_at": g.created_at,
                }
                for g in grants
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


class ReportSerializer(serializers.ModelSerializer):
    resolved_by_phone = serializers.CharField(
        source="resolved_by.phone_e164", read_only=True, default=None
    )

    class Meta:
        model = Report
        fields = ("id", "entity", "entity_id", "reason", "state",
                  "resolution_note", "resolved_by_phone", "created_at", "resolved_at")
        read_only_fields = fields


class ReportListView(ListAPIView):
    """GET /admin/reports?state=open — the complaints work queue."""

    serializer_class = ReportSerializer
    permission_classes = [IsAdminUser]
    pagination_class = None

    def get_queryset(self):
        qs = Report.objects.select_related("resolved_by").order_by("-created_at")
        state = self.request.query_params.get("state")
        if state:
            qs = qs.filter(state=state)
        return qs[:200]


class ReportProcessSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["resolve", "dismiss"])
    note = serializers.CharField(required=False, allow_blank=True, default="")


class ReportProcessView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Resolve or dismiss a report",
                   request=ReportProcessSerializer)
    def post(self, request, id):
        serializer = ReportProcessSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        report = Report.objects.filter(pk=id).first()
        if report is None:
            return Response(
                {"error": {"code": "not_found", "message": "Report not found",
                           "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        if report.state != Report.State.OPEN:
            return Response(
                {"error": {"code": "invalid_transition",
                           "message": f"Report already {report.state}",
                           "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        decision = serializer.validated_data["decision"]
        report.state = (Report.State.RESOLVED if decision == "resolve"
                        else Report.State.DISMISSED)
        report.resolution_note = serializer.validated_data["note"]
        report.resolved_by = request.user
        report.resolved_at = timezone.now()
        report.save(update_fields=["state", "resolution_note", "resolved_by",
                                   "resolved_at"])
        ActivityEvent.objects.create(
            actor=request.user, action=f"report.{decision}", entity="report",
            entity_id=str(report.id), metadata={"note": report.resolution_note[:500]},
        )
        return Response(ReportSerializer(report).data)


class AdminCampaignSerializer(serializers.ModelSerializer):
    business_name = serializers.CharField(source="business.name", read_only=True)
    owner_phone = serializers.CharField(source="business.owner.phone_e164", read_only=True)
    banner_url = serializers.SerializerMethodField()

    class Meta:
        model = Campaign
        fields = ("id", "headline", "review_status", "review_version",
                  "business_name", "owner_phone", "banner_url", "updated_at")

    def get_banner_url(self, obj) -> str:
        return f"/media/{obj.banner_key}" if obj.banner_key else ""


class AdminCampaignListView(ListAPIView):
    """GET /admin/campaigns?q=&status= — searchable oversight list."""

    serializer_class = AdminCampaignSerializer
    permission_classes = [IsAdminUser]
    pagination_class = None

    def get_queryset(self):
        qs = Campaign.objects.select_related(
            "business", "business__owner"
        ).order_by("-updated_at")
        q = self.request.query_params.get("q", "").strip()
        status_param = self.request.query_params.get("status", "").strip()
        if q:
            qs = qs.filter(
                Q(headline__icontains=q) | Q(business__name__icontains=q)
            )
        if status_param:
            qs = qs.filter(review_status=status_param)
        return qs[:100]


class CampaignSuspendSerializer(serializers.Serializer):
    reason = serializers.CharField()


class CampaignSuspendView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Suspend (takedown) an approved campaign",
                   request=CampaignSuspendSerializer)
    def post(self, request, id):
        serializer = CampaignSuspendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        campaign = Campaign.objects.filter(pk=id).first()
        if campaign is None:
            return Response(
                {"error": {"code": "not_found", "message": "Campaign not found",
                           "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            suspend_campaign(campaign=campaign, staff=request.user,
                             reason=serializer.validated_data["reason"])
        except ModerationError as exc:
            return Response(
                {"error": {"code": "invalid_transition", "message": str(exc),
                           "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"id": str(campaign.id),
                         "review_status": campaign.review_status})


class CampaignUnsuspendView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Restore a suspended campaign")
    def post(self, request, id):
        campaign = Campaign.objects.filter(pk=id).first()
        if campaign is None:
            return Response(
                {"error": {"code": "not_found", "message": "Campaign not found",
                           "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            unsuspend_campaign(campaign=campaign, staff=request.user)
        except ModerationError as exc:
            return Response(
                {"error": {"code": "invalid_transition", "message": str(exc),
                           "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"id": str(campaign.id),
                         "review_status": campaign.review_status})


class AdminOrderSerializer(serializers.ModelSerializer):
    campaign_headline = serializers.CharField(source="campaign.headline", read_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)

    class Meta:
        model = Order
        fields = ("id", "business_name", "campaign_headline", "amount_total",
                  "currency", "state", "created_at")


class AdminOrderListView(ListAPIView):
    """GET /admin/orders — recent platform orders (read-only oversight)."""

    serializer_class = AdminOrderSerializer
    permission_classes = [IsAdminUser]
    pagination_class = None

    def get_queryset(self):
        return Order.objects.select_related(
            "business", "campaign"
        ).order_by("-created_at")[:100]


class ActivitySerializer(serializers.ModelSerializer):
    actor_phone = serializers.CharField(source="actor.phone_e164",
                                        read_only=True, default=None)

    class Meta:
        model = ActivityEvent
        fields = ("id", "action", "entity", "entity_id", "actor_phone",
                  "metadata", "created_at")


class ActivityListView(ListAPIView):
    """GET /admin/activity — immutable audit trail tail."""

    serializer_class = ActivitySerializer
    permission_classes = [IsAdminUser]
    pagination_class = None

    def get_queryset(self):
        return ActivityEvent.objects.select_related("actor").order_by(
            "-created_at"
        )[:100]


class AdminOverviewView(APIView):
    """GET /admin/overview — moderation dashboard counters."""

    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Platform moderation overview")
    def get(self, request):
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        by_status = dict.fromkeys(
            (s for s, _ in Campaign.ReviewStatus.choices), 0
        )
        for row in Campaign.objects.values("review_status").annotate(n=Count("id")):
            by_status[row["review_status"]] = row["n"]
        paid = Order.objects.filter(state=Order.State.PAID)
        return Response({
            "queue_depth": by_status["submitted"] + by_status["under_review"],
            "open_reports": Report.objects.filter(state=Report.State.OPEN).count(),
            "refunds_requested": Refund.objects.filter(
                state__in=[Refund.State.REFUND_REQUESTED, Refund.State.ADMIN_REVIEW]
            ).count(),
            "campaigns": by_status,
            "active_placements": Placement.objects.filter(
                state=Placement.State.ACTIVE, end_at__gt=now
            ).count(),
            "revenue": {
                "total": paid.aggregate(s=Sum("amount_total"))["s"] or 0,
                "month": paid.filter(created_at__gte=month_start)
                             .aggregate(s=Sum("amount_total"))["s"] or 0,
            },
            "owners": get_user_model().objects.filter(is_staff=False).count(),
        })
