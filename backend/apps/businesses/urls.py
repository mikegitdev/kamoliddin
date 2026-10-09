from django.urls import path

from apps.locations.views import BusinessLocationsView

from .views import BusinessDetailView, BusinessListCreateView

urlpatterns = [
    path("businesses", BusinessListCreateView.as_view(), name="businesses"),
    path("businesses/<uuid:id>", BusinessDetailView.as_view(), name="business-detail"),
    path(
        "businesses/<uuid:business_id>/locations",
        BusinessLocationsView.as_view(),
        name="business-locations",
    ),
]
