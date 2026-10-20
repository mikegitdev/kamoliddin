from django.contrib.auth import login
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.serializers import DetailSerializer

from .serializers import (
    OTPAcceptedSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    PhoneChangeRequestSerializer,
    PhoneChangeVerifySerializer,
    SessionUserSerializer,
)
from .services import (
    OTPError,
    PhoneTakenError,
    complete_phone_change,
    delete_account,
    request_otp,
    request_phone_change,
    verify_otp,
)


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
            challenge = request_otp(serializer.validated_data["phone"])
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
