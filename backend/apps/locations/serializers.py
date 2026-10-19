from django.contrib.gis.geos import Point
from rest_framework import serializers

from apps.businesses.contacts import ContactFieldsMixin

from .models import Location


class LocationSerializer(ContactFieldsMixin, serializers.ModelSerializer):
    lon = serializers.FloatField(write_only=True)
    lat = serializers.FloatField(write_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)

    class Meta:
        model = Location
        fields = (
            "id", "business", "business_name", "name", "address", "city",
            "lon", "lat", "phone", "telegram", "whatsapp", "hours",
            "status", "risk_flags", "created_at", "updated_at",
        )
        read_only_fields = ("id", "business", "status", "risk_flags", "created_at",
                            "updated_at", "business_name")

    def validate(self, attrs):
        lon = attrs.pop("lon", None)
        lat = attrs.pop("lat", None)
        if lon is not None and lat is not None:
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise serializers.ValidationError({"lat": "Invalid coordinates"})
            attrs["point"] = Point(lon, lat, srid=4326)
        elif lon is not None or lat is not None:
            raise serializers.ValidationError({"lat": "Both lon and lat are required"})
        return attrs

    def to_representation(self, instance):
        # lon/lat are write-only above; echo them back read-only so the owner
        # cabinet can prefill the branch edit form and pin (spec §13).
        data = super().to_representation(instance)
        data["lon"] = instance.point.x
        data["lat"] = instance.point.y
        return data
