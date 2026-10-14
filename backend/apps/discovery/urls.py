from django.urls import path

from . import views

urlpatterns = [
    path("locations", views.PublicLocationListView.as_view(), name="public-locations"),
    path("locations/<uuid:id>", views.PublicLocationDetailView.as_view(),
         name="public-location-detail"),
    path("campaigns/<uuid:id>", views.PublicCampaignDetailView.as_view(),
         name="public-campaign-detail"),
    path("categories", views.CategoryListView.as_view(), name="public-categories"),
    path("search", views.PublicSearchView.as_view(), name="public-search"),
    path("pricing", views.PublicPricingView.as_view(), name="public-pricing"),
    path("reports", views.PublicReportView.as_view(), name="public-report"),
]
