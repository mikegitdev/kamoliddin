from django.contrib.auth.models import AnonymousUser
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import permissions, status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RenewalAgreement
from .serializers import RenewalAgreementSerializer, RenewalEnableSerializer
from .services import RenewalTermEnded, cancel_agreement, enable_agreement


class RenewalListView(ListAPIView):
    serializer_class = RenewalAgreementSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return RenewalAgreement.objects.none()
        user = self.request.user
        assert not isinstance(user, AnonymousUser)  # IsAuthenticated
        return (
            RenewalAgreement.objects.filter(business__owner=user)
            .select_related("business", "campaign")
            .order_by("-created_at")
        )


@extend_schema_view(
    post=extend_schema(tags=["Renewals"], summary="Re-enable explicit recurrence",
                       request=RenewalEnableSerializer,
                       responses=RenewalAgreementSerializer)
)
class RenewalEnableView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = RenewalEnableSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            agreement = enable_agreement(
                user=request.user, agreement_id=serializer.validated_data["agreement_id"]
            )
        except LookupError:
            return Response(
                {"error": {"code": "not_found", "message": "Renewal agreement not found",
                           "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        except RenewalTermEnded as exc:
            return Response(
                {"error": {"code": "renewal_term_ended", "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        except ValueError as exc:  # pending provider token — cannot enable yet
            return Response(
                {"error": {"code": "renewal_unavailable", "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(RenewalAgreementSerializer(agreement).data)


@extend_schema_view(
    post=extend_schema(tags=["Renewals"],
                       summary="Disable future charge attempts (paid time remains)",
                       request=None, responses=RenewalAgreementSerializer)
)
class RenewalCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        try:
            agreement = cancel_agreement(user=request.user, agreement_id=id)
        except LookupError:
            return Response(
                {"error": {"code": "not_found", "message": "Renewal agreement not found",
                           "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(RenewalAgreementSerializer(agreement).data)
