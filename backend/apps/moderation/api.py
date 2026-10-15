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
- GET  /admin/overview                dashboard counters
- PATCH /admin/settings/ad-limit      max simultaneous ads per location

Users, businesses, branches, placements and logs live in control_api.py.
"""
from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import permissions, serializers, status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import Order, OrderItem, Refund
from apps.billing.services import RefundError, process_refund
from apps.businesses.models import Business
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.moderation.models import ActivityEvent, PlatformSetting, Report
from apps.moderation.services import (
    ADMIN_BLOCK_REASON,
    ModerationError,
    approve_campaign,
    reject_campaign,
    suspend_campaign,
    unsuspend_campaign,
)
from apps.placements.models import FreeGrant, Placement
from apps.placements.services import issue_free_grant, max_active_ads
from apps.renewals.models import RenewalAgreement, RenewalAttempt


class IsAdminUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


class CampaignStatusResultSerializer(serializers.Serializer):
    """Body returned by review/suspend/unsuspend (schema documentation)."""

    id = serializers.UUIDField(read_only=True)
    review_status = serializers.CharField(read_only=True)
    review_version = serializers.IntegerField(read_only=True, required=False)


class AdLimitValueSerializer(serializers.Serializer):
    key = serializers.CharField(read_only=True)
    value = serializers.IntegerField(read_only=True)


class _GrantCampaignOptionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    headline = serializers.CharField()
    business_name = serializers.CharField()


class _GrantLocationOptionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    business_name = serializers.CharField()


class _GrantRowSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    campaign_headline = serializers.CharField()
    business_name = serializers.CharField()
    location_name = serializers.CharField()
    start_at = serializers.DateTimeField()
    end_at = serializers.DateTimeField()
    reason = serializers.CharField()
    admin_phone = serializers.CharField(allow_null=True)
    created_at = serializers.DateTimeField()


class GrantOptionsSerializer(serializers.Serializer):
    campaigns = _GrantCampaignOptionSerializer(many=True)
    locations = _GrantLocationOptionSerializer(many=True)
    grants = _GrantRowSerializer(many=True)


class _RevenueSerializer(serializers.Serializer):
    total = serializers.IntegerField(help_text="Paid minus refunded, minor units")
    month = serializers.IntegerField(help_text="This month, net of refunds, minor units")


class _AttentionSerializer(serializers.Serializer):
    renewal_alerts = serializers.IntegerField(help_text="Agreements in ALERT")
    renewal_reconciliation = serializers.IntegerField(
        help_text="Renewal attempts with an ambiguous provider outcome")
    capacity_blocked = serializers.IntegerField(
        help_text="Paid placements blocked by a capacity conflict (refund queue)")
    staff_blocked = serializers.IntegerField(help_text="Placements taken down by staff")
    blocked_users = serializers.IntegerField()
    disabled_businesses = serializers.IntegerField()
    disabled_locations = serializers.IntegerField()


class AdminOverviewSerializer(serializers.Serializer):
    queue_depth = serializers.IntegerField()
    open_reports = serializers.IntegerField()
    refunds_requested = serializers.IntegerField()
    campaigns = serializers.DictField(child=serializers.IntegerField())
    active_placements = serializers.IntegerField()
    revenue = _RevenueSerializer()
    owners = serializers.IntegerField()
    attention = _AttentionSerializer()


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
                   request=ReviewSerializer, responses=CampaignStatusResultSerializer)
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
                   request=GrantSerializer,
                   responses={201: inline_serializer("GrantCreated", fields={
                       "id": serializers.UUIDField()})})
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

    @extend_schema(tags=["Admin"], summary="Grant form options and recent grants",
                   responses=GrantOptionsSerializer)
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
    amount = serializers.IntegerField(required=False, min_value=1)


class RefundProcessView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Manually process a refund request",
                   request=RefundProcessSerializer, responses=RefundSerializer)
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

    @extend_schema(tags=["Admin"], summary="Current max simultaneous ads per location",
                   responses=AdLimitValueSerializer)
    def get(self, request):
        return Response({"key": "max_active_ads_per_location", "value": max_active_ads()})

    @extend_schema(tags=["Admin"], summary="Change max simultaneous ads per location",
                   request=AdLimitSerializer, responses=AdLimitValueSerializer)
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
                   request=ReportProcessSerializer, responses=ReportSerializer)
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
                  "business_id", "business_name", "owner_phone", "banner_url",
                  "updated_at")

    def get_banner_url(self, obj) -> str:
        return f"/media/{obj.banner_key}" if obj.banner_key else ""


class AdminCampaignListView(ListAPIView):
    """GET /admin/campaigns?q=&status=&business= — searchable, paginated."""

    serializer_class = AdminCampaignSerializer
    permission_classes = [IsAdminUser]

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
        if business := self.request.query_params.get("business", "").strip():
            qs = qs.filter(business_id=business)
        return qs


class CampaignSuspendSerializer(serializers.Serializer):
    reason = serializers.CharField()


class CampaignSuspendView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Suspend (takedown) an approved campaign",
                   request=CampaignSuspendSerializer, responses=CampaignStatusResultSerializer)
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


class CampaignUnsuspendSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)


class CampaignUnsuspendView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Restore a suspended campaign",
                   request=CampaignUnsuspendSerializer,
                   responses=CampaignStatusResultSerializer)
    def post(self, request, id):
        campaign = Campaign.objects.filter(pk=id).first()
        if campaign is None:
            return Response(
                {"error": {"code": "not_found", "message": "Campaign not found",
                           "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            unsuspend_campaign(campaign=campaign, staff=request.user,
                               reason=str(request.data.get("reason", ""))[:500])
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
        fields = ("id", "business_id", "business_name", "campaign_id",
                  "campaign_headline", "amount_total", "currency", "state",
                  "auto_renew", "attempts_count", "created_at")

    attempts_count = serializers.IntegerField(read_only=True)


class AdminOrderListView(ListAPIView):
    """GET /admin/orders?state=&q=&business= — platform orders (read-only)."""

    serializer_class = AdminOrderSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = Order.objects.select_related("business", "campaign").annotate(
            attempts_count=Count("attempts")
        ).order_by("-created_at")
        params = self.request.query_params
        if state := params.get("state", "").strip():
            qs = qs.filter(state=state)
        if business := params.get("business", "").strip():
            qs = qs.filter(business_id=business)
        if q := params.get("q", "").strip():
            qs = qs.filter(Q(business__name__icontains=q)
                           | Q(campaign__headline__icontains=q)
                           | Q(id__startswith=q))
        return qs


class AdminOverviewView(APIView):
    """GET /admin/overview — moderation dashboard counters."""

    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Platform moderation overview",
                   responses=AdminOverviewSerializer)
    def get(self, request):
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        by_status = dict.fromkeys(
            (s for s, _ in Campaign.ReviewStatus.choices), 0
        )
        for row in Campaign.objects.values("review_status").annotate(n=Count("id")):
            by_status[row["review_status"]] = row["n"]
        paid = Order.objects.filter(state=Order.State.PAID)
        # Refunded orders stay PAID (payment records are never erased), so
        # revenue is reported net of completed refunds.
        refunded = Refund.objects.filter(state=Refund.State.REFUNDED)

        def _sum(qs, field: str) -> int:
            return qs.aggregate(s=Sum(field))["s"] or 0

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
                "total": _sum(paid, "amount_total") - _sum(refunded, "amount"),
                "month": _sum(paid.filter(created_at__gte=month_start), "amount_total")
                - _sum(refunded.filter(completed_at__gte=month_start), "amount"),
            },
            "owners": get_user_model().objects.filter(is_staff=False).count(),
            "attention": {
                "renewal_alerts": RenewalAgreement.objects.filter(
                    status=RenewalAgreement.Status.ALERT).count(),
                "renewal_reconciliation": RenewalAttempt.objects.filter(
                    state=RenewalAttempt.State.RECONCILIATION).count(),
                "capacity_blocked": Placement.objects.filter(
                    state=Placement.State.BLOCKED,
                    block_reason="capacity_conflict").count(),
                "staff_blocked": Placement.objects.filter(
                    state=Placement.State.BLOCKED,
                    block_reason=ADMIN_BLOCK_REASON).count(),
                "blocked_users": get_user_model().objects.filter(
                    is_active=False, deleted_at__isnull=True).count(),
                "disabled_businesses": Business.objects.filter(
                    status=Business.Status.DISABLED).count(),
                "disabled_locations": Location.objects.filter(
                    status=Location.Status.DISABLED).count(),
            },
        })
