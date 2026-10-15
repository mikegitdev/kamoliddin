"""Schema-only response shapes shared across apps (OpenAPI documentation)."""
from rest_framework import serializers


class DetailSerializer(serializers.Serializer):
    """Plain acknowledgement body: {"detail": "..."}."""

    detail = serializers.CharField(read_only=True)
