from django.urls import path

from .api import (
    AdLimitView,
    CampaignReviewView,
    GrantView,
    RefundListView,
    RefundProcessView,
    ReviewQueueView,
)

urlpatterns = [
    path("admin/review-queue", ReviewQueueView.as_view(), name="admin-review-queue"),
    path("admin/campaigns/<uuid:id>/review", CampaignReviewView.as_view(),
         name="admin-campaign-review"),
    path("admin/grants", GrantView.as_view(), name="admin-grants"),
    path("admin/refunds", RefundListView.as_view(), name="admin-refunds"),
    path("admin/refunds/<uuid:id>/process", RefundProcessView.as_view(),
         name="admin-refund-process"),
    path("admin/settings/ad-limit", AdLimitView.as_view(), name="admin-ad-limit"),
]
