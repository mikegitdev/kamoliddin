from django.utils.text import slugify
from rest_framework import serializers

from .models import Business, BusinessCategory


class BusinessSerializer(serializers.ModelSerializer):
    category = serializers.SlugRelatedField(
        slug_field="slug",
        queryset=BusinessCategory.objects.filter(active=True),
    )
    owner_phone = serializers.CharField(source="owner.phone_e164", read_only=True)

    class Meta:
        model = Business
        fields = (
            "id", "name", "slug", "category", "owner_phone", "logo_key", "description",
            "phone", "telegram", "whatsapp", "site", "status", "created_at", "updated_at",
        )
        read_only_fields = ("id", "slug", "status", "created_at", "updated_at", "owner_phone")

    def validate_name(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Name cannot be empty")
        return value.strip()

    def create(self, validated_data):
        # Name is not proof of legal identity (spec §5); slug just needs uniqueness.
        user = self.context["request"].user
        base = slugify(validated_data["name"]) or "business"
        slug = f"{base}-{uuid_hex()[:6]}"
        return Business.objects.create(owner=user, slug=slug, **validated_data)


def uuid_hex() -> str:
    import uuid

    return uuid.uuid4().hex
