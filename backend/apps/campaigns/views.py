from django.contrib.auth.models import AnonymousUser
from django.db.models import Count, Min, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import (
    ListAPIView,
    ListCreateAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.moderation.services import ModerationError, submit_for_review
from apps.placements.models import eligible_now_q

from .models import Campaign, CampaignReview
from .serializers import CampaignReviewSerializer, CampaignSerializer


def with_live_annotation(qs):
    """Annotate the count of CURRENTLY eligible placements so the cabinet can
    show publication state (live or not) separately from review status
    (spec §7: approved ≠ live)."""
    now = timezone.now()
    upcoming = Q(placements__state__in=("scheduled", "active")) & Q(
        placements__end_at__gt=now
    )
    return qs.annotate(
        active_placements_count=Count(
            "placements",
            filter=eligible_now_q(now, prefix="placements__"),
            distinct=True,
        ),
        next_interval_start=Min("placements__start_at", filter=upcoming),
        next_interval_end=Min("placements__end_at", filter=upcoming),
    )


class CampaignListCreateView(ListCreateAPIView):
    serializer_class = CampaignSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return Campaign.objects.none()
        user = self.request.user
        assert not isinstance(user, AnonymousUser)  # IsAuthenticated
        qs = (
            Campaign.objects.filter(business__owner=user)
            .select_related("business", "business__category")
            .order_by("-created_at")
        )
        business_id = self.request.query_params.get("business")
        if business_id:
            qs = qs.filter(business_id=business_id)
        return with_live_annotation(qs)


@extend_schema_view(
    get=extend_schema(tags=["Campaigns"], summary="Own campaign details"),
    patch=extend_schema(tags=["Campaigns"], summary="Edit draft/rejected campaign"),
)
class CampaignDetailView(RetrieveUpdateDestroyAPIView):
    serializer_class = CampaignSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "delete", "head", "options"]
    lookup_url_kwarg = "id"

    def get_queryset(self):
        user = self.request.user
        assert not isinstance(user, AnonymousUser)  # IsAuthenticated
        return with_live_annotation(
            Campaign.objects.filter(business__owner=user).select_related(
                "business"
            )
        )

    def perform_destroy(self, instance):
        # Drafts only: a draft was never submitted, so it has no reviews and
        # no orders (both FKs are PROTECT as a second guard). Anything past
        # draft must not vanish — spec §7.1 keeps moderation/financial records
        # and routes advertiser cancellation through the refund flow instead.
        if instance.review_status != Campaign.ReviewStatus.DRAFT:
            raise ValidationError(
                {"detail": "Only draft campaigns can be deleted"}, code="not_draft"
            )
        instance.delete()


@extend_schema_view(
    post=extend_schema(tags=["Campaigns"],
                       summary="Submit campaign for moderation",
                       description="draft/rejected -> submitted. Payment happens "
                                   "separately via /orders/quote + /orders/{id}/checkout.",
                       request=None, responses=CampaignSerializer)
)
class CampaignSubmitView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        campaign = (
            Campaign.objects.filter(pk=id, business__owner=request.user).first()
        )
        if campaign is None:
            return Response(
                {"error": {"code": "not_found", "message": "Campaign not found", "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            submit_for_review(campaign=campaign)
        except ModerationError as exc:
            return Response(
                {"error": {"code": "invalid_transition", "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(CampaignSerializer(campaign).data)


@extend_schema_view(
    get=extend_schema(tags=["Campaigns"], summary="Moderation decisions for an own campaign",
                      description="Immutable review history (spec §5); newest first. "
                                  "Rejection reasons drive the correction/resubmission flow.")
)
class CampaignReviewListView(ListAPIView):
    serializer_class = CampaignReviewSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return CampaignReview.objects.none()
        user = self.request.user
        assert not isinstance(user, AnonymousUser)  # IsAuthenticated
        return (
            CampaignReview.objects.filter(
                campaign__id=self.kwargs["id"],
                campaign__business__owner=user,
            )
            .select_related("campaign")
            .order_by("-created_at")[:20]
        )
