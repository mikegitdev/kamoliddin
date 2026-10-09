from django.urls import path

from .views import (
    CheckoutView,
    OrderDetailView,
    OrderListView,
    QuoteView,
    RefundRequestView,
)

urlpatterns = [
    path("orders/quote", QuoteView.as_view(), name="order-quote"),
    path("orders", OrderListView.as_view(), name="orders"),
    path("orders/<uuid:id>", OrderDetailView.as_view(), name="order-detail"),
    path("orders/<uuid:id>/checkout", CheckoutView.as_view(), name="order-checkout"),
    path("orders/<uuid:id>/refund-request", RefundRequestView.as_view(),
         name="order-refund-request"),
]
