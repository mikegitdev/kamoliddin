from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import permissions, serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Order
from .serializers import (
    CheckoutRequestSerializer,
    OrderDetailSerializer,
    OrderSerializer,
    QuoteRequestSerializer,
)
from .services import (
    CheckoutError,
    RefundError,
    create_checkout,
    create_quote,
    request_refund,
)


class OrderListView(ListAPIView):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return (
            Order.objects.filter(business__owner=self.request.user)
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
            Order.objects.filter(business__owner=self.request.user)
            .select_related("business", "campaign")
            .prefetch_related("items__location", "attempts", "refunds")
        )


@extend_schema_view(
    post=extend_schema(
        tags=["Orders"],
        summary="Price quote for dates and branches",
        description="Server-side pricing with immutable snapshot (spec §6, §12). "
                    "Response is the draft quote order; the frontend never sets prices.",
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
                auto_renew=serializer.validated_data["auto_renew"],
            )
        except PermissionDenied:
            raise
        except CheckoutError as exc:
            raise ValidationError(str(exc))
        data = OrderSerializer(order).data
        data["quote_id"] = str(order.id)
        return Response(data, status=status.HTTP_201_CREATED)


@extend_schema_view(
    post=extend_schema(tags=["Orders"], summary="Create idempotent provider checkout")
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
                {"error": {"code": "checkout_error", "message": str(exc), "fields": {}}},
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
                       summary="Request a refund for a rejected/suspended paid order")
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
                {"error": {"code": "refund_error", "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            {"id": str(refund.id), "state": refund.state, "amount": refund.amount},
            status=status.HTTP_201_CREATED,
        )
