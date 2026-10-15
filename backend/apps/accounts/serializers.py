from rest_framework import serializers


class OTPRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=24)


class OTPVerifySerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=24)
    code = serializers.CharField(max_length=8)


class PhoneChangeRequestSerializer(serializers.Serializer):
    new_phone = serializers.CharField(max_length=24)


class PhoneChangeVerifySerializer(serializers.Serializer):
    new_phone = serializers.CharField(max_length=24)
    code = serializers.CharField(max_length=8)


class OTPAcceptedSerializer(serializers.Serializer):
    """Uniform 202 body for OTP requests (anti-enumeration)."""

    detail = serializers.CharField(read_only=True)
    dev_code = serializers.CharField(
        read_only=True, required=False,
        help_text="Dev/test stacks only (fake SMS + OTP_DEV_ECHO); never present in prod.",
    )


class SessionUserSerializer(serializers.Serializer):
    """Response payload describing the authenticated user."""

    id = serializers.UUIDField(read_only=True)
    phone_e164 = serializers.CharField(read_only=True)
    is_staff = serializers.BooleanField(read_only=True)
