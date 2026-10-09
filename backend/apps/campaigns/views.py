from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import permissions, status
from rest_framework.generics import ListCreateAPIView, RetrieveUpdateAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.moderation.services import ModerationError, submit_for_review

from .models import Campaign
from .serializers import CampaignSerializer


class CampaignListCreateView(ListCreateAPIView):
    serializer_class = CampaignSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = (
            Campaign.objects.filter(business__owner=self.request.user)
            .select_related("business", "business__category")
            .order_by("-created_at")
        )
        business_id = self.request.query_params.get("business")
        if business_id:
            qs = qs.filter(business_id=business_id)
        return qs


@extend_schema_view(
    get=extend_schema(tags=["Campaigns"], summary="Own campaign details"),
    patch=extend_schema(tags=["Campaigns"], summary="Edit draft/rejected campaign"),
)
class CampaignDetailView(RetrieveUpdateAPIView):
    serializer_class = CampaignSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "head", "options"]
    lookup_url_kwarg = "id"

    def get_queryset(self):
        return Campaign.objects.filter(business__owner=self.request.user).select_related(
            "business"
        )


@extend_schema_view(
    post=extend_schema(tags=["Campaigns"],
                       summary="Submit campaign for moderation",
                       description="draft/rejected -> submitted. Payment happens "
                                   "separately via /orders/quote + /orders/{id}/checkout.")
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
