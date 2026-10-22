from rest_framework import serializers


class OTPRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=24)
    channel = serializers.ChoiceField(
        choices=("auto", "sms"), default="auto", required=False,
        help_text="auto prefers the enrolled Telegram chat and falls back to SMS; "
                  "sms always uses SMS",
    )


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


class TelegramStatusSerializer(serializers.Serializer):
    bound = serializers.BooleanField(
        read_only=True, help_text="Whether login codes are delivered to Telegram"
    )


class TelegramLinkSerializer(serializers.Serializer):
    """One-time enrollment deep link (ADR-0006)."""

    detail = serializers.CharField(read_only=True)
    link = serializers.CharField(read_only=True)
    bot_username = serializers.CharField(read_only=True)
