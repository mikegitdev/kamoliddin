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
        return (
            Business.objects.filter(owner=self.request.user)
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
        return Business.objects.filter(owner=self.request.user).select_related("owner", "category")
