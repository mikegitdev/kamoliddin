"""Anonymous public endpoints (spec §10, §12): map pins in a bbox, location
details with active ads, active-only campaign details, categories, reports.

Ordering: relevance first, then distance. No paid ranking boost in MVP.
All public responses expose ONLY currently-eligible content; expired/blocked
campaigns are invisible everywhere, including direct URLs (spec §7.1, §14).
"""
import uuid

from django.contrib.gis.geos import Polygon
from django.db.models import Count, IntegerField, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.businesses.models import Business, BusinessCategory
from apps.campaigns.models import Campaign
from apps.core.serializers import DetailSerializer
from apps.locations.models import Location
from apps.placements.models import Placement, eligible_now_q

from . import serializers

# Guards (spec §12): bbox size and response count bounds.
MAX_BBOX_AREA = 1.0  # deg^2; roughly a ~100km square around Tashkent
MAX_LIMIT = 200
DEFAULT_LIMIT = 100


def _active_ads_count(now):
    """Eligible-placement count per location as a correlated subquery. A plain
    Count("placements") gets multiplied by the business->campaigns join that
    text search adds, inflating map-pin counts whenever `q` is present."""
    counts = (
        Placement.objects.filter(location=OuterRef("pk"))
        .filter(eligible_now_q(now))
        .order_by()
        .values("location")
        .annotate(n=Count("pk"))
        .values("n")
    )
    return Coalesce(Subquery(counts, output_field=IntegerField()), 0)


def _relevance_annotation(q: str):
    """Tiered relevance (spec §10, acceptance #12): location name match (3)
    beats business name match (2), which beats an approved campaign headline
    match (1). Unapproved campaign copy never contributes (spec §14: paid but
    unapproved content must not appear anywhere public)."""
    from django.db.models import Case, IntegerField, Value, When

    return Case(
        When(name__icontains=q, then=Value(3)),
        When(business__name__icontains=q, then=Value(2)),
        When(
            business__campaigns__headline__icontains=q,
            business__campaigns__review_status=Campaign.ReviewStatus.APPROVED,
            then=Value(1),
        ),
        default=Value(0),
        output_field=IntegerField(),
    )


def _text_match_q(q: str):
    """Text filter across location/business/approved-campaign headline."""
    return (
        Q(name__icontains=q)
        | Q(business__name__icontains=q)
        | Q(
            business__campaigns__headline__icontains=q,
            business__campaigns__review_status=Campaign.ReviewStatus.APPROVED,
        )
    )


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
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return Location.objects.none()
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
            .filter(business__status=Business.Status.ACTIVE)
            .select_related("business", "business__category")
            .annotate(active_ads_count=_active_ads_count(now))
            .filter(point__contained=envelope)
        )

        category = params.get("category")
        if category:
            qs = qs.filter(business__category__slug=category)
        q = params.get("q")
        if q:
            # Relevance first (tiered), then name for a stable secondary order
            # (acceptance #12); unapproved campaign headlines never match.
            qs = qs.filter(_text_match_q(q)).annotate(relevance=_relevance_annotation(q)).order_by(
                "-relevance", "name"
            ).distinct()
        else:
            qs = qs.order_by("name")
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
            .filter(business__status=Business.Status.ACTIVE)
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
    get=extend_schema(
        tags=["Public"],
        summary="Active-only ad details with eligible branches",
        description="Expired/unapproved/blocked campaigns return 404 (spec §14). "
                    "Includes every currently eligible branch with address, hours "
                    "and contacts so shared direct links work without client "
                    "navigation state.",
        responses=serializers.PublicCampaignDetailSerializer,
    )
)
class PublicCampaignDetailView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    #: Branch list cap: a campaign can target many locations, but a shared ad
    #: link needs actionable context, not the full placement table.
    MAX_LOCATIONS = 20

    def get(self, request, id):
        now = timezone.now()
        placements = (
            Placement.objects.filter(campaign_id=id)
            .filter(eligible_now_q(now))
            .select_related("campaign", "campaign__business", "location", "location__business")
            .order_by("start_at")
        )
        first = placements.first()
        if first is None:
            return Response(
                {"error": {"code": "not_found", "message": "Ad unavailable", "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        campaign = first.campaign
        # One campaign may run several placements at the same location; the
        # branch list is about where to find the offer, so dedupe by location.
        seen_location_ids = set()
        locations = []
        for placement in placements:
            location = placement.location
            if location.id in seen_location_ids:
                continue
            seen_location_ids.add(location.id)
            locations.append(location)
        locations.sort(key=lambda loc: loc.name)
        payload = {
            "id": str(campaign.id),
            "headline": campaign.headline,
            "body": campaign.body,
            "banner_url": f"/media/{campaign.banner_key}",
            "business_name": campaign.business.name,
            "starts_at": first.start_at,
            "ends_at": first.end_at,
            "locations": locations[: self.MAX_LOCATIONS],
        }
        return Response(serializers.PublicCampaignDetailSerializer(payload).data)


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
                                  " then distance from the optional lat/lon.",
                      parameters=[
                          OpenApiParameter("q", OpenApiTypes.STR,
                                           description="At least 2 characters"),
                          OpenApiParameter("category", OpenApiTypes.STR),
                          OpenApiParameter("lat", OpenApiTypes.NUMBER),
                          OpenApiParameter("lon", OpenApiTypes.NUMBER),
                      ],
                      responses=serializers.PublicSearchResultSerializer)
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
        origin = None

        locations = (
            Location.objects.filter(status=Location.Status.ACTIVE)
            .filter(business__status=Business.Status.ACTIVE)
            .select_related("business", "business__category")
            .annotate(active_ads_count=_active_ads_count(now))
            .filter(_text_match_q(q))
            # Relevance first, then distance when an origin is given,
            # otherwise name (spec §10, acceptance #12).
            .annotate(relevance=_relevance_annotation(q))
            .distinct()
        )
        if category:
            locations = locations.filter(business__category__slug=category)
        try:
            lat = float(request.query_params.get("lat"))
            lon = float(request.query_params.get("lon"))
            origin = GisPoint(lon, lat, srid=4326)
            locations = locations.annotate(distance=GisDistance("point", origin)).order_by(
                "-relevance", "distance"
            )
        except (TypeError, ValueError):
            locations = locations.order_by("-relevance", "name")
        locations = locations[:20]

        # One eligibility source of truth: the same live predicate used by
        # pins, location detail and ad detail (no hand-rolled drift).
        campaign_qs = (
            Campaign.objects.filter(eligible_now_q(now, prefix="placements__"))
            .filter(Q(headline__icontains=q) | Q(body__icontains=q))
            .distinct()
        )
        if category:
            campaign_qs = campaign_qs.filter(business__category__slug=category)
        campaigns = campaign_qs.select_related("business")[:20]

        location_data = serializers.PublicLocationSerializer(locations, many=True).data
        # Distance (meters) for the result cards: only when an origin was given
        # — the same annotation the ordering used.
        if origin is not None:
            for item, loc in zip(location_data, locations):
                distance = getattr(loc, "distance", None)
                if distance is not None:
                    item["distance_m"] = round(distance.m)

        return Response(
            {
                "locations": location_data,
                "campaigns": [
                    {
                        "id": str(c.id),
                        "headline": c.headline,
                        "business_name": c.business.name,
                        "banner_url": f"/media/{c.banner_key}" if c.banner_key else "",
                    }
                    for c in campaigns
                ],
            }
        )


@extend_schema_view(
    get=extend_schema(tags=["Public"], summary="Current ad price per location per 24h",
                      responses=serializers.PublicPricingSerializer)
)
class PublicPricingView(APIView):
    """GET /public/pricing — the current Tariff, so the campaign editor can
    show a live cost estimate while the advertiser picks branches and dates.
    The quote endpoint remains the source of truth for the charged amount."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        from apps.billing.models import Tariff

        tariff = Tariff.current()
        if tariff is None:
            return Response({"tariff": None})
        return Response(
            {
                "tariff": {
                    "currency": tariff.currency,
                    "amount_per_24h": tariff.amount_per_24h,
                    "valid_from": tariff.valid_from,
                }
            }
        )


@extend_schema_view(
    post=extend_schema(tags=["Public"], summary="Report a suspicious business/ad",
                       request=serializers.PublicReportRequestSerializer,
                       responses={202: DetailSerializer})
)
class PublicReportView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "report"

    def post(self, request):
        entity = request.data.get("entity", "")
        entity_id = str(request.data.get("entity_id", ""))
        reason = (request.data.get("reason") or "").strip()
        if entity not in {"location", "campaign"} or not entity_id or not reason:
            return Response(
                {"error": {"code": "validation_error",
                           "message": "entity, entity_id and reason are required",
                           "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.moderation.models import Report

        # The referenced entity must exist — otherwise the public endpoint is a
        # spam sink (spec §12 rate-limited, but still garbage-in).
        try:
            entity_id = str(uuid.UUID(entity_id))  # malformed ids would 500 in the ORM
            if entity == "location":
                if not Location.objects.filter(pk=entity_id).exists():
                    raise LookupError
            elif not Campaign.objects.filter(pk=entity_id).exists():
                raise LookupError
        except (LookupError, ValueError, TypeError):
            return Response(
                {"error": {"code": "validation_error",
                           "message": "Unknown entity_id for this entity type",
                           "fields": {"entity_id": "Not found"}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Anonymous reports go to the moderation queue ONLY. ActivityEvent is
        # an append-only audit trail for privileged actions — public input must
        # not write into it (audit-log pollution / unbounded growth).
        Report.objects.create(
            entity=entity, entity_id=entity_id, reason=reason[:2000]
        )
        return Response({"detail": "Report received"}, status=status.HTTP_202_ACCEPTED)
