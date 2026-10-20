from django.contrib.auth.models import AnonymousUser
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import permissions, serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import Order
from .serializers import (
    CheckoutRequestSerializer,
    CheckoutResponseSerializer,
    OrderDetailSerializer,
    OrderSerializer,
    QuoteRequestSerializer,
    QuoteSerializer,
    RefundRequestResultSerializer,
)
from .services import (
    CheckoutError,
    RefundError,
    create_checkout,
    create_quote,
    request_refund,
)


def _owner(request) -> User:
    """IsAuthenticated views: narrow request.user to User for queryset lookups
    (mypy; AnonymousUser is impossible behind the permission class)."""
    user = request.user
    assert not isinstance(user, AnonymousUser)
    return user


class OrderListView(ListAPIView):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return Order.objects.none()
        return (
            Order.objects.filter(business__owner=_owner(self.request))
            .select_related("business", "campaign")
            .prefetch_related("items__location")
            .order_by("-created_at")
        )


@extend_schema_view(
    get=extend_schema(tags=["Orders"], summary="Own order/payment status")
)
class OrderDetailView(RetrieveAPIView):
    serializer_class = OrderDetailSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_url_kwarg = "id"

    def get_queryset(self):
        return (
            Order.objects.filter(business__owner=_owner(self.request))
            .select_related("business", "campaign")
            .prefetch_related("items__location", "attempts", "refunds")
        )


@extend_schema_view(
    post=extend_schema(
        tags=["Orders"],
        summary="Price quote for dates and branches",
        description="Server-side pricing with immutable snapshot (spec §6, §12). "
                    "Response is the draft quote order; the frontend never sets prices.",
        request=QuoteRequestSerializer,
        responses={201: QuoteSerializer},
    )
)
class QuoteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = QuoteRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            order = create_quote(
                user=request.user,
                business_id=serializer.validated_data["business_id"],
                campaign_id=serializer.validated_data["campaign_id"],
                location_ids=serializer.validated_data["location_ids"],
                requested_start_at=serializer.validated_data["requested_start_at"],
                requested_end_at=serializer.validated_data["requested_end_at"],
            )
        except PermissionDenied:
            raise
        except ValueError as exc:  # e.g. no active tariff configured
            raise ValidationError(str(exc), code="quote_unavailable")
        return Response(QuoteSerializer(order).data, status=status.HTTP_201_CREATED)


@extend_schema_view(
    post=extend_schema(tags=["Orders"], summary="Create idempotent provider checkout",
                       request=CheckoutRequestSerializer,
                       responses=CheckoutResponseSerializer)
)
class CheckoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        serializer = CheckoutRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            attempt, redirect_url = create_checkout(
                user=request.user,
                order_id=id,
                return_url=serializer.validated_data["return_url"],
            )
        except PermissionDenied:
            raise
        except CheckoutError as exc:
            return Response(
                {"error": {"code": exc.code, "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            {
                "order_id": str(attempt.order_id),
                "provider": attempt.provider,
                "provider_payment_id": attempt.provider_payment_id,
                "amount_minor": attempt.amount,
                "currency": attempt.order.currency,
                "redirect_url": redirect_url,
                "order_state": attempt.order.state,
            }
        )


class RefundRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)


@extend_schema_view(
    post=extend_schema(tags=["Orders"],
                       summary="Request a refund for a rejected/suspended paid order",
                       request=RefundRequestSerializer,
                       responses={201: RefundRequestResultSerializer})
)
class RefundRequestView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        serializer = RefundRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            refund = request_refund(
                user=request.user,
                order_id=id,
                reason=serializer.validated_data["reason"],
            )
        except PermissionDenied:
            raise
        except RefundError as exc:
            return Response(
                {"error": {"code": exc.code, "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            {"id": str(refund.id), "state": refund.state, "amount": refund.amount},
            status=status.HTTP_201_CREATED,
        )
