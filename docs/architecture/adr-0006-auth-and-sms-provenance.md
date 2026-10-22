# ADR-0006: Auth storage notes and SMS adapter provenance

**Status:** Accepted · **Date:** 2026-10-13

## OTP generation & storage

1. **OTP codes are generated with `secrets.randbelow`** (CSPRNG), not
   `random` — a security token must not come from the Mersenne Twister.
   Codes are stored only as HMAC-SHA256(phone:code) keyed with
   `SECRET_KEY`; attempts are capped; challenges expire.
2. **`OTPChallenge.phone_e164` is stored in plaintext next to
   `phone_hash`** (spec §5 lists only the hash). Tradeoff: lookup and
   per-phone throttling by E.164 without a hash index on a deterministic
   keyed column; the phone is anyway stored in cleartext on `User`. Accepted
   risk: the challenges table is a phone-number enumeration surface at rest;
   mitigate at rest with full-disk/backup encryption (deploy runbook).
3. **IP-level throttling** is the DRF scoped anon throttle on the views
   (5/min/IP); phone-level quota (20/day) and resend throttling live in the
   service. The dead `ip=` parameter was removed.

## Phone reclaim block

After a phone change or account deletion, the abandoned number is blocked
from new registration for `PHONE_RECLAIM_BLOCK_DAYS` (30) — recycled-SIM
takeover guard. Recorded via `PhoneChangeRecord`.

## SMS adapter provenance (repo rule 4 evidence)

- **EskizSMSAdapter** is implemented against Eskiz's *published* API
  documentation (official Postman collection `documenter.getpostman.com/
  view/663428`, SDKs) — endpoints `/api/auth/login`, `/api/message/sms/send`
  (form: `mobile_phone` as 998XXXXXXXXX, `message`, `from`),
  `/api/message/sms/status_by_id/{id}`; Bearer token auth. It is
  credential-gated (`ESKIZ_EMAIL`/`ESKIZ_PASSWORD`), NOT the default, and
  production selection still requires the Eskiz vs Play Mobile benchmark
  (spec §9, §19 [E]).
- **PlayMobileSMSAdapter** raises `NotImplementedError`: no verified public
  documentation was found; behavior must not be fabricated.

## Telegram delivery channel (added 2026-10-22)

Login codes may also be delivered over Telegram — cheaper and more reliable
in UZ than SMS — under an **enrollment model**, because the Bot API cannot
message a phone number and cannot see the sender's phone:

1. **Enrollment is the only phone→chat binding path.** The authenticated user
   requests a link from the cabinet; the server issues a one-time HMAC-signed
   start token (≤64 chars, 10-min TTL, keyed with `SECRET_KEY`). The user taps
   `t.me/<bot>?start=<token>` → Start; the bot webhook resolves the token to
   that user and binds `User.telegram_chat_id` (unique: one chat ↔ one
   account). A forwarded link cannot steal a chat: the token is per-user and
   binding succeeds only for an unbound user/chat pair.
2. **Login codes prefer the enrolled chat** (channel `auto`, the default);
   SMS remains available always: explicit `channel=sms` on the request forces
   it, and any Telegram delivery failure falls back to SMS. A documented
   HTTP 403 (bot blocked) also drops the binding; `my_chat_member=kicked`
   unbinds the chat as well. Deletion clears the binding.
3. **Phone-change challenges never use Telegram** — they prove ownership of a
   *different* number, and the binding belongs to the requesting account.
4. The webhook (`/api/v1/auth/telegram/webhook`) is gated on the `setWebhook`
   `secret_token` header, exempt from session/throttle (server-to-server),
   and always answers 200 so Telegram does not retry. Register it with
   `manage.py set_telegram_webhook <public-base-url>`.

Anti-enumeration is preserved: `otp/request` responses stay uniform regardless
of delivery channel. The Telegram adapter implements only the official Bot API
surface (`sendMessage`, `setWebhook` secret token, 403-on-block). Dev/test use
`FakeTelegramAdapter` (no token configured). `TELEGRAM_*` settings are separate
from the ops-alert bot (`OPS_TELEGRAM_BOT_TOKEN`, a different bot).

## Staff auth

Staff use Django admin with phone + password (OTP is advertiser-only);
admin MFA remains an open hardening item ([R] "where feasible").
