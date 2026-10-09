"""Anonymous public endpoints (spec §10, §12): map pins in a bbox, location
details with active ads, active-only campaign details, categories, reports.

Ordering: relevance first, then distance. No paid ranking boost in MVP.
All public responses expose ONLY currently-eligible content; expired/blocked
campaigns are invisible everywhere, including direct URLs (spec §7.1, §14).
"""
from django.contrib.gis.geos import Polygon
from django.db.models import Count, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.businesses.models import BusinessCategory
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.placements.models import Placement, eligible_now_q

from . import serializers

# Guards (spec §12): bbox size and response count bounds.
MAX_BBOX_AREA = 1.0  # deg^2; roughly a ~100km square around Tashkent
MAX_LIMIT = 200
DEFAULT_LIMIT = 100


@extend_schema_view(
    get=extend_schema(
        tags=["Public"],
        summary="Map pins: active locations in a bbox",
        description="Returns id/coords/active-ads-count per location. "
        "Filter by category and free-text query; bounded limit.",
    )
)
class PublicLocationListView(ListAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    serializer_class = serializers.PublicLocationSerializer
    pagination_class = None

    def get_queryset(self):
        params = self.request.query_params
        bbox = params.get("bbox")
        if not bbox:
            raise ValidationError({"bbox": "Required: bbox=minlon,minlat,maxlon,maxlat"})
        try:
            minlon, minlat, maxlon, maxlat = (float(v) for v in bbox.split(","))
        except ValueError:
            raise ValidationError({"bbox": "Expected four comma-separated numbers"})

        if not (-180 <= minlon < maxlon <= 180 and -90 <= minlat < maxlat <= 90):
            raise ValidationError({"bbox": "Invalid bbox coordinates"})
        if (maxlon - minlon) * (maxlat - minlat) > MAX_BBOX_AREA:
            raise ValidationError({"bbox": "bbox too large; zoom in"})

        envelope = Polygon.from_bbox((minlon, minlat, maxlon, maxlat))
        now = timezone.now()
        qs = (
            Location.objects.filter(status=Location.Status.ACTIVE)
            .filter(business__status=Location.Status.ACTIVE)
            .select_related("business", "business__category")
            .annotate(active_ads_count=Count("placements",
                                             filter=eligible_now_q(now, prefix="placements__")))
            .filter(point__contained=envelope)
        )

        category = params.get("category")
        if category:
            qs = qs.filter(business__category__slug=category)
        q = params.get("q")
        if q:
            qs = qs.filter(
                Q(name__icontains=q)
                | Q(business__name__icontains=q)
                | Q(business__campaigns__headline__icontains=q)
            ).distinct()
        try:
            limit = int(params.get("limit", DEFAULT_LIMIT))
        except ValueError:
            limit = DEFAULT_LIMIT
        return qs[: max(1, min(limit, MAX_LIMIT))]


@extend_schema_view(
    get=extend_schema(tags=["Public"], summary="Location detail with active ads")
)
class PublicLocationDetailView(RetrieveAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    serializer_class = serializers.PublicLocationDetailSerializer
    lookup_url_kwarg = "id"

    def get_queryset(self):
        return (
            Location.objects.filter(status=Location.Status.ACTIVE)
            .filter(business__status="active")
            .select_related("business", "business__category")
        )

    def get_object(self):
        location = super().get_object()
        now = timezone.now()
        active_placements = (
            Placement.objects.filter(location=location)
            .filter(eligible_now_q(now))
            .select_related("campaign", "campaign__business")
            .order_by("start_at")[:20]
        )
        location.active_ads = [
            {
                "id": p.campaign_id,
                "headline": p.campaign.headline,
                "body": p.campaign.body,
                "banner_url": f"/media/{p.campaign.banner_key}",
                "business_name": p.campaign.business.name,
                "starts_at": p.start_at,
                "ends_at": p.end_at,
            }
            for p in active_placements
        ]
        return location


@extend_schema_view(
    get=extend_schema(tags=["Public"],
                      summary="Active-only ad details",
                      description="Expired/unapproved/blocked campaigns return 404 (spec §14).")
)
class PublicCampaignDetailView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, id):
        now = timezone.now()
        placement = (
            Placement.objects.filter(campaign_id=id)
            .filter(eligible_now_q(now))
            .select_related("campaign", "campaign__business")
            .first()
        )
        if placement is None:
            return Response(
                {"error": {"code": "not_found", "message": "Ad unavailable", "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        campaign = placement.campaign
        payload = {
            "id": str(campaign.id),
            "headline": campaign.headline,
            "body": campaign.body,
            "banner_url": f"/media/{campaign.banner_key}",
            "business_name": campaign.business.name,
            "starts_at": placement.start_at,
            "ends_at": placement.end_at,
        }
        return Response(serializers.PublicCampaignSerializer(payload).data)


@extend_schema_view(
    get=extend_schema(tags=["Public"], summary="Business categories")
)
class CategoryListView(ListAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    serializer_class = serializers.CategorySerializer
    pagination_class = None
    queryset = BusinessCategory.objects.filter(active=True)


@extend_schema_view(
    get=extend_schema(tags=["Public"], summary="Search locations and campaigns",
                      description="Relevance first (name/business/ad headline match),"
                                  " then distance from the optional lat/lon.")
)
class PublicSearchView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        from django.contrib.gis.db.models.functions import Distance as GisDistance
        from django.contrib.gis.geos import Point as GisPoint

        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"locations": [], "campaigns": []})
        category = request.query_params.get("category")
        now = timezone.now()

        locations = (
            Location.objects.filter(status=Location.Status.ACTIVE)
            .filter(business__status="active")
            .select_related("business", "business__category")
            .annotate(
                active_ads_count=Count(
                    "placements", filter=eligible_now_q(now, prefix="placements__")
                )
            )
            .filter(
                Q(name__icontains=q)
                | Q(business__name__icontains=q)
                | Q(business__campaigns__headline__icontains=q)
            )
            .distinct()
        )
        if category:
            locations = locations.filter(business__category__slug=category)
        try:
            lat = float(request.query_params.get("lat"))
            lon = float(request.query_params.get("lon"))
            origin = GisPoint(lon, lat, srid=4326)
            locations = locations.annotate(distance=GisDistance("point", origin)).order_by(
                "distance"
            )
        except (TypeError, ValueError):
            locations = locations.order_by("name")
        locations = locations[:20]

        campaigns = (
            Campaign.objects.filter(review_status=Campaign.ReviewStatus.APPROVED)
            .filter(
                placements__state__in=["scheduled", "active"],
                placements__start_at__lte=now,
                placements__end_at__gt=now,
            )
            .filter(Q(headline__icontains=q) | Q(body__icontains=q))
            .select_related("business")
            .distinct()[:20]
        )

        return Response(
            {
                "locations": serializers.PublicLocationSerializer(locations, many=True).data,
                "campaigns": [
                    {
                        "id": str(c.id),
                        "headline": c.headline,
                        "business_name": c.business.name,
                    }
                    for c in campaigns
                ],
            }
        )


@extend_schema_view(
    post=extend_schema(tags=["Public"], summary="Report a suspicious business/ad")
)
class PublicReportView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "anon"

    def post(self, request):
        entity = request.data.get("entity", "")
        entity_id = request.data.get("entity_id", "")
        reason = (request.data.get("reason") or "").strip()
        if entity not in {"location", "campaign"} or not entity_id or not reason:
            return Response(
                {"error": {"code": "validation_error",
                           "message": "entity, entity_id and reason are required",
                           "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.moderation.models import ActivityEvent, Report

        ActivityEvent.objects.create(
            actor=None,
            action="public.report",
            entity=entity,
            entity_id=str(entity_id),
            metadata={"reason": reason[:2000]},
        )
        Report.objects.create(
            entity=entity, entity_id=str(entity_id), reason=reason[:2000]
        )
        return Response({"detail": "Report received"}, status=status.HTTP_202_ACCEPTED)
