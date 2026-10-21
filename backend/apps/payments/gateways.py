"""PaymentGateway contract (spec §2, §8, §12).

Providers are behind one interface so CLICK can be swapped for a fallback without
touching billing code. Per repo AGENTS.md rule 4: no fabricated provider behavior —
the CLICK adapter raises NotImplementedError until merchant capability is verified
against sandbox evidence (spec §19 [E]). The fake adapter is for dev/tests only.
"""
from dataclasses import dataclass
from typing import Protocol

from apps.billing.models import Order


@dataclass(frozen=True)
class CheckoutResult:
    provider_payment_id: str
    redirect_url: str  # provider-hosted payment page; return URL never authorizes alone


@dataclass(frozen=True)
class WebhookResult:
    event_id: str
    provider_payment_id: str
    amount_minor: int
    currency: str
    succeeded: bool
    raw_digest: str


class PaymentGateway(Protocol):
    slug: str

    def create_checkout(
        self, *, order: Order, idempotency_key: str, return_url: str
    ) -> CheckoutResult: ...

    def verify_webhook(self, *, payload: bytes, headers: dict[str, str]) -> WebhookResult:
        """Validate signature/timestamp/replay; raise on any mismatch."""
        ...

    def get_payment_status(self, *, provider_payment_id: str) -> str:
        """Authoritative status query — used by reconciliation, never blind retries."""
        ...

    def refund_charge(
        self, *, provider_payment_id: str, amount_minor: int, idempotency_key: str
    ) -> str:
        """Refund a succeeded charge; return the provider refund reference.
        Idempotent per idempotency_key (retrying must not double-refund)."""
        ...


class FakePaymentGateway:
    """Dev/test gateway. Simulates successful checkout so the happy path is
    demonstrable locally. MUST NOT be enabled in production."""

    slug = "fake"

    def create_checkout(
        self, *, order: Order, idempotency_key: str, return_url: str
    ) -> CheckoutResult:
        provider_payment_id = f"fake-{idempotency_key}"
        return CheckoutResult(
            provider_payment_id=provider_payment_id,
            redirect_url=f"/api/v1/payments/fake/checkout/{provider_payment_id}",
        )

    def verify_webhook(self, *, payload: bytes, headers: dict[str, str]) -> WebhookResult:
        import hashlib
        import json

        data = json.loads(payload)
        return WebhookResult(
            event_id=str(data["event_id"]),
            provider_payment_id=str(data["provider_payment_id"]),
            amount_minor=int(data["amount_minor"]),
            currency=str(data["currency"]),
            succeeded=bool(data["succeeded"]),
            raw_digest=hashlib.sha256(payload).hexdigest(),
        )

    def get_payment_status(self, *, provider_payment_id: str) -> str:
        # A completed fake checkout settles synchronously (FakeCheckoutCompleteView),
        # so any attempt still pending when reconciliation asks was abandoned.
        # Answering "succeeded" here would turn abandoned demo checkouts into
        # paid orders.
        return "expired"

    def refund_charge(
        self, *, provider_payment_id: str, amount_minor: int, idempotency_key: str
    ) -> str:
        return f"fake-refund-{idempotency_key}"


class ClickPaymentGateway:
    """CLICK adapter — placeholder until merchant capability is proven (spec §19).

    Required evidence before implementing: one-time checkout, callbacks, amount
    rules, refunds, settlement.
    """

    slug = "click"

    def __init__(self) -> None:
        raise NotImplementedError(
            "CLICK integration pending merchant verification (spec §19 [E]). "
            "Do not fabricate provider behavior."
        )

    def refund_charge(
        self, *, provider_payment_id: str, amount_minor: int, idempotency_key: str
    ) -> str:
        raise NotImplementedError(
            "CLICK refund pending merchant verification (spec §19 [E]); "
            "staff may supply a provider-console reference instead."
        )


_REGISTRY: dict[str, type] = {
    FakePaymentGateway.slug: FakePaymentGateway,
    ClickPaymentGateway.slug: ClickPaymentGateway,
}


def get_payment_gateway(provider_slug: str) -> PaymentGateway:
    gateway_cls = _REGISTRY.get(provider_slug)
    if gateway_cls is None:
        raise LookupError(f"No payment gateway registered for {provider_slug!r}")
    return gateway_cls()
