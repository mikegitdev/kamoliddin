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

## Staff auth

Staff use Django admin with phone + password (OTP is advertiser-only);
admin MFA remains an open hardening item ([R] "where feasible").
