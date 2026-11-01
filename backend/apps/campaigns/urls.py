from django.urls import path

from .placements_api import CampaignPlacementListView
from .views import (
    CampaignDetailView,
    CampaignListCreateView,
    CampaignOutcomeView,
    CampaignReviewListView,
    CampaignSubmitView,
)

urlpatterns = [
    path("campaigns", CampaignListCreateView.as_view(), name="campaigns"),
    path("campaigns/<uuid:id>", CampaignDetailView.as_view(), name="campaign-detail"),
    path("campaigns/<uuid:id>/submit", CampaignSubmitView.as_view(), name="campaign-submit"),
    path("campaigns/<uuid:id>/outcome", CampaignOutcomeView.as_view(),
         name="campaign-outcome"),
    path("campaigns/<uuid:id>/reviews", CampaignReviewListView.as_view(),
         name="campaign-reviews"),
    path("campaigns/<uuid:id>/placements", CampaignPlacementListView.as_view(),
         name="campaign-placements"),
]
