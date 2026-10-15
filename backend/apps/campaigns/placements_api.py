"""Owner-facing placement timeline: where and when a campaign actually runs."""
from django.contrib.auth.models import AnonymousUser
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers
from rest_framework.generics import ListAPIView

from apps.placements.models import Placement


class PlacementSerializer(serializers.ModelSerializer):
    location_name = serializers.CharField(source="location.name", read_only=True)
    location_business = serializers.CharField(source="location.business.name", read_only=True)

    class Meta:
        model = Placement
        fields = (
            "id", "location", "location_name", "location_business",
            "start_at", "end_at", "actual_start_at", "actual_end_at",
            "state", "source_type", "charge_days", "created_at",
        )
        read_only_fields = fields


@extend_schema(tags=["Campaigns"], summary="Placements of an own campaign")
class CampaignPlacementListView(ListAPIView):
    serializer_class = PlacementSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return Placement.objects.none()
        user = self.request.user
        assert not isinstance(user, AnonymousUser)  # IsAuthenticated
        return Placement.objects.filter(
            campaign_id=self.kwargs["id"],
            campaign__business__owner=user,
        ).select_related("location", "location__business").order_by("-start_at")
