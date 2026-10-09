"""Provider-neutral SMS adapter contract (spec §9).

`send_otp(phone_e164, message, request_id) -> provider_message_id`
`get_delivery_status(provider_message_id) -> str`

Only the fake adapter is implemented. Eskiz / Play Mobile adapters must be
written from verified provider documentation and benchmarked before production
selection — they intentionally raise NotImplementedError (repo AGENTS.md rule 4).
"""
from typing import Protocol

from django.conf import settings


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
    slug = "eskiz"

    def __init__(self) -> None:
        raise NotImplementedError(
            "Eskiz adapter pending provider verification/benchmark (spec §9, §19 [E])."
        )


class PlayMobileSMSAdapter:
    slug = "play_mobile"

    def __init__(self) -> None:
        raise NotImplementedError(
            "Play Mobile adapter pending provider verification/benchmark (spec §9, §19 [E])."
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
    return adapter_cls()  # type: ignore[return-value]
