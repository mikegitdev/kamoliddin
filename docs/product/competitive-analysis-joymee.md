# Competitive Analysis — Joymee.uz

**Source:** https://joymee.uz/ (homepage, `/support`, `/partnership`, sitemap, i18n store in `__NEXT_DATA__`) · **Date:** October 2026

**Joymee in one line:** map-first real-estate listings for Uzbekistan (Next.js, uz/ru/en, native apps), monetized by paid placement + Raise/TOP/VIP boosts paid from a prepaid wallet (card or Paynet cash), with Telegram-based support and manual verification.

**Our stance:** keep the product small. Borrow only what is cheap to build, cheap to maintain, and directly helps an advertiser pay or pay again. Everything else is listed once below so it isn't re-proposed.

---

## Borrow (MVP)

- [ ] **1. Payment-return page.** CLICK return target shows "Payment result — press Close to return" instead of a blank page. Protects the only revenue path (spec §12). *Frontend only.*
- [ ] **2. Views and clicks per campaign.** Count ad opens and contact/directions clicks per placement (counts only, no visitor data) and show the two numbers in `/app`. This is the one thing that gives an advertiser a reason to pay again (spec §1 [R]; not instrumented yet). *One small table + one endpoint.*
- [ ] **3. Report reason picker.** Replace the free-text report box with 4 fixed reasons (fake · wrong location · offensive · other) + optional text. Faster staff triage, no new workflow (spec §3, §14). *One choice field.*
- [ ] **4. "Put your location on the map precisely" hint** in the location editor. *Copy only, RU/UZ.*

## Not doing (and why)

| Idea from Joymee | Why not |
|---|---|
| Telegram OTP | New channel, not a drop-in adapter; revisit only if SMS cost becomes material after the Eskiz benchmark |
| Passport/selfie verification, badges | Identity documents = legal + storage burden; existing staff flags (spec §3) are enough |
| Prepaid wallet, Paynet cash | A ledger next to CLICK — conflicts with ADR-0007, needs legal review |
| Raise/TOP/VIP boosts, individual pricing | Excluded [C]: premium ranking, uniform daily price (spec §1, §6) |
| Active-sessions screen, saved searches, nearby ads, duplicate-image detection, post-campaign survey, JSON-LD/sitemaps, relative-time strings | Nice-to-have; each adds code to maintain without moving payments |
| Chat, reviews, video, EN locale, native apps | Excluded [C] (spec §1) |
| Real-estate forms, mortgage leads | Different vertical |
