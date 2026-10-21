# Legal Review — MVP launch checklist (Uzbekistan)

**Purpose:** track the legal/compliance workstream for the Local Advertising Map Platform (Tashkent).
**Status:** open. Maps to spec §11 (security/privacy) and §19 external-verification row
*"Advertising/consumer/privacy/refund compliance in Uzbekistan — [E] Critical"*.
**Disclaimer:** this is an engineering-maintained checklist, **not legal advice**. Every item marked
**[E]** requires sign-off by qualified Uzbekistan counsel before launch. Law references below were
verified against lex.uz in October 2026 and must be re-checked at review time (legislation is
amended frequently — see the March 2026 personal-data amendment already noted below).

Related: `competitive-analysis-joymee.md` (competitor patterns: public offer accepted at signup,
public offererta/privacy pages, verification data handling note), ADR-0007 (one-time payments).

---

## 1. Legislation baseline (verified 2026-10, re-check at review)

| Law | Number / date | Relevance to us |
|---|---|---|
| On Advertising | **ЗРУ-776**, 07.06.2022 — [lex.uz/acts/6052633](https://lex.uz/uz/acts/6052633) | We are a **distributor of advertising** (platform showing paid business ads). Art. 31 extends general rules to internet advertising: ads must be identifiable, marked as advertising, not misleading/unethical; language and category-specific restrictions apply. |
| On Personal Data | **ЗРУ-547**, 02.07.2019 (new ed. 2023) + amendment **ЗРУ-1125**, 26.03.2026 — [lex.uz/docs/4396428](https://www.lex.uz/docs/4396428), [lex.uz/acts/8104580](https://lex.uz/en/acts/8104580) | Phone numbers (owners), hashed OTP data, verification documents, activity logs are personal data. State Register notification/registration of personal-data databases; **localization** may apply to certain data categories (Art. 27-1). |
| On Consumer Protection | **221-I**, 26.04.1996 (as amended; ЗРУ-911 of 21.02.2024 added e-commerce provisions, Art. 28-1) — [lex.uz/docs/14643](https://www.lex.uz/uz/docs/14643) | Advertisers are our consumers (B2B service). Refund/quality-of-service expectations, price transparency. |
| On E-Commerce | **ЗРУ-792**, 29.09.2022 — [lex.uz/acts/6213428](https://lex.uz/en/acts/6213428) | Electronic contract formation, order/payment records, refund mechanics for online services. |
| E-commerce transaction procedure | Decree **No. 185**, 02.06.2016 — [lex.uz/docs/2973942](https://www.lex.uz/en/docs/2973942) | Operational rules for electronic deals (refund/refusal clauses referenced by ЗРУ-792). |
| Payment services (CBU regulation) | TBD | CLICK (and Paynet if wallet/`B1` is pursued) operate as licensed payment agents; our receipts/reconciliation duties. **[E] Confirm exact instruments with counsel.** |

---

## 2. TODO — contractual

- [ ] **C1. Public offer (ommaviy offerta) for advertisers** — RU/UZ, published page. Must cover: service description (ad placement on map, per-24h billing unit), tariff setting rights, moderation and rejection rights, takedown of rule-violating content, campaign expiry semantics, late-moderation interval shift (spec §6), account/blocking rules. Pattern from Joymee: explicit offerta-consent checkbox at OTP signup.
- [ ] **C2. Refund policy** — closes spec §19 open item *"Partial term refund on administrative suspension"*. Decide and document: refund on paid-but-rejected campaign (spec §14), refund on admin takedown mid-term, refund window and method. Must be consistent with Consumer Protection Art. 28-1 expectations.
- [ ] **C3. Free-grant terms** — free placements (spec §7.4) are not payments; define in offerta so grants cannot be claimed as entitlements or "money owed".
- [ ] **C4. Verification terms** — if Telegram-based verification is adopted (borrow A3): purpose limitation ("documents used only for verification" — Joymee pattern), retention period, deletion after decision, right to refuse.
- [ ] **C5. Admin rights & content policy** — legal basis for moderation queue, suspension, impersonation takedowns (spec §3); forbidden-content list mirrored from ЗРУ-776 prohibited categories.
- [ ] **C6. Data-processing terms for SMS/Telegram OTP providers** (Eskiz / Play Mobile / Telegram bot) — sub-processor terms, breach notification.

## 3. TODO — personal data (ЗРУ-547)

- [ ] **P1. Privacy notice** (RU/UZ, linked in footer + at signup): controller identity, purposes (auth, service delivery, anti-fraud), legal basis, retention, data-subject rights, contacts.
- [ ] **P2. State Register check [E]** — determine whether our personal-data database requires **registration** in the State Register or notification-based treatment (as amended by ЗРУ-1125, 2026). File if required; deadline and authority confirmed by counsel.
- [ ] **P3. Localization check [E]** — Art. 27-1: verify whether phone numbers / OTP hashes / verification documents fall under mandatory in-country storage. We self-host on one VPS (Tashkent region presumed) — confirm the VPS location satisfies the rule; document backups destination (off-server but presumably in-country) and any third-party SaaS (map tiles, error tracking) receiving personal data.
- [ ] **P4. Data inventory & retention schedule** — per spec §9/§11: OTP hashes TTL, session records, activity log (append-only), phone_e164 lifetime, verification documents (if adopted) deleted after decision. Written down and reviewed by counsel.
- [ ] **P5. Consent artifacts** — store offerta/privacy acceptance version + timestamp per user; OTP send consent; no marketing use of collected phones without separate consent.
- [ ] **P6. Data-subject request procedure** — how a user requests access/correction/deletion; who processes (admin), SLA.
- [ ] **P7. Cookies/trackers notice** — sessions are HttpOnly cookies (essential); document if any analytics added later.

## 4. TODO — advertising content rules (ЗРУ-776)

- [ ] **L1. Ad marking [E]** — confirm with counsel whether platform-served business ads need explicit "Реклама/Advertisement" labeling distinct from organic business info, and what our duty as **distributor** is vs the advertiser's duty. Default safe design: visually distinct ad cards on location pages.
- [ ] **L2. Prohibited/restricted categories list** — mirror into moderation guidelines (spec §3): prohibited (tobacco etc.) and restricted categories with mandatory warnings; moderator checklist references the law.
- [ ] **L3. Language rule check** — ad copy in Uzbek generally expected; our RU/UZ UI exception for foreign-language sites likely does NOT transfer to ads. Confirm with counsel how bilingual (RU) ad copy is treated.
- [ ] **L4. Misleading-ad guidance** — moderation rejection reasons include "misleading claims" tied to ЗРУ-776 general standards; record decision in `CampaignReview` (spec §5) for audit.
- [ ] **L5. Residency rule** — both advertiser and distributor non-residents cannot distribute ads in UZ; our advertisers are local businesses — add a check for foreign-owned entities at business onboarding if counsel requires.

## 5. TODO — consumer protection & e-commerce (221-I / ЗРУ-792)

- [ ] **E1. Price transparency** — per-24h unit, `ceil()` day rounding, and the §19 open item: 25h request displays 25h but bills 2 units — disclosure must appear **before payment** (checkout screen wording, legally reviewed).
- [ ] **E2. Order/payment records** — ZRU-792 electronic-deal documentation: our Order/OrderItem snapshots + receipts satisfy record-keeping? Confirm retention period with counsel.
- [ ] **E3. Refund workflow legality** — admin-processed refunds (spec §7.2) must meet consumer-protection timelines; document SLA (e.g., X business days) in the public offer.
- [ ] **E4. Service-quality claims** — avoid promising views/clicks outcomes in marketing copy (we sell placement, not performance; counters in borrow A5 are informational).

## 6. TODO — payments & communications

- [ ] **M1. CLICK merchant agreement [E]** — already a spec §19 gate; legal review of their acquiring terms (fees, refund mechanics, chargebacks, webhook evidence standards) alongside the technical integration proof.
- [ ] **M2. Paynet cash top-up (only if wallet borrow B1 is approved)** — payment-agent licensing check, receipt obligations, reconciliation duty. Do not build before counsel sign-off.
- [ ] **M3. SMS/Telegram anti-spam** — OTP-only messages; no promotional SMS without separate opt-in; rate limits (spec §9) double as anti-spam compliance.
- [ ] **M4. Receipts** — UZS amounts, VAT treatment of our service [E] (determine VAT rate/exemption for ad-placement services; affects tariff display — gross vs net).

## 7. TODO — IP & media

- [ ] **I1. Banner/logo rights** — uploader warrants rights; takedown procedure for third-party IP complaints (abuse contact published).
- [ ] **I2. Map provider terms** — 2GIS licensing includes attribution and data-use obligations (spec §10); attribution string verified in UI before launch.

---

## 8. Open questions for counsel (blocking launch)

1. Database registration/notification duty under ЗРУ-547 as amended by ЗРУ-1125 — and timeline.
2. Does Art. 27-1 localization cover our data set (phones, hashes, logs) and our backup destination?
3. Our distributor vs advertiser responsibility split for ad content under ЗРУ-776 (labeling, prohibited categories, language).
4. VAT and fiscal-receipt (oferta/cheque) obligations for online ad services; does the CLICK flow satisfy them or do we need a separate fiscalization step?
5. Refund obligations matrix: rejected campaign, admin takedown mid-term, expired campaign, technical failure (spec §14 scenarios) — approve the C2 policy text.
6. Verification documents (borrow A3): legal basis to process passport scans via Telegram, retention limit.

## Definition of done for this checklist

All checkboxes above either completed or explicitly waived with a recorded reason; items marked **[E]**
carry a written counsel opinion (memo ID) attached to this folder; offerta + privacy pages published
in RU/UZ; C2 refund policy merged into the offerta; then spec §19 row can be marked delivered.
