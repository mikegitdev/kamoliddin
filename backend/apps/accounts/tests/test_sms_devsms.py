"""DevSMS adapter (spec §9, ADR-0006): universal-OTP payload, Idempotency-Key
handling and unknown-outcome semantics. Unit-level — the HTTP layer is faked,
no network. Money-relevant branching (charges, no-double-send) is the risk
under test."""

import io
import json
import urllib.error

import pytest
from django.test import override_settings

from apps.accounts.services import request_otp
from apps.accounts.sms import DevSMSError, DevSMSSMSAdapter, get_sms_adapter

DEVSMS_SETTINGS = dict(
    SMS_PROVIDER="devsms",
    DEVSMS_API_TOKEN="test-token",
    DEVSMS_BASE_URL="https://devsms.example/api/v1",
    DEVSMS_SERVICE_NAME="LocalAds",
)
CHALLENGE_KEY = "3f2b8a52-7c1d-4e0a-9b4f-6d5c1a2e8b70"


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _HttpRecorder:
    """Records urllib requests; answers with queued payloads or raises."""

    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.requests: list[urllib.request.Request] = []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return _Response(outcome)

    def payload(self, n=0):
        return json.loads(self.requests[n].data.decode())


def _http_error(code: int, envelope: dict) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "https://devsms.example/api/v1/sms",
        code,
        "error",
        {},
        io.BytesIO(json.dumps(envelope).encode()),
    )


def _send(adapter, purpose="login", code="482915"):
    return adapter.send_otp(
        phone_e164="+998901234567",
        message=f"Your login code: {code}. Valid 5 minutes.",
        request_id=CHALLENGE_KEY,
        code=code,
        purpose=purpose,
    )


@override_settings(**DEVSMS_SETTINGS)
def test_send_otp_uses_universal_otp_with_idempotency_key(monkeypatch):
    recorder = _HttpRecorder([{"success": True, "data": {"id": 81234, "status": "sent"}}])
    monkeypatch.setattr("apps.accounts.sms.urllib.request.urlopen", recorder)

    message_id = _send(get_sms_adapter())

    assert message_id == "81234"
    request = recorder.requests[0]
    assert request.full_url == "https://devsms.example/api/v1/sms"
    assert request.get_header("Authorization") == "Bearer test-token"
    assert request.get_header("Idempotency-key") == CHALLENGE_KEY
    assert recorder.payload() == {
        "phone": "998901234567",
        "otp": {"template_type": 4, "service_name": "LocalAds", "code": "482915"},
    }


@override_settings(**DEVSMS_SETTINGS)
def test_phone_change_maps_to_confirm_operation_template(monkeypatch):
    recorder = _HttpRecorder([{"success": True, "data": {"id": 1}}])
    monkeypatch.setattr("apps.accounts.sms.urllib.request.urlopen", recorder)

    _send(get_sms_adapter(), purpose="phone_change")

    # 1 = "confirm an operation" (provider template types; phone change proves
    # ownership of a different number — not a sign-in).
    assert recorder.payload()["otp"]["template_type"] == 1


@override_settings(**DEVSMS_SETTINGS)
def test_missing_token_fails_fast():
    with override_settings(DEVSMS_API_TOKEN=""):
        with pytest.raises(RuntimeError, match="DEVSMS_API_TOKEN"):
            DevSMSSMSAdapter()


@override_settings(**DEVSMS_SETTINGS)
def test_unknown_outcome_keeps_challenge_and_returns_sms_id(monkeypatch):
    # 502 provider_outcome_unknown: charged, may have been delivered. The
    # adapter must NOT raise — a rollback + user resend would double-charge.
    recorder = _HttpRecorder(
        [
            _http_error(
                502,
                {
                    "success": False,
                    "error_code": "provider_outcome_unknown",
                    "message": "Natija noma'lum",
                    "meta": {"sms_id": 777, "charged": True},
                },
            ),
        ]
    )
    monkeypatch.setattr("apps.accounts.sms.urllib.request.urlopen", recorder)

    assert _send(get_sms_adapter()) == "777"


@override_settings(**DEVSMS_SETTINGS)
def test_provider_errors_raise_with_stable_error_code(monkeypatch):
    recorder = _HttpRecorder(
        [
            _http_error(
                402,
                {
                    "success": False,
                    "error_code": "insufficient_balance",
                    "message": "Balans yetarli emas",
                },
            ),
        ]
    )
    monkeypatch.setattr("apps.accounts.sms.urllib.request.urlopen", recorder)

    with pytest.raises(DevSMSError) as excinfo:
        _send(get_sms_adapter())
    assert excinfo.value.error_code == "insufficient_balance"


@override_settings(**DEVSMS_SETTINGS)
def test_timeout_retries_once_with_the_same_idempotency_key(monkeypatch):
    recorder = _HttpRecorder(
        [
            TimeoutError("timed out"),
            {"success": True, "data": {"id": 9, "status": "sent"}},
        ]
    )
    monkeypatch.setattr("apps.accounts.sms.urllib.request.urlopen", recorder)
    monkeypatch.setattr("apps.accounts.sms.time.sleep", lambda seconds: None)

    assert _send(get_sms_adapter()) == "9"
    assert len(recorder.requests) == 2
    keys = {r.get_header("Idempotency-key") for r in recorder.requests}
    assert keys == {CHALLENGE_KEY}  # same key: never double-send/double-charge


@override_settings(**DEVSMS_SETTINGS)
def test_get_delivery_status_returns_provider_status(monkeypatch):
    recorder = _HttpRecorder([{"success": True, "data": {"id": 81234, "status": "delivered"}}])
    monkeypatch.setattr("apps.accounts.sms.urllib.request.urlopen", recorder)

    assert get_sms_adapter().get_delivery_status("81234") == "delivered"
    assert recorder.requests[0].full_url == "https://devsms.example/api/v1/sms/81234"


@pytest.mark.django_db
@override_settings(**DEVSMS_SETTINGS)
def test_request_otp_flow_passes_code_and_challenge_id(monkeypatch):
    """End-to-end at the service layer: a login challenge for an unbound phone
    reaches DevSMS with the raw code and the challenge UUID as idempotency key."""
    recorder = _HttpRecorder([{"success": True, "data": {"id": 5, "status": "sent"}}])
    monkeypatch.setattr("apps.accounts.sms.urllib.request.urlopen", recorder)

    challenge = request_otp("+998901234567")

    payload = recorder.payload()
    assert payload["phone"] == "998901234567"
    assert payload["otp"]["template_type"] == 4
    assert payload["otp"]["code"].isdigit() and len(payload["otp"]["code"]) == 6
    assert recorder.requests[0].get_header("Idempotency-key") == str(challenge.id)
