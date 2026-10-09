from rest_framework import serializers


class PublicLocationSerializer(serializers.Serializer):
    """Map pin payload: id, coordinates, count of CURRENTLY ACTIVE public ads
    (spec §10) — not historical ones."""

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    lon = serializers.SerializerMethodField()
    lat = serializers.SerializerMethodField()
    category = serializers.CharField(read_only=True)
    business_name = serializers.CharField(read_only=True)
    active_ads_count = serializers.IntegerField(read_only=True)

    def get_lon(self, obj) -> float:
        return obj.point.x

    def get_lat(self, obj) -> float:
        return obj.point.y


class PublicCampaignSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    headline = serializers.CharField(read_only=True)
    body = serializers.CharField(read_only=True)
    banner_url = serializers.CharField(read_only=True)
    business_name = serializers.CharField(read_only=True)
    starts_at = serializers.DateTimeField(read_only=True)
    ends_at = serializers.DateTimeField(read_only=True)


class PublicLocationDetailSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    address = serializers.CharField(read_only=True)
    lon = serializers.SerializerMethodField()
    lat = serializers.SerializerMethodField()
    hours = serializers.JSONField(read_only=True)
    phone = serializers.CharField(read_only=True)
    telegram = serializers.CharField(read_only=True)
    whatsapp = serializers.CharField(read_only=True)
    business_name = serializers.SerializerMethodField()
    business_site = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()
    active_ads = PublicCampaignSerializer(many=True, read_only=True)

    def get_lon(self, obj) -> float:
        return obj.point.x

    def get_lat(self, obj) -> float:
        return obj.point.y

    def get_business_name(self, obj) -> str:
        return obj.business.name

    def get_business_site(self, obj) -> str:
        return obj.business.site

    def get_category(self, obj) -> str:
        return obj.business.category.slug


class CategorySerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    slug = serializers.CharField(read_only=True)
    name_ru = serializers.CharField(read_only=True)
    name_uz = serializers.CharField(read_only=True)
