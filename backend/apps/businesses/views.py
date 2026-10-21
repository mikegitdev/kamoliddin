from django.contrib.auth.models import AnonymousUser
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import permissions
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListCreateAPIView, RetrieveUpdateDestroyAPIView

from .models import Business
from .serializers import BusinessSerializer


class BusinessListCreateView(ListCreateAPIView):
    serializer_class = BusinessSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return Business.objects.none()
        user = self.request.user
        assert not isinstance(user, AnonymousUser)  # IsAuthenticated
        return (
            Business.objects.filter(owner=user)
            .select_related("owner", "category")
            .order_by("-created_at")
        )


@extend_schema_view(
    get=extend_schema(tags=["Businesses"], summary="Own business profile"),
    patch=extend_schema(tags=["Businesses"], summary="Edit own business"),
    delete=extend_schema(
        tags=["Businesses"],
        summary="Delete an empty business",
        description="Only a business with no branches, campaigns or orders can be "
                    "deleted (e.g. an accidental duplicate). Anything that has been "
                    "used carries records the platform must retain (spec §7.1/§14); "
                    "account deletion anonymizes instead.",
    ),
)
class BusinessDetailView(RetrieveUpdateDestroyAPIView):
    serializer_class = BusinessSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "delete", "head", "options"]
    lookup_url_kwarg = "id"

    def get_queryset(self):
        user = self.request.user
        assert not isinstance(user, AnonymousUser)  # IsAuthenticated
        return Business.objects.filter(owner=user).select_related("owner", "category")

    def perform_destroy(self, instance):
        # Empty businesses only — any branch, campaign or order is a record
        # the platform must keep (PROTECT FKs are the final guard).
        if (
            instance.locations.exists()
            or instance.campaigns.exists()
            or instance.orders.exists()
        ):
            raise ValidationError(
                {"detail": "Only a business without branches, campaigns or orders can be deleted"},
                code="business_in_use",
            )
        instance.delete()
