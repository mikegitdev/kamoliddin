from django.urls import path

from .views import LocationDetailView

urlpatterns = [
    path("locations/<uuid:id>", LocationDetailView.as_view(), name="location-detail"),
]
