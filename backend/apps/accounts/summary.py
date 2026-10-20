"""Owner dashboard summary: one call behind the cabinet overview (spec §13)."""
from datetime import timedelta

from django.db.models import Count, Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import Order
from apps.campaigns.models import Campaign
from apps.placements.models import Placement

EXPIRING_WINDOW = timedelta(hours=48)


class _ExpiringPlacementSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    campaign_id = serializers.UUIDField()
    headline = serializers.CharField()
    location = serializers.CharField()
    ends_at = serializers.DateTimeField()


class _SpendSerializer(serializers.Serializer):
    total = serializers.IntegerField(help_text="Minor units (tiyin)")
    month = serializers.IntegerField(help_text="Minor units (tiyin)")
    currency = serializers.CharField()


class MeSummarySerializer(serializers.Serializer):
    """Response shape of GET /auth/me/summary (schema documentation only)."""

    campaigns = serializers.DictField(
        child=serializers.IntegerField(), help_text="Campaign count per review status"
    )
    active_placements = serializers.IntegerField()
    expiring_soon = _ExpiringPlacementSerializer(many=True)
    spend = _SpendSerializer()


class MeSummaryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(tags=["Auth"], summary="Owner dashboard summary",
                   responses=MeSummarySerializer)
    def get(self, request):
        owner = request.user
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        campaigns = Campaign.objects.filter(business__owner=owner)
        by_status = dict.fromkeys(
            (s for s, _ in Campaign.ReviewStatus.choices), 0
        )
        for row in campaigns.values("review_status").annotate(n=Count("id")):
            by_status[row["review_status"]] = row["n"]

        placements = Placement.objects.filter(
            campaign__business__owner=owner
        ).select_related("campaign", "location")

        active = placements.filter(state=Placement.State.ACTIVE, end_at__gt=now)
        expiring = (
            active.filter(end_at__lte=now + EXPIRING_WINDOW)
            .order_by("end_at")
            .values("id", "campaign_id", "campaign__headline", "location__name",
                    "end_at")[:10]
        )

        paid = Order.objects.filter(business__owner=owner, state=Order.State.PAID)
        total_spent = paid.aggregate(s=Sum("amount_total"))["s"] or 0
        month_spent = (
            paid.filter(created_at__gte=month_start).aggregate(s=Sum("amount_total"))["s"]
            or 0
        )

        return Response({
            "campaigns": by_status,
            "active_placements": active.count(),
            "expiring_soon": [
                {
                    "id": p["id"],
                    "campaign_id": p["campaign_id"],
                    "headline": p["campaign__headline"],
                    "location": p["location__name"],
                    "ends_at": p["end_at"],
                }
                for p in expiring
            ],
            "spend": {"total": total_spent, "month": month_spent, "currency": "UZS"},
        })
