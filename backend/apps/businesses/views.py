from django.contrib.auth.models import AnonymousUser
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import permissions
from rest_framework.generics import ListCreateAPIView, RetrieveUpdateAPIView

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
)
class BusinessDetailView(RetrieveUpdateAPIView):
    serializer_class = BusinessSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        user = self.request.user
        assert not isinstance(user, AnonymousUser)  # IsAuthenticated
        return Business.objects.filter(owner=user).select_related("owner", "category")
