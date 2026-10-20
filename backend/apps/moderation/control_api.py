"""Staff control-room API: every account, business, branch, placement and log
in one place (spec §12 admin block, extended). All endpoints are staff-only;
every mutation requires a reason and appends an ActivityEvent.

- GET  /admin/users                      search accounts; GET .../{id} drill-down
- POST /admin/users/{id}/block|unblock   login access (advertisers only)
- GET  /admin/businesses                 search; POST .../{id}/status active|disabled
- GET  /admin/locations                  search; POST .../{id}/status active|disabled
- GET  /admin/placements                 every placement + live visibility
- POST /admin/placements/{id}/block|unblock  per-placement takedown
- GET  /admin/activity                   filterable, paginated audit trail
- GET  /admin/activity/export            same filters as CSV
- GET  /admin/payments                   payment attempts log
- GET  /admin/payment-events             provider webhook log

Lists use the default LimitOffset pagination ({count, next, previous, results}).
No endpoint here moves money or grants staff rights (by design).
"""
import csv
import json
from datetime import datetime, time

from django.contrib.auth import get_user_model
from django.db.models import Count, Exists, IntegerField, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import Order
from apps.businesses.models import Business
from apps.locations.models import Location
from apps.moderation.api import IsAdminUser
from apps.moderation.models import ActivityEvent
from apps.moderation.services import (
    ModerationError,
    block_placement,
    set_business_status,
    set_location_status,
    set_user_blocked,
    unblock_placement,
)
from apps.payments.models import PaymentAttempt, PaymentEvent
from apps.placements.models import Placement, eligible_now_q

User = get_user_model()

EXPORT_MAX_ROWS = 10_000


def _error(code: str, message: str, http_status: int) -> Response:
    return Response({"error": {"code": code, "message": message, "fields": {}}},
                    status=http_status)


def _not_found(what: str) -> Response:
    return _error("not_found", f"{what} not found", status.HTTP_404_NOT_FOUND)


def _conflict(exc: Exception) -> Response:
    return _error("invalid_transition", str(exc), status.HTTP_409_CONFLICT)


def _param(request, name: str) -> str:
    return request.query_params.get(name, "").strip()


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["active", "disabled"])
    reason = serializers.CharField(max_length=500)


class OkSerializer(serializers.Serializer):
    id = serializers.CharField()
    status = serializers.CharField()


# --- Users -------------------------------------------------------------------


class AdminUserSerializer(serializers.ModelSerializer):
    is_deleted = serializers.BooleanField(read_only=True)
    businesses_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "phone_e164", "is_active", "is_staff", "is_deleted",
                  "businesses_count", "last_login", "created_at")


class AdminUserListView(ListAPIView):
    """GET /admin/users?q=&status=active|blocked|staff|deleted"""

    serializer_class = AdminUserSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = User.objects.annotate(businesses_count=Count("businesses")).order_by(
            "-created_at"
        )
        q = _param(self.request, "q")
        if q:
            digits = "".join(ch for ch in q if ch.isdigit())
            qs = qs.filter(phone_e164__contains=digits or q)
        flt = _param(self.request, "status")
        if flt == "active":
            qs = qs.filter(is_active=True, deleted_at__isnull=True)
        elif flt == "blocked":
            qs = qs.filter(is_active=False, deleted_at__isnull=True)
        elif flt == "staff":
            qs = qs.filter(is_staff=True)
        elif flt == "deleted":
            qs = qs.filter(deleted_at__isnull=False)
        return qs


class _UserBusinessSerializer(serializers.ModelSerializer):
    locations_count = serializers.IntegerField(read_only=True)
    campaigns_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Business
        fields = ("id", "name", "status", "locations_count", "campaigns_count",
                  "created_at")


class _UserOrderSerializer(serializers.ModelSerializer):
    campaign_headline = serializers.CharField(source="campaign.headline", read_only=True)

    class Meta:
        model = Order
        fields = ("id", "campaign_headline", "amount_total", "currency", "state",
                  "created_at")


class AdminActivitySerializer(serializers.ModelSerializer):
    actor_phone = serializers.CharField(source="actor.phone_e164",
                                        read_only=True, default=None)

    class Meta:
        model = ActivityEvent
        fields = ("id", "action", "entity", "entity_id", "actor_phone",
                  "metadata", "created_at")


class AdminUserDetailSerializer(serializers.Serializer):
    user = AdminUserSerializer()
    businesses = _UserBusinessSerializer(many=True)
    orders = _UserOrderSerializer(many=True)
    activity = AdminActivitySerializer(many=True)


class AdminUserDetailView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="One account with its businesses, "
                   "recent orders and activity", responses=AdminUserDetailSerializer)
    def get(self, request, id):
        user = User.objects.annotate(
            businesses_count=Count("businesses")
        ).filter(pk=id).first()
        if user is None:
            return _not_found("User")
        businesses = Business.objects.filter(owner=user).annotate(
            locations_count=Count("locations", distinct=True),
            campaigns_count=Count("campaigns", distinct=True),
        ).order_by("name")
        orders = Order.objects.filter(business__owner=user).select_related(
            "campaign"
        ).order_by("-created_at")[:20]
        business_ids = [str(b.id) for b in businesses]
        activity = ActivityEvent.objects.filter(
            Q(actor=user)
            | Q(entity="user", entity_id=str(user.id))
            | Q(entity="business", entity_id__in=business_ids)
        ).select_related("actor").order_by("-created_at")[:50]
        return Response(AdminUserDetailSerializer({
            "user": user, "businesses": businesses, "orders": orders,
            "activity": activity,
        }).data)


class _UserBlockView(APIView):
    permission_classes = [IsAdminUser]
    blocked = True

    @extend_schema(tags=["Admin"], request=ReasonSerializer, responses=OkSerializer)
    def post(self, request, id):
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(pk=id).first()
        if user is None:
            return _not_found("User")
        if user.pk == request.user.pk:
            return _conflict(ModerationError("You cannot block yourself"))
        try:
            set_user_blocked(user=user, staff=request.user, blocked=self.blocked,
                             reason=serializer.validated_data["reason"])
        except ModerationError as exc:
            return _conflict(exc)
        return Response({"id": str(user.id),
                         "status": "active" if user.is_active else "blocked"})


class UserBlockView(_UserBlockView):
    blocked = True


class UserUnblockView(_UserBlockView):
    blocked = False


# --- Businesses & branches ---------------------------------------------------


class AdminBusinessSerializer(serializers.ModelSerializer):
    category_ru = serializers.CharField(source="category.name_ru", read_only=True)
    category_uz = serializers.CharField(source="category.name_uz", read_only=True)
    owner_id = serializers.UUIDField(source="owner.id", read_only=True)
    owner_phone = serializers.CharField(source="owner.phone_e164", read_only=True)
    owner_active = serializers.BooleanField(source="owner.is_active", read_only=True)
    locations_count = serializers.IntegerField(read_only=True)
    campaigns_count = serializers.IntegerField(read_only=True)
    live_ads = serializers.IntegerField(read_only=True)

    class Meta:
        model = Business
        fields = ("id", "name", "slug", "status", "category_ru", "category_uz", "owner_id",
                  "owner_phone", "owner_active", "locations_count",
                  "campaigns_count", "live_ads", "created_at")


class AdminBusinessListView(ListAPIView):
    """GET /admin/businesses?q=&status=&owner="""

    serializer_class = AdminBusinessSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        live = Placement.objects.filter(
            eligible_now_q(), campaign__business=OuterRef("pk")
        ).values("campaign__business").annotate(n=Count("id")).values("n")
        qs = Business.objects.select_related("owner", "category").annotate(
            locations_count=Count("locations", distinct=True),
            campaigns_count=Count("campaigns", distinct=True),
            live_ads=_coalesce_subquery(live),
        ).order_by("name")
        q = _param(self.request, "q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(owner__phone_e164__contains=q)
                           | Q(slug__icontains=q))
        if flt := _param(self.request, "status"):
            qs = qs.filter(status=flt)
        if owner := _param(self.request, "owner"):
            qs = qs.filter(owner_id=owner)
        return qs


def _coalesce_subquery(subquery):
    return Coalesce(Subquery(subquery, output_field=IntegerField()), Value(0))


class BusinessStatusView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Disable/enable a business (hides all "
                   "its ads live)", request=StatusChangeSerializer, responses=OkSerializer)
    def post(self, request, id):
        serializer = StatusChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        business = Business.objects.filter(pk=id).first()
        if business is None:
            return _not_found("Business")
        try:
            set_business_status(business=business, staff=request.user,
                                status=serializer.validated_data["status"],
                                reason=serializer.validated_data["reason"])
        except ModerationError as exc:
            return _conflict(exc)
        return Response({"id": str(business.id), "status": business.status})


class AdminLocationSerializer(serializers.ModelSerializer):
    business_id = serializers.UUIDField(source="business.id", read_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)
    business_status = serializers.CharField(source="business.status", read_only=True)
    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()
    live_ads = serializers.IntegerField(read_only=True)

    class Meta:
        model = Location
        fields = ("id", "name", "address", "city", "status", "risk_flags",
                  "business_id", "business_name", "business_status", "lat", "lng",
                  "live_ads", "created_at")

    def get_lat(self, obj) -> float:
        return obj.point.y

    def get_lng(self, obj) -> float:
        return obj.point.x


class AdminLocationListView(ListAPIView):
    """GET /admin/locations?q=&status=&business="""

    serializer_class = AdminLocationSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        live = Placement.objects.filter(
            eligible_now_q(), location=OuterRef("pk")
        ).values("location").annotate(n=Count("id")).values("n")
        qs = Location.objects.select_related("business").annotate(
            live_ads=_coalesce_subquery(live),
        ).order_by("business__name", "name")
        q = _param(self.request, "q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(address__icontains=q)
                           | Q(business__name__icontains=q))
        if flt := _param(self.request, "status"):
            qs = qs.filter(status=flt)
        if business := _param(self.request, "business"):
            qs = qs.filter(business_id=business)
        return qs


class LocationStatusView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Disable/enable one branch",
                   request=StatusChangeSerializer, responses=OkSerializer)
    def post(self, request, id):
        serializer = StatusChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        location = Location.objects.filter(pk=id).first()
        if location is None:
            return _not_found("Location")
        try:
            set_location_status(location=location, staff=request.user,
                                status=serializer.validated_data["status"],
                                reason=serializer.validated_data["reason"])
        except ModerationError as exc:
            return _conflict(exc)
        return Response({"id": str(location.id), "status": location.status})


# --- Placements --------------------------------------------------------------


class AdminPlacementSerializer(serializers.ModelSerializer):
    campaign_id = serializers.UUIDField(source="campaign.id", read_only=True)
    campaign_headline = serializers.CharField(source="campaign.headline", read_only=True)
    campaign_status = serializers.CharField(source="campaign.review_status",
                                            read_only=True)
    banner_url = serializers.SerializerMethodField()
    location_id = serializers.UUIDField(source="location.id", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    business_id = serializers.UUIDField(source="campaign.business.id", read_only=True)
    business_name = serializers.CharField(source="campaign.business.name",
                                          read_only=True)
    visible = serializers.BooleanField(read_only=True)

    class Meta:
        model = Placement
        fields = ("id", "state", "source_type", "block_reason", "start_at", "end_at",
                  "charge_days", "order_id", "campaign_id", "campaign_headline",
                  "campaign_status", "banner_url", "location_id", "location_name",
                  "business_id", "business_name", "visible", "created_at")

    def get_banner_url(self, obj) -> str:
        key = obj.campaign.banner_key
        return f"/media/{key}" if key else ""


class AdminPlacementListView(ListAPIView):
    """GET /admin/placements?q=&state=&source=&visible=1&business=&location=&campaign="""

    serializer_class = AdminPlacementSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = Placement.objects.select_related(
            "campaign", "campaign__business", "location"
        ).annotate(
            visible=Exists(Placement.objects.filter(eligible_now_q(), pk=OuterRef("pk")))
        ).order_by("-start_at")
        q = _param(self.request, "q")
        if q:
            qs = qs.filter(Q(campaign__headline__icontains=q)
                           | Q(campaign__business__name__icontains=q)
                           | Q(location__name__icontains=q))
        if flt := _param(self.request, "state"):
            qs = qs.filter(state=flt)
        if source := _param(self.request, "source"):
            qs = qs.filter(source_type=source)
        if _param(self.request, "visible") == "1":
            qs = qs.filter(visible=True)
        for key, field in (("business", "campaign__business_id"),
                           ("location", "location_id"),
                           ("campaign", "campaign_id")):
            if value := _param(self.request, key):
                qs = qs.filter(**{field: value})
        return qs


class _PlacementActionView(APIView):
    permission_classes = [IsAdminUser]
    transition = staticmethod(block_placement)

    @extend_schema(tags=["Admin"], request=ReasonSerializer, responses=OkSerializer)
    def post(self, request, id):
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            placement = self.transition(placement_id=id, staff=request.user,
                                    reason=serializer.validated_data["reason"])
        except ModerationError as exc:
            if "not found" in str(exc):
                return _not_found("Placement")
            return _conflict(exc)
        return Response({"id": str(placement.id), "status": placement.state})


class PlacementBlockView(_PlacementActionView):
    transition = staticmethod(block_placement)


class PlacementUnblockView(_PlacementActionView):
    transition = staticmethod(unblock_placement)


# --- Logs --------------------------------------------------------------------


def _parse_bound(raw: str, *, end: bool):
    """ISO datetime or date; a bare date `until` covers that whole day."""
    if not raw:
        return None
    dt = parse_datetime(raw)
    if dt is None:
        d = parse_date(raw)
        if d is None:
            return None
        dt = datetime.combine(d, time.max if end else time.min)
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt)
    return dt


ACTIVITY_PARAMS = [
    OpenApiParameter("action", str, description="action substring, e.g. 'refund.'"),
    OpenApiParameter("entity", str, description="exact entity, e.g. campaign"),
    OpenApiParameter("entity_id", str),
    OpenApiParameter("actor", str, description="actor phone substring, or 'system'"),
    OpenApiParameter("q", str, description="free text across action/entity id/metadata"),
    OpenApiParameter("since", str, description="ISO date/datetime"),
    OpenApiParameter("until", str, description="ISO date/datetime (inclusive day)"),
]


def filtered_activity(request):
    qs = ActivityEvent.objects.select_related("actor").order_by("-created_at")
    if action := _param(request, "action"):
        qs = qs.filter(action__icontains=action)
    if entity := _param(request, "entity"):
        qs = qs.filter(entity=entity)
    if entity_id := _param(request, "entity_id"):
        qs = qs.filter(entity_id=entity_id)
    actor = _param(request, "actor")
    if actor == "system":
        qs = qs.filter(actor__isnull=True)
    elif actor:
        qs = qs.filter(actor__phone_e164__contains=actor)
    if q := _param(request, "q"):
        qs = qs.filter(Q(action__icontains=q) | Q(entity_id__icontains=q)
                       | Q(metadata__icontains=q))
    if since := _parse_bound(_param(request, "since"), end=False):
        qs = qs.filter(created_at__gte=since)
    if until := _parse_bound(_param(request, "until"), end=True):
        qs = qs.filter(created_at__lte=until)
    return qs


@extend_schema(parameters=ACTIVITY_PARAMS)
class ActivityListView(ListAPIView):
    """GET /admin/activity — filterable, paginated immutable audit trail."""

    serializer_class = AdminActivitySerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        return filtered_activity(self.request)


class ActivityExportView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(tags=["Admin"], summary="Audit trail as CSV (same filters, "
                   f"max {EXPORT_MAX_ROWS} rows)", parameters=ACTIVITY_PARAMS,
                   responses={(200, "text/csv"): OpenApiTypes.STR})
    def get(self, request):
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        stamp = timezone.now().strftime("%Y%m%d-%H%M")
        response["Content-Disposition"] = f'attachment; filename="activity-{stamp}.csv"'
        response.write("﻿")  # BOM: Excel opens UTF-8 (Cyrillic) correctly
        writer = csv.writer(response)
        writer.writerow(["created_at", "action", "entity", "entity_id", "actor",
                         "metadata"])
        for event in filtered_activity(request)[:EXPORT_MAX_ROWS]:
            writer.writerow([
                event.created_at.isoformat(), event.action, event.entity,
                event.entity_id,
                event.actor.phone_e164 if event.actor else "system",
                json.dumps(event.metadata, ensure_ascii=False),
            ])
        ActivityEvent.objects.create(
            actor=request.user, action="activity.export", entity="activity",
            entity_id="-", metadata={k: v for k, v in request.query_params.items()},
        )
        return response


class AdminPaymentSerializer(serializers.ModelSerializer):
    order_state = serializers.CharField(source="order.state", read_only=True)
    business_name = serializers.CharField(source="order.business.name", read_only=True)
    campaign_headline = serializers.CharField(source="order.campaign.headline",
                                              read_only=True)
    events_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = PaymentAttempt
        fields = ("id", "order_id", "order_state", "provider", "provider_payment_id",
                  "amount", "status", "business_name", "campaign_headline",
                  "events_count", "created_at", "updated_at")


class AdminPaymentListView(ListAPIView):
    """GET /admin/payments?status=&provider=&q=&order="""

    serializer_class = AdminPaymentSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = PaymentAttempt.objects.select_related(
            "order", "order__business", "order__campaign"
        ).annotate(events_count=Count("events")).order_by("-created_at")
        if flt := _param(self.request, "status"):
            qs = qs.filter(status=flt)
        if provider := _param(self.request, "provider"):
            qs = qs.filter(provider=provider)
        if order := _param(self.request, "order"):
            qs = qs.filter(order_id=order)
        if q := _param(self.request, "q"):
            qs = qs.filter(Q(provider_payment_id__icontains=q)
                           | Q(order__business__name__icontains=q))
        return qs


class AdminPaymentEventSerializer(serializers.ModelSerializer):
    payment_status = serializers.CharField(source="payment_attempt.status",
                                           read_only=True, default=None)
    order_id = serializers.UUIDField(source="payment_attempt.order_id",
                                     read_only=True, default=None)

    class Meta:
        model = PaymentEvent
        fields = ("id", "provider", "event_id", "payment_attempt_id",
                  "payment_status", "order_id", "validated_payload_digest",
                  "received_at")


class AdminPaymentEventListView(ListAPIView):
    """GET /admin/payment-events?provider=&q= — raw provider callbacks."""

    serializer_class = AdminPaymentEventSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = PaymentEvent.objects.select_related("payment_attempt").order_by(
            "-received_at"
        )
        if provider := _param(self.request, "provider"):
            qs = qs.filter(provider=provider)
        if q := _param(self.request, "q"):
            qs = qs.filter(event_id__icontains=q)
        return qs

