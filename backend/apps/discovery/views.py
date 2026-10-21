"""Anonymous public endpoints (spec §10, §12): map pins in a bbox, location
details with active ads, active-only campaign details, categories, reports.

Ordering: relevance first, then distance. No paid ranking boost in MVP.
All public responses expose ONLY currently-eligible content; expired/blocked
campaigns are invisible everywhere, including direct URLs (spec §7.1, §14).
"""
import base64
import binascii
import hashlib
import json
import uuid

from django.contrib.gis.db.models.functions import Distance as GisDistanceFunc
from django.contrib.gis.geos import Point as GisPoint
from django.contrib.gis.geos import Polygon
from django.contrib.gis.measure import D
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

# Nearby ads feed guards: bounded spatial scan + bounded page (spec §12).
NEARBY_MIN_RADIUS_M = 300
NEARBY_MAX_RADIUS_M = 20_000
NEARBY_DEFAULT_RADIUS_M = 5_000
NEARBY_DEFAULT_LIMIT = 20
NEARBY_MAX_LIMIT = 50


def _campaign_relevance(q: str):
    """Tiered relevance for the nearby feed's text search: headline prefix (3)
    beats headline substring (2), beats body text (1). Relevance is a
    campaign-level attribute, so it never changes WHICH branch is nearest —
    only the order cards appear in (spec §10, acceptance #12)."""
    from django.db.models import Case, Value, When

    return Case(
        When(campaign__headline__istartswith=q, then=Value(3)),
        When(campaign__headline__icontains=q, then=Value(2)),
        When(campaign__body__icontains=q, then=Value(1)),
        default=Value(0),
        output_field=IntegerField(),
    )


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
    get=extend_schema(
        tags=["Public"],
        summary="Nearby ads feed (distance-sorted list view)",
        description="Currently eligible campaigns within radius_m of lat/lon, "
                    "one card per campaign at its nearest CURRENTLY eligible "
                    "branch. Ordered by distance; relevance first when q is "
                    "given (sort=relevance). Cursor-paginated.",
        parameters=[
            OpenApiParameter("lat", OpenApiTypes.NUMBER, required=True,
                             description="Origin latitude"),
            OpenApiParameter("lon", OpenApiTypes.NUMBER, required=True,
                             description="Origin longitude"),
            OpenApiParameter("radius_m", OpenApiTypes.INT,
                             description=f"{NEARBY_MIN_RADIUS_M}..{NEARBY_MAX_RADIUS_M}, "
                                         f"default {NEARBY_DEFAULT_RADIUS_M}"),
            OpenApiParameter("category", OpenApiTypes.STR),
            OpenApiParameter("q", OpenApiTypes.STR, description="At least 2 characters"),
            OpenApiParameter("sort", OpenApiTypes.STR, enum=["distance", "relevance"],
                             description="Default: relevance when q is given, else distance"),
            OpenApiParameter("limit", OpenApiTypes.INT,
                             description=f"1..{NEARBY_MAX_LIMIT}, default {NEARBY_DEFAULT_LIMIT}"),
            OpenApiParameter("cursor", OpenApiTypes.STR,
                             description="Opaque cursor from a previous page"),
        ],
        responses=serializers.PublicNearbyAdsResultSerializer,
    )
)
class PublicNearbyAdsView(APIView):
    """Distance-ordered ad cards for the public list view (spec §10).

    One card per campaign at its nearest eligible branch: a Postgres
    DISTINCT ON subquery picks that branch BEFORE pagination, so ordering
    and slicing can never "sort a limited set" and miss closer ads.
    Eligibility is re-evaluated on every request — a cursor only carries a
    keyset position, never stale visibility."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        params = request.query_params

        try:
            lat = float(params.get("lat"))
            lon = float(params.get("lon"))
        except (TypeError, ValueError):
            raise ValidationError({"lat": "Required: lat=…, lon=… (numbers)"})
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValidationError({"lat": "lat/lon out of range"})
        try:
            radius_m = int(params.get("radius_m", NEARBY_DEFAULT_RADIUS_M))
        except (TypeError, ValueError):
            raise ValidationError({"radius_m": "Expected an integer (meters)"})
        if not (NEARBY_MIN_RADIUS_M <= radius_m <= NEARBY_MAX_RADIUS_M):
            raise ValidationError(
                {"radius_m": f"Expected {NEARBY_MIN_RADIUS_M}..{NEARBY_MAX_RADIUS_M} meters"}
            )

        q = (params.get("q") or "").strip()
        category = params.get("category")
        sort = params.get("sort") or ("relevance" if len(q) >= 2 else "distance")
        if sort not in ("distance", "relevance"):
            raise ValidationError({"sort": "Expected 'distance' or 'relevance'"})
        try:
            limit = int(params.get("limit", NEARBY_DEFAULT_LIMIT))
        except (TypeError, ValueError):
            limit = NEARBY_DEFAULT_LIMIT
        limit = max(1, min(limit, NEARBY_MAX_LIMIT))

        # A 1-char query mirrors the search endpoint: too short to match.
        if 0 < len(q) < 2:
            return Response({"results": [], "next_cursor": None, "has_more": False})

        # Opaque cursor: keyset position + a hash of the exact filters it was
        # issued for. Mixing cursors between origins/filters is a client bug —
        # reject it instead of returning a silently-wrong page.
        fingerprint = hashlib.sha1(
            json.dumps([lat, lon, radius_m, category, q, sort, limit]).encode()
        ).hexdigest()[:12]
        cursor = params.get("cursor")
        position = None
        if cursor:
            try:
                payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
                position = {
                    "d": float(payload["d"]),
                    "c": uuid.UUID(str(payload["c"])),
                    "r": int(payload["r"]) if sort == "relevance" else None,
                }
            except (ValueError, KeyError, TypeError, binascii.Error):
                raise ValidationError({"cursor": "Malformed cursor"})
            if payload.get("h") != fingerprint:
                raise ValidationError({"cursor": "Cursor does not match the current filters"})

        now = timezone.now()
        origin = GisPoint(lon, lat, srid=4326)
        distance_fn = GisDistanceFunc("location__point", origin)
        base = (
            Placement.objects.filter(eligible_now_q(now))
            .filter(location__point__distance_lte=(origin, D(m=radius_m)))
            .annotate(distance=distance_fn)
        )
        if q:
            base = base.filter(
                Q(campaign__headline__icontains=q) | Q(campaign__body__icontains=q)
            )
        if category:
            base = base.filter(campaign__business__category__slug=category)

        # Nearest eligible placement per campaign. relevance depends only on
        # campaign fields, so the inner order stays (campaign, distance).
        nearest = (
            base.order_by("campaign_id", "distance", "id")
            .distinct("campaign_id")
            .values("id")
        )
        page = (
            Placement.objects.filter(id__in=Subquery(nearest))
            .annotate(distance=distance_fn)
            .select_related(
                "campaign",
                "campaign__business",
                "campaign__business__category",
                "location",
                "location__business",
            )
        )
        if sort == "relevance":
            page = page.annotate(relevance=_campaign_relevance(q))

        order: tuple[str, ...]
        if sort == "relevance":
            order = ("-relevance", "distance", "campaign_id")
            if position:
                page = page.filter(
                    Q(relevance__lt=position["r"])
                    | Q(relevance=position["r"], distance__gt=position["d"])
                    | Q(
                        relevance=position["r"],
                        distance=position["d"],
                        campaign_id__gt=position["c"],
                    )
                )
        else:
            order = ("distance", "campaign_id")
            if position:
                page = page.filter(
                    Q(distance__gt=position["d"])
                    | Q(distance=position["d"], campaign_id__gt=position["c"])
                )
        rows = list(page.order_by(*order)[: limit + 1])
        has_more = len(rows) > limit
        rows = rows[:limit]

        # Eligible branch counts (city-wide) for every campaign on the page:
        # one extra query, not one per card.
        branch_counts = {}
        if rows:
            branch_counts = dict(
                Placement.objects.filter(
                    eligible_now_q(now), campaign_id__in=[p.campaign_id for p in rows]
                )
                .values("campaign_id")
                .annotate(n=Count("id"))
                .values_list("campaign_id", "n")
            )

        data = serializers.PublicNearbyAdSerializer(
            rows, many=True, context={"branch_counts": branch_counts}
        ).data

        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            payload = {
                "h": fingerprint,
                "d": last.distance.m,
                "c": str(last.campaign_id),
            }
            if sort == "relevance":
                payload["r"] = int(getattr(last, "relevance", 0))
            next_cursor = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()

        return Response(
            {"results": data, "next_cursor": next_cursor, "has_more": has_more}
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
