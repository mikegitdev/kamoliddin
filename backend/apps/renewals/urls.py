from django.urls import path

from .views import RenewalCancelView, RenewalEnableView, RenewalListView

urlpatterns = [
    path("renewals", RenewalListView.as_view(), name="renewals"),
    path("renewals/enable", RenewalEnableView.as_view(), name="renewal-enable"),
    path("renewals/<uuid:id>/cancel", RenewalCancelView.as_view(), name="renewal-cancel"),
]
