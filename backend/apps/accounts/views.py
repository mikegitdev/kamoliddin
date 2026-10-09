from django.contrib.auth import login
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import OTPRequestSerializer, OTPVerifySerializer, SessionUserSerializer
from .services import OTPError, request_otp, verify_otp


@extend_schema_view(
    post=extend_schema(
        tags=["Auth"],
        summary="Request a phone OTP",
        description="Rate-limited. Always returns the same shape whether or not "
        "the phone number is known (anti-enumeration).",
        responses={202: None},
    )
)
class OTPRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "otp"

    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            ip = request.META.get("REMOTE_ADDR", "")
            request_otp(serializer.validated_data["phone"], ip=ip)
        except (OTPError, ValueError):
            # Generic response; never reveal phone existence or throttle internals.
            return Response({"detail": "If the number is valid, an SMS code has been sent."},
                            status=status.HTTP_202_ACCEPTED)
        return Response({"detail": "If the number is valid, an SMS code has been sent."},
                        status=status.HTTP_202_ACCEPTED)


@extend_schema_view(
    post=extend_schema(tags=["Auth"], summary="Verify OTP and open a session",
                       responses={200: SessionUserSerializer})
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
                      responses={204: None})
)
class LogoutView(APIView):
    def post(self, request):
        request.session.flush()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
                      responses={200: SessionUserSerializer})
)
class MeView(APIView):
    def get(self, request):
        return Response(SessionUserSerializer(request.user).data)
