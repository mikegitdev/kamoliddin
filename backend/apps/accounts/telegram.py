"""Telegram OTP delivery channel (spec §9, ADR-0006).

The Bot API cannot message a phone number — only a chat the user has opened
with the bot. Delivery therefore targets an *enrolled* chat id: the user links
their Telegram from the account cabinet via a one-time, HMAC-signed deep link
(``t.me/<bot>?start=<token>``); the bot webhook completes the binding by
resolving the signed token to the authenticated user who requested it. Codes
are then delivered to that chat (free, reliable in UZ), with SMS kept as a
forced fallback: ``POST /auth/otp/request {"channel": "sms"}`` always uses SMS
and delivery failures fall back automatically.

Why enrollment instead of "enter phone, get code in Telegram": the webhook
cannot see the sender's phone number, so an unauthenticated phone->chat
delivery would let anyone receive the code for any number (account takeover).
Binding must be established under an authenticated session with a signed
token; phone-change challenges therefore NEVER use Telegram (they prove
ownership of a *different* number, spec §9).

Provenance (repo rule 4): TelegramBotAdapter implements only the official
Bot API reference (core.telegram.org/bots/api): ``sendMessage``,
``setWebhook`` with ``secret_token`` (echoed in the
``X-Telegram-Bot-Api-Secret-Token`` header on every webhook call), HTTP 403
for "bot was blocked by the user". Nothing beyond that surface is assumed.
"""
import base64
import binascii
import hashlib
import hmac
import json
import logging
import time
import urllib.error
import urllib.request
import uuid
from typing import Protocol

from django.conf import settings

logger = logging.getLogger(__name__)

WEBHOOK_HEADER = "X-Telegram-Bot-Api-Secret-Token"
# /start payloads are limited to 64 base64url characters (Bot API docs).
_TOKEN_PAYLOAD_BYTES = 16 + 4  # user UUID + uint32 expiry
_TOKEN_SIG_BYTES = 8


class TelegramError(Exception):
    """Delivery failed for a non-binding-related reason."""


class TelegramForbiddenError(TelegramError):
    """HTTP 403 — the bot was blocked by the user (or the chat is gone)."""


class TelegramAdapter(Protocol):
    slug: str

    def send_message(self, *, chat_id: int, text: str, request_id: str) -> int:
        """Send a text message; return the Bot API message id."""
        ...


class FakeTelegramAdapter:
    """Deterministic dev/test adapter: logs instead of calling Telegram."""

    slug = "fake"

    def send_message(self, *, chat_id: int, text: str, request_id: str) -> int:
        import sys

        print(  # noqa: T201
            f"[Telegram:fake] chat={chat_id} request_id={request_id} message={text!r}",
            file=sys.stdout,
            flush=True,
        )
        return 0


class TelegramBotAdapter:
    """Real adapter against the official Bot API (core.telegram.org/bots/api)."""

    slug = "telegram"

    def __init__(self) -> None:
        if not settings.TELEGRAM_BOT_TOKEN:
            raise RuntimeError(
                "TELEGRAM_BOT_TOKEN is required for the real Telegram adapter"
            )
        self.base_url = settings.TELEGRAM_API_BASE.rstrip("/")

    def _api(self, method: str, payload: dict) -> dict:
        url = f"{self.base_url}/bot{settings.TELEGRAM_BOT_TOKEN}/{method}"
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            url, data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            if exc.code == 403:
                raise TelegramForbiddenError(
                    "Telegram refused delivery (bot blocked by the user)"
                ) from None
            raise

    def send_message(self, *, chat_id: int, text: str, request_id: str) -> int:
        result = self._api("sendMessage", {"chat_id": chat_id, "text": text})
        return int(result["result"]["message_id"])

    def set_webhook(self, *, url: str, secret_token: str) -> None:
        """setWebhook: restrict updates to what the handler understands."""
        self._api(
            "setWebhook",
            {"url": url, "secret_token": secret_token,
             "allowed_updates": ["message", "my_chat_member"]},
        )


def get_telegram_adapter() -> TelegramAdapter:
    """Real adapter when a bot token is configured; fake otherwise (dev/test)."""
    return TelegramBotAdapter() if settings.TELEGRAM_BOT_TOKEN else FakeTelegramAdapter()


def telegram_enabled() -> bool:
    """Whether enrollment links can be issued (requires bot token + username)."""
    return bool(settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_BOT_USERNAME)


def webhook_secret() -> str:
    return settings.TELEGRAM_WEBHOOK_SECRET


# --- Enrollment tokens ------------------------------------------------------------
#
# Compact, HMAC-signed, <=64 chars so they fit the /start payload:
# b64url(uuid16 + uint32-exp) "." b64url(hmac-sha256[:8])


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sig(payload: bytes) -> bytes:
    return hmac.new(
        settings.SECRET_KEY.encode(), payload, hashlib.sha256
    ).digest()[:_TOKEN_SIG_BYTES]


def make_bind_token(user) -> str:
    payload = user.pk.bytes + int(
        time.time() + settings.TELEGRAM_BIND_TOKEN_TTL_SECONDS
    ).to_bytes(4, "big")
    return f"{_b64(payload)}.{_b64(_sig(payload))}"


def resolve_bind_token(token: str):
    """Return the (non-deleted) user a start-token refers to, or None.

    Constant-time signature comparison; expiry enforced against wall clock."""
    from .models import User

    parts = token.strip().split(".")
    if len(parts) != 2:
        return None
    try:
        payload = _unb64(parts[0])
        sig = _unb64(parts[1])
    except (ValueError, binascii.Error):
        return None
    if len(payload) != _TOKEN_PAYLOAD_BYTES or len(sig) != _TOKEN_SIG_BYTES:
        return None
    expected = _sig(payload)
    if not hmac.compare_digest(sig, expected):
        return None
    if int.from_bytes(payload[16:], "big") < time.time():
        return None  # expired
    return User.objects.filter(pk=uuid.UUID(bytes=payload[:16]), deleted_at__isnull=True).first()


def telegram_bind_link(user) -> str:
    return f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start={make_bind_token(user)}"
