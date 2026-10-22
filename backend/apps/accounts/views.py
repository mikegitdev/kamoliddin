import hmac
import logging

from django.conf import settings
from django.contrib.auth import login
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.serializers import DetailSerializer

from . import telegram as telegram_transport
from .serializers import (
    OTPAcceptedSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    PhoneChangeRequestSerializer,
    PhoneChangeVerifySerializer,
    SessionUserSerializer,
    TelegramLinkSerializer,
    TelegramStatusSerializer,
)
from .services import (
    _TELEGRAM_REPLIES,
    OTPError,
    PhoneTakenError,
    bind_telegram_chat,
    complete_phone_change,
    delete_account,
    request_otp,
    request_phone_change,
    telegram_link_for,
    unbind_telegram,
    unbind_telegram_chat,
    verify_otp,
)

logger = logging.getLogger(__name__)


def _accepted_response(detail: str, challenge) -> Response:
    """Uniform 202; on dev/test stacks also echoes the OTP (services.py gates
    the echo on the fake provider + OTP_DEV_ECHO — never in prod)."""
    payload = {"detail": detail}
    dev_code = getattr(challenge, "dev_code", None)
    if dev_code:
        payload["dev_code"] = dev_code
    return Response(payload, status=status.HTTP_202_ACCEPTED)


@extend_schema_view(
    post=extend_schema(
        tags=["Auth"],
        summary="Request a phone OTP",
        description="Rate-limited. Always returns the same shape whether or not "
        "the phone number is known (anti-enumeration).",
        request=OTPRequestSerializer,
        responses={202: OTPAcceptedSerializer},
    )
)
class OTPRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "otp"

    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = request_otp(
                serializer.validated_data["phone"],
                channel=serializer.validated_data["channel"],
            )
        except (OTPError, ValueError):
            # Generic response; never reveal phone existence or throttle internals.
            return _accepted_response(
                "If the number is valid, an SMS code has been sent.", None
            )
        return _accepted_response(
            "If the number is valid, an SMS code has been sent.", challenge
        )


@extend_schema_view(
    post=extend_schema(tags=["Auth"], summary="Verify OTP and open a session",
                       request=OTPVerifySerializer, responses={200: SessionUserSerializer})
)
class OTPVerifyView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "otp"

    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = verify_otp(serializer.validated_data["phone"], serializer.validated_data["code"])
        except (OTPError, ValueError) as exc:
            return Response(
                {"error": {"code": "invalid_otp", "message": str(exc) or "Invalid or expired code.",
                           "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        login(request, user)  # secure HttpOnly session cookie
        return Response(SessionUserSerializer(user).data)


@extend_schema_view(
    post=extend_schema(tags=["Auth"], summary="Terminate the current session",
                       request=None, responses={204: None})
)
class LogoutView(APIView):
    def post(self, request):
        request.session.flush()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema_view(
    get=extend_schema(tags=["Auth"], summary="Set the CSRF cookie",
                      responses={200: DetailSerializer})
)
@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """GET /auth/csrf — ensures the csrftoken cookie exists so the SPA can send
    X-CSRFToken on authenticated mutations (spec §9)."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({"detail": "CSRF cookie set"})


@extend_schema_view(
    get=extend_schema(tags=["Auth"], summary="Current session user",
                      responses={200: SessionUserSerializer}),
    delete=extend_schema(tags=["Auth"], summary="Delete own account (soft)",
                         description="Anonymizes the phone and disables owned businesses; "
                                     "financial records are retained "
                                     "(spec §14). Terminates the session.",
                         responses={204: None}),
)
class MeView(APIView):
    def get(self, request):
        return Response(SessionUserSerializer(request.user).data)

    def delete(self, request):
        delete_account(request.user)
        request.session.flush()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema_view(
    get=extend_schema(tags=["Auth"], summary="Telegram binding status",
                      responses=TelegramStatusSerializer),
    post=extend_schema(
        tags=["Auth"],
        summary="Get a Telegram enrollment link",
        description="Returns a one-time t.me deep link; the binding completes "
                    "when the user taps Start and the bot webhook resolves the "
                    "signed token (ADR-0006).",
        responses={202: TelegramLinkSerializer},
    ),
    delete=extend_schema(tags=["Auth"], summary="Unlink Telegram",
                         description="Login codes go back to SMS only.",
                         responses={204: None}),
)
class TelegramBindView(APIView):
    """Enrollment management for Telegram OTP delivery (authenticated)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"bound": request.user.telegram_chat_id is not None})

    def post(self, request):
        if request.user.telegram_chat_id is not None:
            return Response(
                {"error": {"code": "telegram_bound",
                           "message": "Telegram is already linked to this account.",
                           "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        link = telegram_link_for(request.user)
        if link is None:
            return Response(
                {"error": {"code": "telegram_disabled",
                           "message": "Telegram delivery is not configured.",
                           "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "detail": "Open the link in Telegram and tap Start to finish linking.",
                "link": link,
                "bot_username": settings.TELEGRAM_BOT_USERNAME,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    def delete(self, request):
        unbind_telegram(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema_view(
    post=extend_schema(
        tags=["Auth"],
        summary="Telegram bot webhook",
        description="Bot API update endpoint. Gated on the setWebhook "
                    "secret_token header; handles /start enrollment and "
                    "my_chat_member block events (ADR-0006).",
        request=None,
        responses={200: None},
    ),
)
class TelegramWebhookView(APIView):
    """Server-to-server Bot API updates: no session, no throttle (the secret
    header is the gate; IP throttling would drop legitimate Telegram bursts).
    Always 200 — an error status makes Telegram retry the update."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes: list = []

    def post(self, request):
        secret = settings.TELEGRAM_WEBHOOK_SECRET
        header = request.headers.get(telegram_transport.WEBHOOK_HEADER, "")
        if not secret or not hmac.compare_digest(header, secret):
            return Response(status=status.HTTP_403_FORBIDDEN)
        try:
            self._handle(request.data)
        except Exception:
            logger.exception("Telegram webhook handling failed")
        return Response(status=status.HTTP_200_OK)

    def _handle(self, update: dict) -> None:
        message = update.get("message") or {}
        chat = message.get("chat") or {}
        chat_id = chat.get("id")
        text = str(message.get("text") or "").strip()
        if chat_id and text.startswith("/start"):
            token = text.split(" ", 1)[1].strip() if " " in text else ""
            outcome = bind_telegram_chat(token, int(chat_id))
            self._reply(chat_id, _TELEGRAM_REPLIES[outcome])
            return
        member = update.get("my_chat_member") or {}
        member_status = (member.get("new_chat_member") or {}).get("status")
        member_chat_id = (member.get("chat") or {}).get("id")
        if member_chat_id and member_status == "kicked":
            # User blocked the bot — stop delivering codes to that chat.
            unbind_telegram_chat(int(member_chat_id))

    def _reply(self, chat_id: int, text: str) -> None:
        try:
            telegram_transport.get_telegram_adapter().send_message(
                chat_id=chat_id, text=text, request_id="webhook"
            )
        except Exception:
            logger.exception("Telegram webhook reply failed (chat=%s)", chat_id)


@extend_schema_view(
    post=extend_schema(
        tags=["Auth"],
        summary="Request a phone-change code (sent to the NEW phone)",
        description="Rate-limited. Always returns the same shape whether or not "
                    "the new phone is available (anti-enumeration, spec §9).",
        request=PhoneChangeRequestSerializer,
        responses={202: OTPAcceptedSerializer},
    )
)
class PhoneChangeRequestView(APIView):
    throttle_scope = "otp"

    def post(self, request):
        serializer = PhoneChangeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = request_phone_change(request.user, serializer.validated_data["new_phone"])
        except ValueError:
            return Response(
                {"error": {"code": "invalid_phone", "message": "Invalid Uzbek phone number.",
                           "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except OTPError:
            challenge = None  # taken/blocked/throttled — uniform response
        return _accepted_response(
            "If the number is available, a code has been sent to it.", challenge
        )


@extend_schema_view(
    post=extend_schema(tags=["Auth"], summary="Verify phone-change code and switch phone",
                       request=PhoneChangeVerifySerializer,
                       responses={200: SessionUserSerializer}),
)
class PhoneChangeVerifyView(APIView):
    throttle_scope = "otp"

    def post(self, request):
        serializer = PhoneChangeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = complete_phone_change(
                request.user,
                serializer.validated_data["new_phone"],
                serializer.validated_data["code"],
            )
        except ValueError:
            return Response(
                {"error": {"code": "invalid_phone", "message": "Invalid Uzbek phone number.",
                           "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except PhoneTakenError as exc:
            return Response(
                {"error": {"code": "phone_in_use", "message": str(exc), "fields": {}}},
                status=status.HTTP_409_CONFLICT,
            )
        except OTPError as exc:
            return Response(
                {"error": {"code": "invalid_otp", "message": str(exc) or "Invalid or expired code.",
                           "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(SessionUserSerializer(user).data)
