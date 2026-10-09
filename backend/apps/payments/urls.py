from django.urls import path

from . import views

urlpatterns = [
    path("<slug:provider>/webhook", views.ProviderWebhookView.as_view(),
         name="payment-webhook"),
    path("fake/checkout/<str:provider_payment_id>", views.FakeCheckoutCompleteView.as_view(),
         name="fake-checkout-complete"),
]
