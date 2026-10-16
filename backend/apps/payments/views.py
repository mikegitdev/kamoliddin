"""Provider webhook endpoints (spec §12).

Each webhook: authenticate/verify via the provider gateway, deduplicate on
(provider, event_id), verify amount/currency against the order, then hand off
to the transactional settlement service (order -> paid, entitlement activation).
Only the fake provider is wired; CLICK returns 503 until its gateway is
implemented and verified (spec §19 [E]).
"""
import json
import logging

from django.conf import settings
from django.db import transaction
from django.http import Http404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import Order

from .gateways import WebhookResult, get_payment_gateway
from .models import PaymentAttempt, PaymentEvent
from .settlement import settle_payment_attempt

logger = logging.getLogger(__name__)


def _apply_verified_event(provider: str, result: WebhookResult) -> Response:
    """Idempotently record a verified event and settle its payment attempt."""
    with transaction.atomic():
        event, created = PaymentEvent.objects.get_or_create(
            provider=provider,
            event_id=result.event_id,
            defaults={"validated_payload_digest": result.raw_digest},
        )
        event = PaymentEvent.objects.select_for_update().get(pk=event.pk)
        # Unknown/mismatched callbacks stay unlinked so the same provider event
        # can be retried after the attempt is visible or the payload is corrected.
        if not created and event.payment_attempt_id is not None:
            return Response({"detail": "duplicate event ignored"})

        attempt = (
            PaymentAttempt.objects.select_for_update()
            .filter(provider=provider, provider_payment_id=result.provider_payment_id)
            .first()
        )
        if attempt is None:
            logger.warning(
                "Webhook for unknown payment %s:%s", provider, result.provider_payment_id
            )
            return Response({"detail": "recorded"})
        if attempt.amount != result.amount_minor or attempt.order.currency != result.currency:
            logger.error(
                "Webhook amount/currency mismatch for attempt %s: got %s %s, expected %s %s",
                attempt.id, result.amount_minor, result.currency,
                attempt.amount, attempt.order.currency,
            )
            return Response({"detail": "recorded"})

        event.payment_attempt = attempt
        event.validated_payload_digest = result.raw_digest
        event.save(update_fields=["payment_attempt", "validated_payload_digest"])

        # SUCCEEDED is terminal: a late/out-of-order failure callback must never
        # fail a settled order or release its placements (money already moved).
        if attempt.status == PaymentAttempt.Status.SUCCEEDED and not result.succeeded:
            logger.warning(
                "Ignoring failure event %s for already-succeeded attempt %s",
                result.event_id, attempt.id,
            )
            return Response({"detail": "ignored: attempt already succeeded"})

        attempt.status = (
            PaymentAttempt.Status.SUCCEEDED
            if result.succeeded
            else PaymentAttempt.Status.FAILED
        )
        attempt.response_digest = result.raw_digest
        attempt.save(update_fields=["status", "response_digest", "updated_at"])

        order = attempt.order
        if attempt.status == PaymentAttempt.Status.FAILED and order.state != Order.State.PAID:
            # Spec §7.2: a permanently failed payment fails the order and
            # releases its capacity reservations (ADR-0003) — no squatting.
            order.state = Order.State.FAILED
            order.save(update_fields=["state", "updated_at"])
            from apps.placements.services import release_order_reservations

            release_order_reservations(order)

    if attempt.status == PaymentAttempt.Status.SUCCEEDED:
        order_state = settle_payment_attempt(attempt.id)
        return Response({"detail": "processed", "order_state": order_state})
    return Response({"detail": "processed"})


class ProviderWebhookView(APIView):
    """POST /api/v1/payments/{provider}/webhook — provider-initiated callbacks."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        tags=["Payments"],
        summary="Provider payment callback",
        description="Body is provider-specific and verified by the provider gateway.",
        request={"application/json": OpenApiTypes.OBJECT},
        responses=inline_serializer("WebhookAck", fields={
            "detail": serializers.CharField(),
            "order_state": serializers.CharField(required=False),
        }),
    )
    def post(self, request: Request, provider: str):
        # The fake gateway verifies nothing: accept its webhooks only on stacks
        # actually configured for it (dev/test), never next to a real provider.
        if provider == "fake" and settings.PAYMENT_PROVIDER != "fake":
            raise Http404
        try:
            gateway = get_payment_gateway(provider)
        except (LookupError, NotImplementedError) as exc:
            logger.warning("Webhook rejected for provider %r: %s", provider, exc)
            return Response(
                {"error": {"code": "provider_unavailable", "message": str(exc), "fields": {}}},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            result = gateway.verify_webhook(payload=request.body, headers=dict(request.headers))
        except (ValueError, KeyError, TypeError) as exc:  # malformed body (incl. bad JSON)
            logger.warning("Malformed webhook payload for provider %r: %s", provider, exc)
            return Response(
                {"error": {"code": "invalid_payload", "message": "Malformed webhook payload",
                           "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return _apply_verified_event(provider, result)


class FakeCheckoutCompleteView(APIView):
    """Dev-only simulation of a successful provider callback for the fake gateway."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(exclude=True)
    def post(self, request, provider_payment_id: str):
        if settings.PAYMENT_PROVIDER != "fake":
            raise Http404
        attempt =PaymentAttempt.objects.filter(
            provider="fake", provider_payment_id=provider_payment_id
        ).first()
        if attempt is None:
            raise Http404
        event = {
            "event_id": f"evt-{provider_payment_id}",
            "provider_payment_id": provider_payment_id,
            "amount_minor": attempt.amount,
            "currency": attempt.order.currency,
            "succeeded": True,
        }
        payload = json.dumps(event).encode()
        result = get_payment_gateway("fake").verify_webhook(payload=payload, headers={})
        return _apply_verified_event("fake", result)
