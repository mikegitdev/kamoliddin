"""Dev-only OTP echo (spec §9): the otp/request 202 body may carry `dev_code`
only on dev/test stacks (SMS_PROVIDER=fake + OTP_DEV_ECHO in dev settings).
Prod settings define neither, so the prod response stays the generic
anti-enumeration payload."""

import random

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.services import OTPError, request_otp, verify_otp

pytestmark = pytest.mark.django_db

PHONE = "+998901234999"


def _request_otp():
    # Unique source IP per call: the otp scope throttles by IP and the counts
    # live in the shared dev Redis — a fixed IP would 429 across reruns.
    ip = f"10.{random.randint(1, 250)}.{random.randint(1, 250)}.1"
    return APIClient().post(
        "/api/v1/auth/otp/request", {"phone": PHONE}, format="json",
        REMOTE_ADDR=ip,
    )


@override_settings(OTP_DEV_ECHO=True, SMS_PROVIDER="fake")
def test_dev_echo_returns_code_and_code_verifies():
    response = _request_otp()
    assert response.status_code == 202
    code = response.data.get("dev_code")
    assert isinstance(code, str) and len(code) == 6 and code.isdigit()

    verify = APIClient().post(
        "/api/v1/auth/otp/verify", {"phone": PHONE, "code": code}, format="json",
        REMOTE_ADDR=ip_for_verify(),
    )
    assert verify.status_code == 200
    assert verify.data["phone_e164"] == PHONE


def ip_for_verify() -> str:
    return f"10.{random.randint(1, 250)}.{random.randint(1, 250)}.1"


@override_settings(OTP_DEV_ECHO=False, SMS_PROVIDER="fake")
def test_echo_off_keeps_generic_response():
    response = _request_otp()
    assert response.status_code == 202
    assert "dev_code" not in response.data
    assert response.data["detail"]


@override_settings(OTP_DEV_ECHO=True, SMS_PROVIDER="fake")
def test_wrong_otp_attempts_are_persisted_and_capped():
    challenge = request_otp(PHONE)
    dev_code = challenge.dev_code  # type: ignore[attr-defined]  # in-memory echo
    wrong_code = "000000" if dev_code != "000000" else "000001"

    for _ in range(5):
        with pytest.raises(OTPError):
            verify_otp(PHONE, wrong_code)

    challenge.refresh_from_db()
    assert challenge.attempts == 5
    with pytest.raises(OTPError):
        verify_otp(PHONE, dev_code)
    challenge.refresh_from_db()
    assert challenge.attempts == 5
