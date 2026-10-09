from django.urls import path

from .views import CampaignDetailView, CampaignListCreateView, CampaignSubmitView

urlpatterns = [
    path("campaigns", CampaignListCreateView.as_view(), name="campaigns"),
    path("campaigns/<uuid:id>", CampaignDetailView.as_view(), name="campaign-detail"),
    path("campaigns/<uuid:id>/submit", CampaignSubmitView.as_view(), name="campaign-submit"),
]
