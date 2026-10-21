from rest_framework import serializers

from apps.moderation.models import Report


class PublicLocationSerializer(serializers.Serializer):
    """Map pin payload: id, coordinates, count of CURRENTLY ACTIVE public ads
    (spec §10) — not historical ones."""

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    lon = serializers.SerializerMethodField()
    lat = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()
    business_name = serializers.SerializerMethodField()
    active_ads_count = serializers.IntegerField(read_only=True)

    def get_lon(self, obj) -> float:
        return obj.point.x

    def get_lat(self, obj) -> float:
        return obj.point.y

    def get_category(self, obj) -> str:
        return obj.business.category.slug

    def get_business_name(self, obj) -> str:
        return obj.business.name


class PublicCampaignSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    headline = serializers.CharField(read_only=True)
    body = serializers.CharField(read_only=True)
    banner_url = serializers.CharField(read_only=True)
    business_name = serializers.CharField(read_only=True)
    starts_at = serializers.DateTimeField(read_only=True)
    ends_at = serializers.DateTimeField(read_only=True)


class PublicAdLocationSerializer(serializers.Serializer):
    """Branch context for a directly opened ad link (spec §14): only data of
    locations where the campaign is CURRENTLY eligible — same visibility rules
    as every other public endpoint. Lets a shared /ads/{id} URL show address,
    hours and contacts without any client navigation state."""

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    address = serializers.CharField(read_only=True)
    lon = serializers.SerializerMethodField()
    lat = serializers.SerializerMethodField()
    hours = serializers.JSONField(read_only=True)
    phone = serializers.CharField(read_only=True)
    telegram = serializers.CharField(read_only=True)
    whatsapp = serializers.CharField(read_only=True)
    business_site = serializers.SerializerMethodField()

    def get_lon(self, obj) -> float:
        return obj.point.x

    def get_lat(self, obj) -> float:
        return obj.point.y

    def get_business_site(self, obj) -> str:
        return obj.business.site


class PublicCampaignDetailSerializer(PublicCampaignSerializer):
    """Ad detail payload plus the currently eligible branches. starts_at/ends_at
    still come from one selected placement and must not be presented as the
    schedule of every branch (design guide §7.3)."""

    locations = PublicAdLocationSerializer(many=True, read_only=True)


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


class PublicSearchLocationSerializer(PublicLocationSerializer):
    distance_m = serializers.IntegerField(
        read_only=True, required=False, help_text="Present only when lat/lon are given"
    )


class PublicSearchCampaignSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    headline = serializers.CharField(read_only=True)
    business_name = serializers.CharField(read_only=True)
    banner_url = serializers.CharField(read_only=True)


class PublicSearchResultSerializer(serializers.Serializer):
    locations = PublicSearchLocationSerializer(many=True, read_only=True)
    campaigns = PublicSearchCampaignSerializer(many=True, read_only=True)


class PublicNearbyAdLocationSerializer(serializers.Serializer):
    """Nearest eligible branch of a nearby-ads card (see PublicNearbyAdSerializer)."""

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    address = serializers.CharField(read_only=True)
    lon = serializers.SerializerMethodField()
    lat = serializers.SerializerMethodField()

    def get_lon(self, obj) -> float:
        return obj.point.x

    def get_lat(self, obj) -> float:
        return obj.point.y


class PublicNearbyAdSerializer(serializers.Serializer):
    """One card of the nearby ads feed. The feed's unit is the CAMPAIGN, not
    the placement: a campaign advertised at several branches appears once,
    pinned to its nearest CURRENTLY eligible branch (distance is measured to
    that branch only — an ineligible nearer branch never shortens it).
    `branches_count` counts all currently eligible branches city-wide.
    Sourced from a Placement row; context carries a per-campaign eligible
    branch count so the page stays N+1-free."""

    id = serializers.UUIDField(read_only=True, source="campaign.id")
    headline = serializers.CharField(read_only=True, source="campaign.headline")
    body = serializers.CharField(read_only=True, source="campaign.body")
    banner_url = serializers.SerializerMethodField()
    business_name = serializers.CharField(read_only=True, source="campaign.business.name")
    category = serializers.SerializerMethodField()
    location = PublicNearbyAdLocationSerializer(read_only=True)
    distance_m = serializers.SerializerMethodField()
    branches_count = serializers.SerializerMethodField()

    def get_banner_url(self, obj) -> str:
        return f"/media/{obj.campaign.banner_key}" if obj.campaign.banner_key else ""

    def get_category(self, obj) -> str:
        return obj.campaign.business.category.slug

    def get_distance_m(self, obj) -> int:
        return round(obj.distance.m)

    def get_branches_count(self, obj) -> int:
        counts = self.context.get("branch_counts", {})
        return counts.get(obj.campaign_id, 1)


class PublicNearbyAdsResultSerializer(serializers.Serializer):
    results = PublicNearbyAdSerializer(many=True, read_only=True)
    next_cursor = serializers.CharField(read_only=True, allow_null=True, allow_blank=True)
    has_more = serializers.BooleanField(read_only=True)


class PublicTariffSerializer(serializers.Serializer):
    currency = serializers.CharField(read_only=True)
    amount_per_24h = serializers.IntegerField(read_only=True, help_text="Minor units (tiyin)")
    valid_from = serializers.DateTimeField(read_only=True)


class PublicPricingSerializer(serializers.Serializer):
    tariff = PublicTariffSerializer(read_only=True, allow_null=True)


class PublicReportRequestSerializer(serializers.Serializer):
    entity = serializers.ChoiceField(choices=Report.Entity.choices)
    entity_id = serializers.UUIDField()
    reason = serializers.CharField(max_length=2000)
