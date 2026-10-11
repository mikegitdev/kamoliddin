# Runbook: Account Recovery & Phone Management

Covers the three manual-recovery scenarios the product does **not** self-serve
(spec §3: advertisers are phone-OTP only — no email, no passwords):

1. Owner lost access to their phone number.
2. Suspected account takeover / disputed phone change.
3. Deleted-account dispute (refund or restoration questions).

Related code: `apps/accounts/services.py` (phone change, soft delete),
`apps/accounts/models.py` (`PhoneChangeRecord`), cabinet UI `/app/account`.

## How phone identity works

- Login is OTP to the current `phone_e164`; there is no password and no email.
- Changing phones requires an OTP sent to the **new** number
  (`POST /api/v1/auth/phone/change/request` → `verify`).
- After a change (or deletion), the **abandoned** number cannot register a new
  account for `PHONE_RECLAIM_BLOCK_DAYS` (default **30**) — recycled-SIM
  takeover guard. Blocks are visible as `PhoneChangeRecord` rows.
- Account deletion is **soft**: phone anonymized (`+998000xxxxxx`), user
  deactivated, businesses disabled (placements hide), auto-renewals cancelled;
  orders/payment records are retained (spec §14). Refunds stay manual.

## Scenario 1 — Owner lost the phone number

1. Identity verification (do ALL, log the outcome in the moderation note):
   - the claimant can show recent **paid orders** for the business
     (amount, date, last 4 digits of the card if available from provider);
   - the claimant can name the business profile fields that are not public
     (e.g. exact creation date, campaign drafts, internal notes);
   - the phone number's ownership evidence (operator contract) if disputed.
2. In Django admin → **Accounts → Users**: find the user by current
   `phone_e164`. If the number was already changed away, find the user via
   **Phone change records** (search old/new number).
3. Set the new number: edit `phone_e164` to the verified replacement.
   - If that number is reclaim-blocked by a recent change, either wait out the
     block or delete the blocking `PhoneChangeRecord` row (admin) — only when
     identity is fully verified.
   - **Never** hand over an account when verification is partial; escalate.
4. The user logs in via OTP to the new number. Old sessions survive; ask the
   user to log out everywhere if takeover is suspected (or flush their
   sessions by toggling `is_active` off/on is NOT recommended — instead ask
   them to use "Выйти"; sessions are cookie-based).

## Scenario 2 — Disputed phone change / takeover

1. Open **Phone change records** for the account; the latest row shows
   `old → new` and the block window.
2. If the change was unauthorized:
   - verify identity against the OLD number per Scenario 1;
   - restore `phone_e164` to the old number via admin;
   - create a `PhoneChangeRecord` row for the reversal so the attacker's
     number becomes reclaim-blocked (mirror the fields; set a 30-day window);
   - consider moderation takedown of any content published in the window.
3. Check **OTP challenges** for a burst of `phone_change` requests — a
   fingerprint of a takeover attempt.

## Scenario 3 — Deleted-account dispute

- Deletion is irreversible from the UI side: the phone is anonymized and the
  user row is deactivated. **Do not** try to "restore" by editing the
  anonymized phone unless identity is verified (Scenario 1 checklist); the
  businesses stay disabled — re-enable via moderation if a paid-term dispute
  is resolved in the customer's favor.
- Refunds for unused paid time after self-deletion follow the normal refund
  workflow (Billing → Refunds); deletion itself grants none.

## Constants

| Setting | Default | Notes |
|---|---|---|
| `PHONE_RECLAIM_BLOCK_DAYS` | 30 | Block window on abandoned numbers |
| `OTP_CODE_TTL_SECONDS` / attempts | 300 / 5 | OTP policy (spec §9) |
| Daily OTP quota | 20 / phone / purpose | Hard-coded in `services.py` |

Dev/E2E note: with `SMS_PROVIDER=fake` and `OTP_DEV_ECHO=1` (dev settings
only), OTP responses echo `dev_code` — never enable in prod.
