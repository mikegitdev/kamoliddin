# Competitive Analysis — Joymee.uz

**Source:** https://joymee.uz/ (homepage, `/support`, `/partnership`, sitemap, i18n store in `__NEXT_DATA__`) · deep dive October 2026 (public API `api.joymee.uz/api/v1`, webpack bundles, locale files)

**Joymee in one line:** map-first real-estate listings for Uzbekistan (Next.js, uz/ru/en, native apps), monetized by paid placement + Raise/TOP/VIP boosts paid from a prepaid wallet (card or Paynet cash), with Telegram-based support and manual verification.

**Our stance:** keep the product small. Borrow only what is cheap to build, cheap to maintain, and directly helps an advertiser pay or pay again. Everything else is listed once below so it isn't re-proposed.

---

## Borrow (MVP)

- [ ] **1. Payment-return page.** CLICK return target shows "Payment result — press Close to return" instead of a blank page. Protects the only revenue path (spec §12). *Frontend only.* Status: the checkout page already shows processing, paid and cancelled states when the customer returns; the CLICK return path stays gated on open question 1.
- [x] **2. Views and clicks per campaign.** Count ad opens and contact/directions clicks per placement (counts only, no visitor data) and show the two numbers in `/app`. This is the one thing that gives an advertiser a reason to pay again (spec §1 [R]; not instrumented yet). *One small table + one endpoint.* Done: `CampaignEvent` (kind + time only), `POST /public/campaigns/{id}/events`, counts shown on the campaign detail page.
- [x] **3. Report reason picker.** Replace the free-text report box with 4 fixed reasons (fake · wrong location · offensive · other) + optional text. Faster staff triage, no new workflow (spec §3, §14). *One choice field.* Done: `Report.category` (spam · offensive · prohibited · outdated · other), shown in the staff queue. Five reasons instead of four, so prohibited-content reports keep their own bucket under the advertising content rules.
- [x] **4. "Put your location on the map precisely" hint** in the location editor. *Copy only, RU/UZ.* Done in the branch form.
- [x] **5. Paid visibility add-ons — TOP / RAISED (Joymee borrow #3).**
  Product owner lifted the "no premium ranking in MVP" exclusion on 2026-10-31
  (spec §1 amended, open-questions.md #17). Done: `Placement.promotion_tier` +
  `OrderItem.promotion_tier`/`promotion_line_total` + `Tariff.amount_{top,raised}_per_24h`;
  one-time checkout add-on (no wallet, ADR-0007 intact); feed ranking
  TOP block → RAISED block → organic with promo-leading keyset cursor;
  `promotion` field on nearby cards / ad detail / branch sheet; TOP/UP badges;
  editor picker with live surcharge. Uniform per-24h tier prices only
  (spec §6 [C] intact). Grants never carry a tier (spec §7.4).
- [x] **6. Promote a running ad (Joymee `/profile/tariff/{id}` equivalent).**
  2026-11-01: `POST /orders/promotion-quote` buys TOP/RAISE days (1..30) for
  one ACTIVE placement as a separate one-time order (`Order.kind=promotion`,
  `promoted_placement` link). No capacity consumed, no new placement; settlement
  stamps `[now, now+days)` on the placement (`promotion_started_at`/
  `promotion_ends_at`); refund ends the window, records kept. Per-row
  "Promote" button + tier/days dialog in the cabinet; promotion-order summary
  in checkout/order detail. One live promo per placement (OQ #18).
- [x] **7. Featured strip (Joymee `/announcement/vip/` pool equivalent).**
  2026-11-01: `GET /public/featured` — one card per campaign whose TOP window
  is live right now, nearest-first with lat/lon, recency-ordered without;
  horizontal carousel above the ads list (auto-hidden when nothing is live).
  Not a third pricing tier — the showcase reuses TOP (OQ #18).
- [x] **8. Verified business badge (Joymee's blue check, minus documents).**
  2026-11-01: `Business.is_verified` + staff `POST /admin/businesses/{id}/verify|
  unverify` (reason → ActivityEvent; no-op repeats → 409). Badge exposed on
  pins, location/ad detail, nearby cards and the admin list; owners read-only.
  Deliberately NO passport/selfie pipeline — staff judgment only (OQ #19).
- [x] **9. Outcome survey (Joymee's "were you able to sell?" loop).**
  2026-11-01: `CampaignOutcome` (one per campaign, immutable) +
  `POST /campaigns/{id}/outcome`; opens only after every placement ended
  (`not_ended` / `already_answered` guards). Asked once in the cabinet with
  three fixed answers; `outcome` + `outcome_eligible` on the campaign payload
  (annotation-backed, lists stay N+1-free). Telemetry for pricing, never public.

## Not doing (and why)

| Idea from Joymee | Why not |
|---|---|
| Prepaid wallet, Paynet cash, 402-shortfall dialog | A ledger next to CLICK — conflicts with ADR-0007, needs legal review. Both promotion products ride one-time orders instead (owner decision 2026-11-01: no wallet) |
| Promo "packages" (prepaid bundles of top-days/vip-days/raises) | Requires the wallet above; revisit only with a second revenue-grade payment product |
| Individual/agent tariff builder | Excluded [C]: uniform platform pricing (spec §6) |
| Telegram OTP | New channel, not a drop-in adapter; revisit only if SMS cost becomes material after the Eskiz benchmark |
| Passport/selfie verification documents | Identity documents = legal + storage burden. The shipped badge (#8) is staff judgment, no document collection |
| Active-sessions screen, saved searches, duplicate-image detection, JSON-LD/sitemaps, relative-time strings | Nice-to-have; each adds code to maintain without moving payments |
| Chat, reviews, video reels, EN locale, native apps | Excluded [C] (spec §1) |
| Real-estate forms, mortgage leads, buyer-request posts | Different vertical |

---

## Deep-dive mechanics observed (October 2026, public evidence)

Reverse-engineered from the production site's webpack bundles, the public
`api.joymee.uz/api/v1` endpoints and the `locales/en/*.json` glossary
(~52k listings live, 139 pages of VIP inventory). Recorded here so the
mechanics are citable without re-crawling.

### Promotion model (their equivalent of our campaigns)

- A listing carries a `subscription` state; live API ordering with
  `perPageTop=5&perPageRaised=5&perPagePlain=10` returns exactly:
  5× `subscription=2` (TOP) → 5× `subscription=3` (RAISED) → `null` (organic,
  by `ads_at` desc). `ads_at` doubles as the "raised-at"/bumped timestamp.
- VIP (`subscription:"VIP"`) is a **separate rotating pool** served from
  `/announcement/vip/` — a carousel, not a search-rank tier.
- Cards show tier badges: crown = VIP, chevron-up = TOP (no badge for plain).
- Seller's own list: an unpromoted listing gets an **"Advertise"** CTA →
  `/profile/tariff/{id}` (tier picker); promoted ones show
  isTop/isVip/isRaised flags and lose the CTA.

### Tariffs = prepaid packages

- `simpleTariff` / `premiumTariff` (+ admin-built `systemTariff` /
  `individualTariff`): bundles of *number of ads*, *raise days*, *top days*,
  *VIP days*, with `durationOfTariff` (package validity) separate from
  `durationOfEachTariff` (per-ad promo duration) and a "N left" counter.
- Marketing copy ships per tier: "{{multiplier}} more views",
  "3× more powerful than Turbo", "Maximum views".

### Wallet & payments

- Prepaid balance (UZS), top-up by card or **Paynet cash terminals**
  (min 1,000 UZS; step-by-step Paynet instructions in the app).
- Activating a listing that costs money returns **HTTP 402** with
  `{payment: {price, balance, shortfall}}`; the UI shows a three-row dialog
  (Price / Balance / Top-up needed) and a deep link to
  `/profile/balance?amount=<shortfall>` — one-tap top-up of the exact gap.
- Transaction history splits top-ups vs expenses ("Deducted" rows).

### Listing lifecycle

- draft → moderation (`inProgress`) → active → `timeDeactive` (expiry) /
  `userDeactive` / `moderatorDeactive` / `reportDeactive` (with a reason
  dialog + "contact support" escape hatch) / `blockDeactive`; status 8 = deleted.
- Reactivation re-enters moderation. Bulk status transfer & bulk deactivate.
- Post-expiry "sold?" survey: *sold via Joymee / sold elsewhere / not selling* —
  their conversion-tracking loop.

### Discovery & anti-fraud signals

- Map-first: `/announcement/map/` (radius search, rounded to 3 decimals),
  `/announcement/map/mini/` (0.02° preview cluster),
  buyer-request pins (`c_type=request`) — "I want to buy" posts on the same map.
- Filters: purpose (sale/rent/daily), property type, owner-vs-realtor,
  mortgage-available, last-week/last-month, price/area/rooms/floor bands.
- Per-listing stats `{views, calls, shares, comments, likes}` fed by a
  `statistic_update` endpoint (event_type CALL=2, SHARE=3);
  `previous_price` shown on detail (price-drop signal).
- Verified-profile flow runs through a Telegram bot with passport+selfie.

### What we adopted vs theirs

| Joymee mechanic | Ours |
|---|---|
| subscription tier on listing | `Placement.promotion_tier` (top/raised) |
| per-listing tariff page, wallet debit | `POST /orders/promotion-quote` — one-time order, window at settlement |
| perPageTop/Raised/Plain blocks | promo-leading ORDER BY + keyset cursor (no per-page caps — keyset stays exact) |
| VIP pool `/announcement/vip/` | `GET /public/featured` — live-TOP carousel above the ads list |
| crown/chevron badges | TOP/UP badges on cards, ad page, branch sheet, cabinet |
| verified badge via Telegram bot docs | staff verify/unverify action + blue check on public surfaces (no documents) |
| "were you able to sell?" survey | `CampaignOutcome`, asked once after all placements end |
| tariff packages, wallet, Paynet, 402 flow | not adopted (ADR-0007, owner decision) |
