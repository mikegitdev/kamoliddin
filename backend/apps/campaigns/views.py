from django.contrib.auth.models import AnonymousUser
from django.db.models import Count, Exists, Min, OuterRef, Q, Subquery
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import permissions, serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import (
    ListAPIView,
    ListCreateAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.moderation.services import ModerationError, submit_for_review
from apps.placements.models import Placement, eligible_now_q

from .models import Campaign, CampaignEvent, CampaignOutcome, CampaignReview
from .serializers import CampaignReviewSerializer, CampaignSerializer


def with_live_annotation(qs):
    """Annotate the count of CURRENTLY eligible placements so the cabinet can
    show publication state (live or not) separately from review status
    (spec §7: approved ≠ live)."""
    now = timezone.now()
    upcoming = Q(placements__state__in=("scheduled", "active")) & Q(
        placements__end_at__gt=now
    )
    # Outcome-survey state (Joymee borrow #8), as subqueries so lists stay
    # N+1-free: the recorded answer, and whether the campaign is ASKABLE —
    # it ran at least once and nothing is pending/scheduled/active anymore.
    outcome_answer = Subquery(
        CampaignOutcome.objects.filter(campaign=OuterRef("pk")).values("answer")[:1]
    )
    ever_ran = Exists(Placement.objects.filter(campaign=OuterRef("pk")))
    still_running = Exists(
        Placement.objects.filter(
            campaign=OuterRef("pk"),
            state__in=(Placement.State.PENDING, Placement.State.SCHEDULED,
                       Placement.State.ACTIVE),
        )
    )
    return qs.annotate(
        active_placements_count=Count(
            "placements",
            filter=eligible_now_q(now, prefix="placements__"),
            distinct=True,
        ),
        next_interval_start=Min("placements__start_at", filter=upcoming),
        next_interval_end=Min("placements__end_at", filter=upcoming),
        views_count=Count("events", filter=Q(events__kind=CampaignEvent.Kind.VIEW), distinct=True),
        contact_clicks_count=Count(
            "events", filter=Q(events__kind=CampaignEvent.Kind.CONTACT), distinct=True
        ),
        outcome_answer=outcome_answer,
        outcome_ever_ran=ever_ran,
        outcome_still_running=still_running,
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
            submit_for_review(campaign=campaign, actor=request.user)
        except ModerationError as exc:
            return Response(
                {"error": {"code": "invalid_transition", "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(CampaignSerializer(campaign).data)


class OutcomeRequestSerializer(serializers.Serializer):
    """Joymee's 'did it work?' survey — asked once, campaign over."""

    answer = serializers.ChoiceField(choices=CampaignOutcome.Answer.choices)
    comment = serializers.CharField(max_length=500, required=False, allow_blank=True,
                                    default="")


@extend_schema_view(
    post=extend_schema(
        tags=["Campaigns"],
        summary="Record the post-campaign outcome survey",
        description="Asked once per campaign after every placement has ended "
                    "(Joymee's 'were you able to sell?' loop). Immutable once "
                    "answered; a second answer is refused.",
        request=OutcomeRequestSerializer,
        responses=CampaignSerializer,
    )
)
class CampaignOutcomeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        body = OutcomeRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        campaign = Campaign.objects.filter(pk=id, business__owner=request.user).first()
        if campaign is None:
            return Response(
                {"error": {"code": "not_found", "message": "Campaign not found", "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        if CampaignOutcome.objects.filter(campaign=campaign).exists():
            return Response(
                {"error": {"code": "already_answered",
                           "message": "The outcome was already recorded for this campaign",
                           "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        still_running = Placement.objects.filter(
            campaign=campaign,
            state__in=(Placement.State.PENDING, Placement.State.SCHEDULED,
                       Placement.State.ACTIVE),
        ).exists()
        ran = Placement.objects.filter(campaign=campaign).exists()
        if ran is False or still_running:
            return Response(
                {"error": {"code": "not_ended",
                           "message": "The survey opens after all placements of this "
                                      "campaign have ended",
                           "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        CampaignOutcome.objects.create(
            campaign=campaign,
            answer=body.validated_data["answer"],
            comment=body.validated_data["comment"],
        )
        # Detail payload re-uses the annotated queryset so the response
        # carries the fresh outcome fields.
        fresh = with_live_annotation(
            Campaign.objects.filter(pk=campaign.pk).select_related("business")
        ).first()
        return Response(CampaignSerializer(fresh).data)


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
