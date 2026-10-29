"""Provider-neutral SMS adapter contract (spec §9).

`send_otp(phone_e164, message, request_id) -> provider_message_id`
`get_delivery_status(provider_message_id) -> str`

Adapters:
- FakeSMSAdapter: deterministic dev/test logging adapter (default).
- DevSMSSMSAdapter: devsms.uz API v1 universal OTP, implemented against the
  provider's published agent reference (ADR-0006). Production SMS provider
  by product-owner decision (2026-10-29).
- EskizSMSAdapter: implemented against Eskiz's published API docs
  (notify.eskiz.uz — official Postman collection + SDKs; see ADR-0006).
  Credential-gated via ESKIZ_EMAIL/ESKIZ_PASSWORD; kept as the benchmark
  alternative (spec §9, §19 [E]).
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

    def send_otp(
        self,
        *,
        phone_e164: str,
        message: str,
        request_id: str,
        code: str = "",
        purpose: str = "login",
    ) -> str:
        """Send an OTP message; return the provider message id.

        ``message`` is the human text; ``code`` (raw digits) and ``purpose``
        (challenge purpose) are additionally passed for providers with
        structured OTP templates (DevSMS universal OTP). Free-text adapters
        may ignore them.
        """
        ...

    def get_delivery_status(self, provider_message_id: str) -> str:
        """Return delivery status where the provider supports it."""
        ...


class FakeSMSAdapter:
    """Deterministic dev/test adapter: logs the code instead of sending SMS."""

    slug = "fake"

    def send_otp(
        self,
        *,
        phone_e164: str,
        message: str,
        request_id: str,
        code: str = "",
        purpose: str = "login",
    ) -> str:
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


class DevSMSError(RuntimeError):
    """DevSMS v1 error envelope: stable ``error_code`` + human message."""

    def __init__(self, error_code: str, message: str, meta: dict | None = None) -> None:
        super().__init__(f"DevSMS error {error_code}: {message}")
        self.error_code = error_code
        self.meta = meta or {}


class DevSMSSMSAdapter:
    """devsms.uz gateway — API v1 universal OTP (ADR-0006).

    Implemented against the provider's published agent reference
    (https://devsms.uz/docs/api/agents.md):
      POST /api/v1/sms     Bearer; JSON {phone, otp{template_type,
                          service_name, code}}; Idempotency-Key header
                          -> data.id
      GET  /api/v1/sms/{id} -> data.status
                          (pending|sent|delivered|failed|blocked)

    Universal OTP needs no account-approved message template: the operator's
    pre-approved texts are used and only ``service_name`` is moderated.

    Idempotency: the request id (challenge UUID) is sent as Idempotency-Key,
    so a same-key retry never delivers or charges twice (provider guarantee).

    Unknown provider outcome (502 ``provider_outcome_unknown``): the account
    is charged and the SMS may have been delivered. The challenge must STAND
    — a fresh key would double-send and double-charge — so the sms id is
    returned and the incident logged for ops reconciliation.
    """

    slug = "devsms"

    # Challenge purposes -> universal-OTP template types (provider docs):
    # 1 confirm an operation, 2 password reset, 3 sign up, 4 sign in.
    _TEMPLATE_TYPES = {"login": 4, "phone_change": 1}
    _RETRY_DELAY_SECONDS = 2.0

    def __init__(self) -> None:
        if not settings.DEVSMS_API_TOKEN:
            raise RuntimeError(
                "SMS_PROVIDER=devsms requires DEVSMS_API_TOKEN in the "
                "environment (devsms.uz dashboard -> API keys; ADR-0006)."
            )
        self.base_url = settings.DEVSMS_BASE_URL.rstrip("/")
        self.service_name = settings.DEVSMS_SERVICE_NAME

    def _request(
        self,
        path: str,
        *,
        payload: dict | None = None,
        idempotency_key: str = "",
        _retry: bool = True,
    ) -> dict:
        url = f"{self.base_url}{path}"
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {settings.DEVSMS_API_TOKEN}",
        }
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        req = urllib.request.Request(url, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            try:
                envelope = json.loads(exc.read().decode())
            except Exception:
                envelope = {}
            raise DevSMSError(
                str(envelope.get("error_code") or f"http_{exc.code}"),
                str(envelope.get("message") or exc.reason),
                dict(envelope.get("meta") or {}),
            ) from exc
        except (urllib.error.URLError, TimeoutError):
            # Network error/timeout: the request may still have been delivered
            # and charged — exactly one same-key retry is safe per the docs
            # (never resend without the same Idempotency-Key).
            if not _retry:
                raise
            time.sleep(self._RETRY_DELAY_SECONDS)
            return self._request(
                path, payload=payload, idempotency_key=idempotency_key, _retry=False
            )

    def send_otp(
        self,
        *,
        phone_e164: str,
        message: str,
        request_id: str,
        code: str = "",
        purpose: str = "login",
    ) -> str:
        # `message` is kept for the provider-neutral contract; the universal
        # OTP template renders its own text from code + service name.
        if not code:
            raise ValueError("DevSMS universal OTP requires the raw code")
        payload = {
            "phone": phone_e164.lstrip("+"),
            "otp": {
                "template_type": self._TEMPLATE_TYPES.get(purpose, 4),
                "service_name": self.service_name,
                "code": code,
            },
        }
        try:
            result = self._request("/sms", payload=payload, idempotency_key=request_id)
        except DevSMSError as exc:
            if exc.error_code == "provider_outcome_unknown":
                sms_id = str(exc.meta.get("sms_id") or request_id)
                logger.warning(
                    "DevSMS outcome unknown for challenge %s (sms_id=%s): charged, "
                    "delivery unconfirmed — challenge stands, no resend",
                    request_id,
                    sms_id,
                )
                return sms_id
            raise
        return str(result["data"]["id"])

    def get_delivery_status(self, provider_message_id: str) -> str:
        result = self._request(f"/sms/{provider_message_id}")
        return str(result["data"]["status"])


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

    def send_otp(
        self,
        *,
        phone_e164: str,
        message: str,
        request_id: str,
        code: str = "",
        purpose: str = "login",
    ) -> str:
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
    DevSMSSMSAdapter.slug: DevSMSSMSAdapter,
    EskizSMSAdapter.slug: EskizSMSAdapter,
    PlayMobileSMSAdapter.slug: PlayMobileSMSAdapter,
}


def get_sms_adapter() -> SMSAdapter:
    adapter_cls = _ADAPTERS.get(settings.SMS_PROVIDER)
    if adapter_cls is None:
        raise RuntimeError(f"Unknown SMS_PROVIDER: {settings.SMS_PROVIDER!r}")
    return adapter_cls()
