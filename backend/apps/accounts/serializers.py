from rest_framework import serializers


class OTPRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=24)


class OTPVerifySerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=24)
    code = serializers.CharField(max_length=8)


class SessionUserSerializer(serializers.Serializer):
    """Response payload describing the authenticated user."""

    id = serializers.UUIDField(read_only=True)
    phone_e164 = serializers.CharField(read_only=True)
    is_staff = serializers.BooleanField(read_only=True)
