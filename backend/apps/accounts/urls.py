from django.urls import path

from .summary import MeSummaryView
from .views import (
    CsrfView,
    LogoutView,
    MeView,
    OTPRequestView,
    OTPVerifyView,
    PhoneChangeRequestView,
    PhoneChangeVerifyView,
)

urlpatterns = [
    path("otp/request", OTPRequestView.as_view(), name="auth-otp-request"),
    path("otp/verify", OTPVerifyView.as_view(), name="auth-otp-verify"),
    path("phone/change/request", PhoneChangeRequestView.as_view(),
         name="auth-phone-change-request"),
    path("phone/change/verify", PhoneChangeVerifyView.as_view(),
         name="auth-phone-change-verify"),
    path("logout", LogoutView.as_view(), name="auth-logout"),
    path("me", MeView.as_view(), name="auth-me"),
    path("me/summary", MeSummaryView.as_view(), name="auth-me-summary"),
    path("csrf", CsrfView.as_view(), name="auth-csrf"),
]
