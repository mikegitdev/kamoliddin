from django.urls import path

from .summary import MeSummaryView
from .views import CsrfView, LogoutView, MeView, OTPRequestView, OTPVerifyView

urlpatterns = [
    path("otp/request", OTPRequestView.as_view(), name="auth-otp-request"),
    path("otp/verify", OTPVerifyView.as_view(), name="auth-otp-verify"),
    path("logout", LogoutView.as_view(), name="auth-logout"),
    path("me", MeView.as_view(), name="auth-me"),
    path("me/summary", MeSummaryView.as_view(), name="auth-me-summary"),
    path("csrf", CsrfView.as_view(), name="auth-csrf"),
]
