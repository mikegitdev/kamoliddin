# Field Contract — advertiser-facing entities (required vs optional)

Status: **[R] recommended default** — this document is derived from code, not from a
product decision. Every layer mismatch is logged as an open question
(`open-questions.md` #11–#15) and keeps its `[O]` status until the maintainer or
product owner confirms. When code and this document disagree, **code wins** —
then this document is wrong and must be regenerated.

Scope: the **advertiser write path** — Business, Location (branch), Campaign, and
the quote/checkout request. Staff/moderation, payments internals (PaymentAttempt,
Refund), FreeGrant, and User/OTP are out of scope (read path for the public map is
also out of scope).

Sources of truth per layer:

- **DB** — `backend/apps/*/models.py` (NOT NULL = no `null=True`; blank = `blank=True`).
- **API** — `backend/apps/*/serializers.py`. DRF derives `required` from the model
  (`required=False` iff the model field has a default, `blank=True`, or `null=True`),
  so the model *is* the API requirement unless a serializer overrides it.
- **UI** — the cabinet forms: `BusinessProfilePage.tsx`, `BranchesPage.tsx`,
  `CampaignEditorPage.tsx`, `CheckoutPage.tsx`. The UI may gate **stricter** than
  the API; it never gates looser (every UI-required field is also API-required).

Legend: `req` = must be present/non-empty · `opt` = may be omitted · `RO` =
read-only in responses, rejects writes · `auto` = server-assigned, never sent by
the client · `—` = not exposed to this layer at all.

---

## 1. Business (`/api/v1/businesses`, spec §5; form: BusinessProfilePage)

| Field        | DB                     | API write (POST/PATCH)                | UI form            | Notes |
|--------------|------------------------|---------------------------------------|--------------------|-------|
| name         | NOT NULL, ≤200         | **req**, non-empty after trim         | **req**            | Save disabled until filled |
| category     | FK NOT NULL            | **req** (slug of an active category)  | **req** (select)   | Save disabled until chosen |
| slug         | NOT NULL, unique       | RO — generated `slugify(name)-xxxx`   | —                  | Uniqueness suffix, never user-typed |
| owner        | FK NOT NULL            | auto — from auth user                 | —                  | Not in serializer fields |
| logo_key     | blank, default `""`    | opt                                   | — **not editable** | Upload endpoint exists (`purpose=logos`), no cabinet input → OQ-15 |
| description  | blank, default `""`    | opt                                   | opt                | |
| phone        | blank, default `""`    | opt; if non-empty → normalized `+998…`| opt                | Clearable: UI sends `""` |
| telegram     | blank, default `""`    | opt; accepts `@handle`, `t.me/…` link, phone, or invite hash; stored bare | opt | Clearable via `""` |
| whatsapp     | blank, default `""`    | opt; `wa.me/…` link reduced to number | opt                | Clearable via `""` |
| site         | blank URLField         | opt (valid URL)                       | opt                | Clearable via `""` |
| status       | default `active`       | RO                                    | —                  | Staff-controlled |
| owner_phone  | —                      | RO (echo of owner auth phone)         | display only       | |
| created/updated | auto               | RO                                    | —                  | |

Deletion: only an **empty** business (no branches, campaigns, orders) —
`BusinessDetailView.perform_destroy`.

## 2. Location / branch (`/api/v1/businesses/{id}/locations`, `/api/v1/locations/{id}`; spec §5, §13; form: BranchesPage)

| Field        | DB                     | API write                             | UI form            | Notes |
|--------------|------------------------|---------------------------------------|--------------------|-------|
| business     | FK NOT NULL            | auto — from URL path (create)         | —                  | Ownership re-checked on every write |
| name         | NOT NULL, ≤200         | **req**                               | **req**            | `canSave` requires non-empty |
| address      | NOT NULL, ≤300         | **req**                               | **req**            | Owner-typed text, independent of map provider (spec §10) |
| city         | default `"Tashkent"`   | opt (defaults)                        | — **not exposed**  | Always stored as Tashkent today → OQ-14 |
| lon / lat → point | point NOT NULL, GiST | **req on create** (both, valid ranges); on PATCH both-or-neither (omit = keep pin) | **req** (map pin) | Edit form prefills the pin, so the UI always sends both; see note below |
| phone        | blank, default `""`    | opt; same normalization as Business   | opt                | Clearable: UI sends `""` (OQ-13 resolved) |
| telegram     | blank, default `""`    | opt; same as Business                 | opt                | Clearable via `""` |
| whatsapp     | blank, default `""`    | opt; same as Business                 | opt                | Clearable via `""` |
| hours        | JSON, blank, default `{}` | opt (JSON object, day → [open, close]) | opt (per-day time inputs) | Clearable: UI sends `{}` |
| status       | default `active`       | RO                                    | —                  | Staff-controlled |
| risk_flags   | JSON, default `[]`     | RO                                    | —                  | Staff/risk pipeline only |
| created/updated | auto               | RO                                    | —                  | |

Deletion: only a branch with **no order items, placements, or grants**
(`LocationDetailView.perform_destroy`).

## 3. Campaign (`/api/v1/campaigns`, `/…/{id}/submit`; spec §4, §7.1; form: CampaignEditorPage)

| Field          | DB                       | API write                             | UI form              | Notes |
|----------------|--------------------------|---------------------------------------|----------------------|-------|
| business       | FK NOT NULL              | **req on create**; immutable afterwards (PATCH with a different business is rejected) | auto (current business) | Moving a campaign is forbidden — re-review would be bypassed (spec §14) |
| headline       | NOT NULL, ≤200           | **req, ≥ 3 chars trimmed**            | **req, ≥ 3 chars trimmed** | UI/API aligned (OQ-11 resolved) |
| body           | blank, default `""`      | opt                                   | opt                  | |
| banner_key     | NOT NULL, **no blank**   | **req**, non-empty string             | draft: opt — UI substitutes sentinel `banners/placeholder.jpg`; submit/quote: **req** (real upload) → OQ-12 | Exactly one banner (spec §4). Uploaded via `/media/upload` first, key then sent |
| review_status  | default `draft`          | RO (changed only via `/submit` and moderation) | display only    | Approved ≠ live (spec §7) |
| review_version | default 1                | RO — bumped by content edit after approval | display only   | |
| created/updated | auto                   | RO                                    | —                    | |

Lifecycle gating in the UI (all server-enforced too): draft save needs headline
only; **submit** additionally needs a real banner; **quote/pay** additionally
needs campaign submitted/under-review/approved, ≥ 1 location, and a start not in
the past. Content edits while `submitted`/`under_review`/`suspended` are locked
out both client- and server-side.

Deletion: **drafts only** (`CampaignDetailView.perform_destroy`).

## 4. Quote & checkout (`/api/v1/orders/quote`, `/…/{id}/checkout`; spec §6, §7.2; forms: CampaignEditorPage stage 2/3, CheckoutPage)

### 4.1 QuoteRequest (POST /orders/quote) — all fields **req**

| Field              | API rules                                                                 | UI equivalent                          |
|--------------------|---------------------------------------------------------------------------|----------------------------------------|
| business_id        | req; must be owned by caller                                              | auto (current business)                |
| campaign_id        | req; must belong to that business **and** be submitted/under_review/approved | auto (saved campaign)                |
| location_ids       | req, non-empty, ≤ 100; all must be own **active** branches; capacity checked per location (spec §14) | req — ≥ 1 checkbox selected          |
| requested_start_at | req; must not be in the past (grace: now − 60 s)                          | req — `startInPast` blocks quoting    |
| requested_end_at   | req; must be strictly after start                                         | req — `scheduleOk` gates stage 3       |

### 4.2 Checkout (POST /orders/{id}/checkout)

| Field      | API                          | UI                          |
|------------|------------------------------|------------------------------|
| return_url | **opt** (`required=False`, default `""`) | auto — page always sends its own URL |

### 4.3 Order / OrderItem — no advertiser-writable fields

Everything on the order is **server-generated and read-only**: `amount_total`,
`currency`, `state`, `quote_expires_at`, `interval_start_at` / `interval_end_at`
(quote snapshot), and each OrderItem's `unit_rate_snapshot`, `charge_days`
(`ceil(duration/24h)`, ≥ 1, spec §6), `line_total`. Totals are snapshotted at
quote time and immutable once paid. The CheckoutPage has no user-editable money
fields — only the pay-method choice and the redirect.

## 5. Cross-cutting rules

- **Contact normalization** (`apps/businesses/contacts.py`) applies to Business
  *and* Location: `phone`/`whatsapp` are stored as normalized `+998XXXXXXXXX`;
  `telegram` as a bare handle, `+998…` phone, or invite hash. All three are
  optional everywhere but **validated when non-empty** — garbage is rejected at
  the API, so the public call/message buttons always resolve.
- **Campaign validation**: the UI and API both require at least 3 trimmed
  headline characters (OQ-11 resolved). Banner-less draft handling remains a
  layer mismatch (OQ-12).
- **Omission preserves existing values on PATCH**: the Business and Location
  forms send `""` to clear contacts; the Location form sends `{}` to clear
  hours (OQ-13 resolved).

## 6. Mismatches and resolved items

| OQ | Layer gap | Where |
|----|-----------|-------|
| 11 | Resolved: UI and API both require at least 3 trimmed headline characters | `CampaignEditorPage` and `CampaignSerializer.validate_headline` |
| 12 | Banner-less drafts: model/API require a non-empty `banner_key`; UI papers over it with the sentinel `banners/placeholder.jpg` — a key that **does not exist in media storage** (broken image on such drafts) | `CampaignEditorPage.PLACEHOLDER_BANNER` |
| 13 | Resolved: Location contacts clear via `""` and hours via `{}` on PATCH; Business contacts also clear via `""` | `BranchesPage` save payload and `BusinessProfilePage` |
| 14 | `Location.city` is writable in the API but not exposed in the UI — every branch is stored as "Tashkent" | `LocationSerializer` vs `BranchesPage` |
| 15 | `Business.logo_key` is API-optional with an upload path (`purpose=logos`) but no cabinet UI | `BusinessProfilePage` |

Each row is mirrored in `docs/architecture/open-questions.md` (#11–#15) for
decision tracking, including resolved items; none of them is a silent contract.
