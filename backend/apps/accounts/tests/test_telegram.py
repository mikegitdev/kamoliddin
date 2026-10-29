"""Telegram OTP delivery channel (spec §9, ADR-0006).

Invariants under test:
- enrollment is the ONLY path to a phone->chat binding: an HMAC-signed,
  TTL-bound start token issued to the *authenticated* user, resolved by the
  secret-token-gated bot webhook;
- login codes prefer the enrolled chat and never touch Telegram for
  phone-change challenges (they prove ownership of a DIFFERENT number);
- SMS is always available: explicit channel=sms, blocked-bot unbind, and
  delivery failures all fall back to SMS;
- account deletion and blocking the bot drop the binding.
"""

import random
import re

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts import telegram as telegram_module
from apps.accounts.services import delete_account, request_phone_change

pytestmark = pytest.mark.django_db

SECRET = "test-webhook-secret"
TG_SETTINGS = dict(
    TELEGRAM_BOT_TOKEN="test-bot-token",
    TELEGRAM_BOT_USERNAME="test_bot",
    TELEGRAM_WEBHOOK_SECRET=SECRET,
    SMS_PROVIDER="fake",
    OTP_DEV_ECHO=True,
)


class RecordingTelegram:
    slug = "recording"

    def __init__(self, fail_with=None):
        self.sent: list[tuple[int, str]] = []
        self.fail_with = fail_with

    def send_message(self, *, chat_id, text, request_id):
        if self.fail_with is not None:
            raise self.fail_with
        self.sent.append((chat_id, text))
        return len(self.sent)


class RecordingSMS:
    slug = "recording"

    def __init__(self):
        self.sent: list[str] = []

    def send_otp(self, *, phone_e164, message, request_id, code="", purpose="login"):
        self.sent.append(message)

    def get_delivery_status(self, provider_message_id):
        return "delivered"


def _wire(monkeypatch, tg: RecordingTelegram | None, sms: RecordingSMS | None):
    if tg is not None:
        monkeypatch.setattr(telegram_module, "get_telegram_adapter", lambda: tg)
    if sms is not None:
        monkeypatch.setattr("apps.accounts.sms.get_sms_adapter", lambda: sms)


def _ip() -> str:
    # Unique source IP per call: the otp scope throttles by IP.
    return f"10.{random.randint(1, 250)}.{random.randint(1, 250)}.{random.randint(2, 250)}"


def _otp_request(phone: str, channel: str | None = None):
    payload = {"phone": phone}
    if channel:
        payload["channel"] = channel
    return APIClient().post("/api/v1/auth/otp/request", payload, format="json", REMOTE_ADDR=_ip())


def _webhook(update: dict, secret: str = SECRET):
    return APIClient().post(
        "/api/v1/auth/telegram/webhook", update, format="json",
        headers={"X-Telegram-Bot-Api-Secret-Token": secret},
    )


def _start_update(token: str, chat_id: int) -> dict:
    return {"message": {"chat": {"id": chat_id, "type": "private"},
                        "text": f"/start {token}"}}


def _bind(owner, monkeypatch, tg: RecordingTelegram, chat_id: int = 4242) -> str:
    """Full enrollment: link request -> webhook start -> returns start token."""
    client = APIClient()
    client.force_authenticate(user=owner)
    response = client.post("/api/v1/auth/telegram/bind")
    assert response.status_code == 202
    link = response.data["link"]
    assert link.startswith("https://t.me/test_bot?start=")
    token = link.rsplit("=", 1)[1]
    # Bot API deep linking: <=64 chars of [A-Za-z0-9_-] only — anything else
    # (e.g. '.') is dropped by Telegram clients and enrollment never completes.
    assert re.fullmatch(r"[A-Za-z0-9_-]{1,64}", token)
    _wire(monkeypatch, tg, None)
    assert _webhook(_start_update(token, chat_id)).status_code == 200
    owner.refresh_from_db()
    assert owner.telegram_chat_id == chat_id
    return token


# --- Enrollment -------------------------------------------------------------------


@override_settings(**TG_SETTINGS)
def test_bind_link_and_webhook_complete_enrollment(owner, monkeypatch):
    tg = RecordingTelegram()
    _bind(owner, monkeypatch, tg, chat_id=111)
    # The user was told, in the chat, that codes will arrive there.
    assert tg.sent and "linked" in tg.sent[0][1]
    # Status endpoint agrees; a second link request is refused.
    client = APIClient()
    client.force_authenticate(user=owner)
    assert client.get("/api/v1/auth/telegram/bind").data["bound"] is True
    assert client.post("/api/v1/auth/telegram/bind").status_code == 409


@override_settings(**TG_SETTINGS)
def test_webhook_rejects_missing_or_wrong_secret(owner, monkeypatch):
    tg = RecordingTelegram()
    token = _bind(owner, monkeypatch, tg)
    # Unbind first so the (rejected) replay could otherwise succeed.
    owner.telegram_chat_id = None
    owner.save(update_fields=["telegram_chat_id"])
    wrong = APIClient().post(
        "/api/v1/auth/telegram/webhook", _start_update(token, 999), format="json",
        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
    )
    missing = APIClient().post(
        "/api/v1/auth/telegram/webhook", _start_update(token, 999), format="json"
    )
    assert wrong.status_code == 403
    assert missing.status_code == 403
    owner.refresh_from_db()
    assert owner.telegram_chat_id is None  # nothing bound


@override_settings(**TG_SETTINGS)
def test_webhook_invalid_token_replies_without_binding(owner, monkeypatch):
    tg = RecordingTelegram()
    _wire(monkeypatch, tg, None)
    response = _webhook(_start_update("garbage.token", 555))
    assert response.status_code == 200
    owner.refresh_from_db()
    assert owner.telegram_chat_id is None
    assert tg.sent and "expired" in tg.sent[0][1]


@override_settings(**TG_SETTINGS)
def test_expired_token_cannot_bind(owner, monkeypatch):
    tg = RecordingTelegram()
    _wire(monkeypatch, tg, None)
    token = telegram_module.make_bind_token(owner)
    # Token TTL (600s) has passed since issuance.
    real_time = telegram_module.time.time
    monkeypatch.setattr(telegram_module.time, "time", lambda: real_time() + 3600)
    response = _webhook(_start_update(token, 777))
    assert response.status_code == 200
    owner.refresh_from_db()
    assert owner.telegram_chat_id is None


@override_settings(**TG_SETTINGS)
def test_replayed_token_never_steals_a_chat(owner, other_owner, monkeypatch):
    tg = RecordingTelegram()
    token = _bind(owner, monkeypatch, tg, chat_id=111)
    # Same token from a different chat: owner already bound — refused.
    assert _webhook(_start_update(token, 222)).status_code == 200
    owner.refresh_from_db()
    assert owner.telegram_chat_id == 111
    # A different user's fresh token cannot claim the bound chat either.
    other_token = telegram_module.make_bind_token(other_owner)
    assert _webhook(_start_update(other_token, 111)).status_code == 200
    other_owner.refresh_from_db()
    assert other_owner.telegram_chat_id is None


# --- Delivery ---------------------------------------------------------------------


@override_settings(**TG_SETTINGS)
def test_login_code_prefers_telegram_and_verifies(owner, monkeypatch):
    tg, sms = RecordingTelegram(), RecordingSMS()
    _bind(owner, monkeypatch, tg, chat_id=4242)
    tg.sent.clear()  # drop the enrollment confirmation reply
    _wire(monkeypatch, tg, sms)
    response = _otp_request(owner.phone_e164)
    assert response.status_code == 202
    # Delivered to the chat, not SMS.
    assert len(tg.sent) == 1 and sms.sent == []
    match = re.search(r"\b(\d{6})\b", tg.sent[0][1])
    assert match, tg.sent[0][1]
    verify = APIClient().post(
        "/api/v1/auth/otp/verify",
        {"phone": owner.phone_e164, "code": match.group(1)},
        format="json", REMOTE_ADDR=_ip(),
    )
    assert verify.status_code == 200
    assert verify.data["phone_e164"] == owner.phone_e164


@override_settings(**TG_SETTINGS)
def test_channel_sms_forces_sms_for_bound_account(owner, monkeypatch):
    tg, sms = RecordingTelegram(), RecordingSMS()
    _bind(owner, monkeypatch, tg, chat_id=4242)
    tg.sent.clear()
    _wire(monkeypatch, tg, sms)
    response = _otp_request(owner.phone_e164, channel="sms")
    assert response.status_code == 202
    assert tg.sent == [] and len(sms.sent) == 1


@override_settings(**TG_SETTINGS)
def test_blocked_bot_drops_binding_and_falls_back_to_sms(owner, monkeypatch):
    from apps.accounts.telegram import TelegramForbiddenError

    tg = RecordingTelegram()
    _bind(owner, monkeypatch, tg, chat_id=4242)
    blocked, sms = RecordingTelegram(fail_with=TelegramForbiddenError("blocked")), RecordingSMS()
    _wire(monkeypatch, blocked, sms)
    response = _otp_request(owner.phone_e164)
    assert response.status_code == 202
    owner.refresh_from_db()
    assert owner.telegram_chat_id is None  # dead chat unbound
    assert len(sms.sent) == 1  # code still delivered
    code = response.data["dev_code"]  # dev echo (fake provider + OTP_DEV_ECHO)
    verify = APIClient().post(
        "/api/v1/auth/otp/verify",
        {"phone": owner.phone_e164, "code": code},
        format="json", REMOTE_ADDR=_ip(),
    )
    assert verify.status_code == 200


@override_settings(**TG_SETTINGS)
def test_transparent_telegram_failure_keeps_binding_and_uses_sms(owner, monkeypatch):
    tg = RecordingTelegram()
    _bind(owner, monkeypatch, tg, chat_id=4242)
    down, sms = RecordingTelegram(fail_with=OSError("network down")), RecordingSMS()
    _wire(monkeypatch, down, sms)
    assert _otp_request(owner.phone_e164).status_code == 202
    owner.refresh_from_db()
    assert owner.telegram_chat_id == 4242  # transient failure keeps the binding
    assert len(sms.sent) == 1


@override_settings(**TG_SETTINGS)
def test_phone_change_code_never_goes_to_telegram(owner, monkeypatch):
    tg, sms = RecordingTelegram(), RecordingSMS()
    _bind(owner, monkeypatch, tg, chat_id=4242)
    tg.sent.clear()
    _wire(monkeypatch, tg, sms)
    request_phone_change(owner, "+998901234998")
    assert tg.sent == [] and len(sms.sent) == 1


@override_settings(**TG_SETTINGS)
def test_unknown_phone_stays_sms_only(owner, monkeypatch):
    tg, sms = RecordingTelegram(), RecordingSMS()
    _wire(monkeypatch, tg, sms)
    assert _otp_request("+998909999999").status_code == 202
    assert tg.sent == [] and len(sms.sent) == 1


# --- Unbinding --------------------------------------------------------------------


@override_settings(**TG_SETTINGS)
def test_unbind_endpoint_restores_sms_delivery(owner, monkeypatch):
    tg, sms = RecordingTelegram(), RecordingSMS()
    _bind(owner, monkeypatch, tg, chat_id=4242)
    client = APIClient()
    client.force_authenticate(user=owner)
    assert client.delete("/api/v1/auth/telegram/bind").status_code == 204
    tg.sent.clear()
    _wire(monkeypatch, tg, sms)
    assert _otp_request(owner.phone_e164).status_code == 202
    assert tg.sent == [] and len(sms.sent) == 1


@override_settings(**TG_SETTINGS)
def test_blocking_the_bot_my_chat_member_unbinds(owner, monkeypatch):
    tg = RecordingTelegram()
    _bind(owner, monkeypatch, tg, chat_id=4242)
    update = {
        "my_chat_member": {
            "chat": {"id": 4242, "type": "private"},
            "new_chat_member": {"status": "kicked"},
        }
    }
    assert _webhook(update).status_code == 200
    owner.refresh_from_db()
    assert owner.telegram_chat_id is None


@override_settings(**TG_SETTINGS)
def test_account_deletion_clears_the_binding(owner, monkeypatch):
    tg = RecordingTelegram()
    _bind(owner, monkeypatch, tg, chat_id=4242)
    delete_account(owner)
    owner.refresh_from_db()
    assert owner.telegram_chat_id is None
