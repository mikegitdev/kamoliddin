"""Provider-neutral SMS adapter contract (spec §9).

`send_otp(phone_e164, message, request_id) -> provider_message_id`
`get_delivery_status(provider_message_id) -> str`

Adapters:
- FakeSMSAdapter: deterministic dev/test logging adapter (default).
- EskizSMSAdapter: implemented against Eskiz's published API docs
  (notify.eskiz.uz — official Postman collection + SDKs; see ADR-0006).
  Credential-gated via ESKIZ_EMAIL/ESKIZ_PASSWORD; NOT production-selected
  until the Eskiz vs Play Mobile benchmark is recorded (spec §9, §19 [E]).
- PlayMobileSMSAdapter: no verified public documentation — intentionally
  raises NotImplementedError (repo AGENTS.md rule 4: no fabricated provider
  behavior).
"""
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Protocol

from django.conf import settings

logger = logging.getLogger(__name__)


class SMSAdapter(Protocol):
    slug: str

    def send_otp(self, *, phone_e164: str, message: str, request_id: str) -> str:
        """Send an OTP message; return the provider message id."""
        ...

    def get_delivery_status(self, provider_message_id: str) -> str:
        """Return delivery status where the provider supports it."""
        ...


class FakeSMSAdapter:
    """Deterministic dev/test adapter: logs the code instead of sending SMS."""

    slug = "fake"

    def send_otp(self, *, phone_e164: str, message: str, request_id: str) -> str:
        import sys
        # Dev-only fake adapter output; real adapters use the provider API.
        print(  # noqa: T201
            f"[SMS:fake] to={phone_e164} request_id={request_id} message={message!r}",
            file=sys.stdout,
            flush=True,
        )
        return f"fake-{request_id}"

    def get_delivery_status(self, provider_message_id: str) -> str:
        return "delivered"


class EskizSMSAdapter:
    """Eskiz.uz SMS gateway (verified against the published API docs).

    Endpoints (https://notify.eskiz.uz):
      POST /api/auth/login          form: email, password -> data.token
      POST /api/message/sms/send    Bearer; form: mobile_phone (998XXXXXXXXX),
                                    message, from, [callback_url] -> data.id
      GET  /api/message/sms/status_by_id/{id} -> status

    Token is cached in-process with a TTL and refreshed on auth failure.
    """

    slug = "eskiz"
    _TOKEN_TTL = 3600 * 6  # refresh well before Eskiz's 30-day token expiry
    _cached_token: str = ""
    _cached_at: float = 0.0

    def __init__(self) -> None:
        if not (settings.ESKIZ_EMAIL and settings.ESKIZ_PASSWORD):
            raise RuntimeError(
                "SMS_PROVIDER=eskiz requires ESKIZ_EMAIL and ESKIZ_PASSWORD in "
                "the environment. Provider benchmark pending (spec §9, §19 [E])."
            )
        self.base_url = settings.ESKIZ_BASE_URL

    def _request(self, path: str, *, data: dict | None = None, token: str = "") -> dict:
        url = f"{self.base_url}{path}"
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        body = urllib.parse.urlencode(data).encode() if data else None
        if body:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(url, data=body, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode())

    def _token(self, *, force_refresh: bool = False) -> str:
        now = time.monotonic()
        if (
            not force_refresh
            and EskizSMSAdapter._cached_token
            and now - EskizSMSAdapter._cached_at < EskizSMSAdapter._TOKEN_TTL
        ):
            return EskizSMSAdapter._cached_token
        result = self._request(
            "/api/auth/login",
            data={"email": settings.ESKIZ_EMAIL, "password": settings.ESKIZ_PASSWORD},
        )
        token = str(result["data"]["token"])
        EskizSMSAdapter._cached_token = token
        EskizSMSAdapter._cached_at = now
        return token

    def send_otp(self, *, phone_e164: str, message: str, request_id: str) -> str:
        payload = {
            "mobile_phone": phone_e164.lstrip("+"),
            "message": message,
            "from": settings.ESKIZ_FROM,
        }
        try:
            result = self._request(
                "/api/message/sms/send", data=payload, token=self._token()
            )
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):  # stale token: refresh once and retry
                result = self._request(
                    "/api/message/sms/send", data=payload, token=self._token(force_refresh=True)
                )
            else:
                raise
        return str(result["data"]["id"])

    def get_delivery_status(self, provider_message_id: str) -> str:
        result = self._request(
            f"/api/message/sms/status_by_id/{provider_message_id}", token=self._token()
        )
        # Documented statuses map directly to our contract vocabulary.
        return str(result.get("status", "unknown"))


class PlayMobileSMSAdapter:
    slug = "play_mobile"

    def __init__(self) -> None:
        raise NotImplementedError(
            "Play Mobile adapter pending verified provider documentation and "
            "benchmark (spec §9, §19 [E]). Do not fabricate provider behavior."
        )


_ADAPTERS: dict[str, type] = {
    FakeSMSAdapter.slug: FakeSMSAdapter,
    EskizSMSAdapter.slug: EskizSMSAdapter,
    PlayMobileSMSAdapter.slug: PlayMobileSMSAdapter,
}


def get_sms_adapter() -> SMSAdapter:
    adapter_cls = _ADAPTERS.get(settings.SMS_PROVIDER)
    if adapter_cls is None:
        raise RuntimeError(f"Unknown SMS_PROVIDER: {settings.SMS_PROVIDER!r}")
    return adapter_cls()
