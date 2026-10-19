from django.contrib.auth.models import AnonymousUser
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import permissions
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.generics import ListCreateAPIView, RetrieveUpdateAPIView

from apps.businesses.models import Business

from .models import Location
from .serializers import LocationSerializer
from .services import after_owner_write, snapshot


def _owned_business(user, business_id) -> Business:
    business = Business.objects.filter(pk=business_id).first()
    if business is None:
        raise NotFound("Business not found")
    if business.owner_id != user.id:
        raise PermissionDenied("Not your business")
    return business


@extend_schema_view(
    get=extend_schema(tags=["Locations"], summary="List branches of own business"),
    post=extend_schema(tags=["Locations"], summary="Add a branch"),
)
class BusinessLocationsView(ListCreateAPIView):
    serializer_class = LocationSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return Location.objects.none()
        business = _owned_business(self.request.user, self.kwargs["business_id"])
        return Location.objects.filter(business=business).select_related(
            "business"
        ).order_by("-created_at")

    def perform_create(self, serializer):
        business = _owned_business(self.request.user, self.kwargs["business_id"])
        location = serializer.save(business=business)
        after_owner_write(user=self.request.user, location=location, before=None)


@extend_schema_view(
    get=extend_schema(tags=["Locations"], summary="Own branch details"),
    patch=extend_schema(tags=["Locations"], summary="Edit own branch"),
)
class LocationDetailView(RetrieveUpdateAPIView):
    serializer_class = LocationSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "head", "options"]
    lookup_url_kwarg = "id"

    def get_queryset(self):
        user = self.request.user
        assert not isinstance(user, AnonymousUser)  # IsAuthenticated
        return Location.objects.filter(business__owner=user).select_related("business")

    def perform_update(self, serializer):
        before = snapshot(serializer.instance)
        location = serializer.save()
        after_owner_write(user=self.request.user, location=location, before=before)
