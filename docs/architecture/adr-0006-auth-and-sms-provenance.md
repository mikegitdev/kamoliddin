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
3. **IP-level throttling** is the DRF scoped throttle on the views, with
   separate buckets: `otp_request` (5/min/IP, caps SMS spend) and
   `otp_verify` (20/min/IP). Amended 2026-10-23: one shared 5/min bucket
   allowed ~2 logins/min per IP, so a typo + resend locked users out, and
   carrier NAT puts many subscribers behind one IP. Verify brute force stays
   bounded per challenge by `OTP_MAX_ATTEMPTS` (5) and the 5-minute TTL.
   Phone-level quota (20/day) and resend throttling live in the service.
   The dead `ip=` parameter was removed.

## Phone reclaim block

After a phone change or account deletion, the abandoned number is blocked
from new registration for `PHONE_RECLAIM_BLOCK_DAYS` (30) — recycled-SIM
takeover guard. Recorded via `PhoneChangeRecord`.

## SMS adapter provenance (repo rule 4 evidence)

- **DevSMSSMSAdapter** is implemented against devsms.uz's *published* API v1
  agent reference (https://devsms.uz/docs/api/agents.md) — `POST /api/v1/sms`
  with the `otp` object (universal OTP: operator-pre-approved templates, only
  `service_name` is moderated), the `Idempotency-Key` header, and
  `GET /api/v1/sms/{id}` for status; Bearer key auth
  (`DEVSMS_API_TOKEN`, gated on presence). Selected as the production SMS
  provider by the product owner (2026-10-29): Telegram stays the preferred
  login channel; DevSMS carries first-login, forced-SMS (`channel=sms`) and
  phone-change codes. Unknown provider outcome (`502
  provider_outcome_unknown`) is charged-and-maybe-delivered: the challenge
  stands (no resend under a new key) and the incident is logged. The challenge
  UUID doubles as the Idempotency-Key, so same-key retries (e.g. after a
  timeout) never double-send or double-charge.
- **EskizSMSAdapter** is implemented against Eskiz's *published* API
  documentation (official Postman collection `documenter.getpostman.com/
  view/663428`, SDKs) — endpoints `/api/auth/login`, `/api/message/sms/send`
  (form: `mobile_phone` as 998XXXXXXXXX, `message`, `from`),
  `/api/message/sms/status_by_id/{id}`; Bearer token auth. It is
  credential-gated (`ESKIZ_EMAIL`/`ESKIZ_PASSWORD`), NOT the default, and
  remains the benchmark alternative (spec §9, §19 [E]).
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
