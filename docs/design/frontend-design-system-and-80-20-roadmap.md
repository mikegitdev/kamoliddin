# Local Ads — Frontend Design System & 80/20 Upgrade Guide

**Project:** Local Advertising Map Platform, Tashkent  
**Baseline:** Engineering specification dated 9 October 2026; current React frontend and Django public API  
**Status:** Design direction implemented in a first end-to-end pass (see §1a below for exactly what shipped and what remains deferred)
**Scope:** One consolidated audit, design system, main-page recommendations, delivery priorities, and acceptance checklist

> **Recommendation:** Keep the map-first product and existing blue/orange identity. Spend the first effort on usable mobile controls, readable shared components, informative location cards, and honest status messaging. Do not start with a new framework, a marketing landing page, or a complete rebrand.

## 1. Executive decision: what delivers the most value?

The product already has a useful foundation: a full-screen map, RU/UZ dictionaries, shared CSS variables, location sheets, skeletons, and advertiser routes. The highest-return work is to make that foundation consistent and usable, not replace it.

### The first five changes

1. **Fix the homepage before decorating it:** load MapLibre's stylesheet, remove mobile control overflow, and keep map attribution and zoom controls visible.
2. **Make search → location → contact a clear journey:** reorganize the selected-location card; put business identity, address, directions, and available contact actions before decorative imagery.
3. **Upgrade the shared visual foundations:** accessible text colors, predictable spacing, 44–48px controls, visible keyboard focus, and consistent buttons, fields, badges, and feedback.
4. **Explain what is happening:** distinguish loading, no results, network failure, and unavailable content; translate statuses rather than exposing API enum names.
5. **Make advertiser screens truthful and actionable:** correct “approved = active,” give the overview one obvious next action, and separate payment, moderation, and publication states.

### What “20% effort / 80% result” means here

This is a prioritization heuristic, **not a measured conversion promise**. No production funnel, traffic distribution, user interviews, or usability baseline was supplied. The expected leverage comes from fixing frequently used surfaces and shared styles once.

Assumption: the map homepage is the most important first impression, while advertiser onboarding and checkout are the most important revenue journeys. Validate that assumption with real usage later.

### 1a. Implementation status (first pass — shipped)

Implemented and verified in the running app (typecheck + lint + build green, browser-verified desktop 1512px and mobile 390px):

- **Foundations:** MapLibre base CSS imported; accessible token palette (AA pairs), spacing/control-height/focus/motion tokens; visible `:focus-visible`; `prefers-reduced-motion` support; 16px mobile input font.
- **Homepage `/`:** no horizontal overflow at 320–430px (was ~499px of overflow at 390px); brand / search / filters / «Для бизнеса» / language chrome that wraps into rows on mobile; compact floating result pill with pluralized RU/UZ counts (“22 точки · 18 объявлений”); legend; distinct loading / error+retry / empty+clear-filters states; zoom controls and attribution kept visible (offset below the toolbar, pill anchored left).
- **Map interactions:** per-pin active-ads count labels (distinct from cluster location counts); cluster tap drill-down (verified zoom 11.5→12); cursor affordances.
- **Location sheet & `/locations/:id`:** shared `ContactActions` (directions / call / Telegram / WhatsApp / site, only when data exists) in both the sheet and the detail page; removed the fake “ON” badge and the public coordinate badge; hours rendering when provided; honest empty-ads state; pluralized ads chip; ad grid via shared `AdCard`.
- **`/ads/:id`:** real `<img>` banner (aspect-ratio reserved, full artwork, alt = headline); unavailable (404) vs network-error states; originating-location context link preserved from sheet/detail navigation.
- **Banner editor (campaign editor):** dependency-free canvas editor opens when an image is picked — drag/keyboard crop with corner+edge handles and 3:1 (ad-page) / 16:9 / free aspect lock, brightness & contrast, output-width presets that never upscale, live dual preview (“in card” cover strip / “on ad page” 3:1 contain), estimated file size against the backend 5 MB gate, WebP re-encode when supported, “upload without edits” and “edit again” paths. Upload always re-encodes through canvas so the 5 MB / JPEG-PNG-WebP contract in `backend/apps/core/media.py` can't be violated by an edit.
- **`/login`:** real `<form>` (Enter submits, no duplicate requests), `type=tel` + `autocomplete=tel` / `one-time-code`, labeled fields, advertiser-only hint, back-to-map link, localized busy labels. Full OTP login verified against the dev fake-SMS backend.
- **Cabinet:** unauthenticated `/app` now actually redirects (fixed pre-existing broken `navigate()`-in-render); overview shows **honest metrics** (“Одобрено/Approved” — no longer labeled active), setup checklist for new advertisers after data loads, emoji-free nav; campaigns list with status filter chips, localized status badges (no raw enums), locale-aware dates, review version hidden; editor restructured into numbered sections with programmatically associated labels, field-level server errors, banner required before submit/quote, unsaved-changes hint, fake-payment controls gated to `provider === "fake"`; billing split into orders + renewals with Asia/Tashkent dates, localized order states, per-row pending/error feedback; business profile and branches forms fully labeled with locale-aware category names.
- **i18n:** ~50 new keys in **both** RU and UZ; `plural()` helper (RU one/few/many, UZ two-form); localized `document.title` + `lang` per locale; currency via `Intl.NumberFormat` per locale; dates via `Intl.DateTimeFormat` with `timeZone: "Asia/Tashkent"`.
- **Fixed along the way (pre-existing):** `/app` auth redirect; “approved” mislabeled as active; mobile toolbar overflow; missing MapLibre CSS.

Still deferred (unchanged from §5/§9): keyboard-accessible results list, coincident-location overlap selector, ranked search wiring, ad→branch cold-link contract, placement-based live/expired metrics, deep editor workflow changes (draft resume, rejected-campaign correction route), production payment provider integration (external gate), UZ full fluent-review pass, and dark mode/rebrand (out of scope by design).

**Main-page order:** `/` → selected location sheet → `/locations/:id` → `/ads/:id` → `/login` → `/app` and `/app/campaigns`. Editor and checkout get shared visual improvements immediately, then a separate, careful workflow pass.

### 1b. Second design pass (senior-designer audit, verified in-app)

Full-page audit at 1512/390/320px (RU + spot UZ) via live DOM/geometry/contrast measurement plus the Playwright suite. All changes verified: typecheck, lint, build, and 10/10 e2e green.

- **Touch targets raised toward the 44px product target:** MapLibre zoom/compass 29→40px; language switcher 36→40px; sheet close 40→44px; panel-collapse 32→36px; cabinet nav links and small buttons +4px; public back links now a 44px inline-flex row (they were 17px text).
- **Contrast:** muted text on tinted danger surfaces (`callout.danger`, `rejection-card`) darkened to #7a271a (8.6:1 on `--danger-soft`; was 4.36:1).
- **Mobile money tables:** billing orders and checkout charges tables now render as labeled stacked cards below 640px (`data-label` + CSS) — the **Итого** column no longer hides behind horizontal scroll on phones.
- **Filter chips wrap on phones** instead of a hidden horizontal scroll: the “Отклонено” filter must stay discoverable.
- **Editor truthfulness:** fixed pre-existing regression where “Сохранить черновик” required a banner (dead-end disabled button; backend accepts banner-less drafts — design system §7.7 says only submit/quote need it). Caught by the e2e suite, now green.
- **Editor hierarchy:** removed the inner 1–5 section numbering that fought the 1–3 stepper (stage 2 contained sections “2,3,4”; preview was “5”); stepper chips now use `aria-current="step"` only (dropped conflicting `aria-pressed`); removed the last functional emoji (ℹ️).
- **Accessible names:** `.section-num` badges on the business form are `aria-hidden` — headings no longer read “1Профиль”.
- **Copy/format:** phones render as `+998 90 123 45 67` (new `formatPhone`) in cabinet header, account page, and the login OTP step; results panel count now says “29 точек · 19 объявлений” / “Найдено: N” instead of bare “29 · 19”; zero-ad result chips are neutral gray (orange now means active ads only, matching map pin semantics); next-renewal meta reads “2 точки · 8 дн × 24 ч”.
- **320px layout:** editor header and header rows (`row-between`, `row`) wrap; login card width `min(410px, 94vw)` → `100%` (the vw form overflowed the 20px page gutters).

Audit tooling notes for future passes: measure contrast with **alpha compositing** over the effective background (translucent chips over white otherwise report false 2:1 failures), don't flag `alt=""` images (decorative is correct), and remember `getComputedStyle().backgroundColor` cannot see gradient avatars (measured “white on white” was a blue gradient).

## 2. Evidence and limits of this audit

### Reviewed

- The complete [engineering specification](../../Local_Advertising_Engineering_Spec_v1_EN.md), especially §§1, 4, 6–10, 13–14, 17, and 19.
- [ADR-0001](../architecture/adr-0001-monorepo-and-stack.md), [open questions](../architecture/open-questions.md), and the project README.
- All main frontend page implementations, route configuration, shared UI, CSS, dictionaries/internationalization infrastructure, formatting helpers, map adapter, and query hooks.
- Django discovery serializers and views to check which public data the proposed UI can actually use. This was not a full backend/security audit.
- The running local app at `http://localhost:5173`: homepage at 1512×777 and emulated 390×844, mobile login, a populated location page, and its public ad page. Inspected accessibility snapshots, DOM geometry, and a read-only public API response.

### Verification limits

- Browser screenshot capture timed out twice, including on the login page. Findings below are grounded in source inspection and live DOM/accessibility observations, **not a completed screenshot-based visual review**.
- Advertiser screens were source-reviewed; no authenticated browser walkthrough, SMS request, campaign creation, payment, or data mutation was performed.
- RU was observed in the browser. UZ needs a complete rendered review during implementation.
- No accessibility conformance certification or performance benchmark was performed.
- No app source, financial behavior, API contract, migration, dependency, or lockfile was changed for this deliverable.

Evidence labels below: **Live** = observed in the running local app; **Code** = verified in source; **Proposal** = recommended design choice.

## 3. Current findings: fix friction before adding polish

Source paths in this section are relative to the repository root. Line references describe the audited version and may move.

| Priority | Finding and evidence | Why it matters | Smallest useful change |
|---|---|---|---|
| P0 | **MapLibre base CSS is absent.** No `maplibre-gl.css` import in indexed source or HTML. Live map controls have `position: static`; attribution was below the 844px viewport. `src/main.tsx`, map adapter. | Navigation and attribution do not receive the library's intended layout. | Import the installed package's `maplibre-gl/dist/maplibre-gl.css` before app overrides; then position controls around overlays. No version upgrade. |
| P0 | **Mobile homepage toolbar overflows.** At 390px, `.controls` is ~489px wide and reaches x≈499; language controls start around x≈408. `index.css:268–318,454–471`. **Live + Code.** | Core actions are clipped on the first screen. | Split mobile header into utility, full-width search, and filter rows. Use `min-width: 0`; do not conceal the problem with global overflow hiding. |
| P0 | **Small metadata and badges have insufficient text contrast.** `--muted-2` on white ≈2.58:1; orange chip text on its background ≈3.15:1; green chip text ≈3.58:1. **Code + calculated.** | These are small text labels, not decorative shapes. | Darker semantic text colors; keep pale backgrounds. See §6. |
| P0 | **Homepage loading/error/empty feedback is incomplete.** `MapHomePage` reads loading but not error state; counts can show zero during loading; `LocationSheet` uses `!loc` as an indefinite skeleton. **Code.** | Failed requests look like “nothing exists” or never finish. | Explicit state branches with retry and clear-filters actions. |
| P0 | **Selected-location card adds unnecessary navigation.** It has ad previews and “Details,” but no direct call/directions actions despite location-detail data being available. `MapHomePage:19–71`. **Code.** | A visitor must open another page for the main useful action. | Reuse one contact-action component in the sheet and location page. |
| P0 | **Dashboard conflates moderation with publication.** `OverviewPage:25–27` labels `count("approved")` as active. **Code.** | An approved campaign can be unpaid, scheduled, expired, or blocked. | Rename the existing metric “Approved.” Real active/expired counts require placement-aware backend data. |
| P0 | **Localization is uneven.** Chips print raw enums; sheet shows `ON`; location page shows `Web`; business categories always use `name_ru`; some accessible labels are English. **Code.** | RU/UZ support feels unfinished and financial statuses become ambiguous. | Translate presentation labels without changing API enums; update both dictionaries together. |
| P1 | **Map pin meaning is incomplete.** Individual pins are 8px-radius circles without ad-count text; clusters show location counts. No cluster-click handler or coincident-location selector exists in the adapter. **Code.** | Users cannot distinguish counts or reliably reach overlapping businesses. | Add explicit pin counts, cluster zoom, and an overlap chooser; keep these separate from CSS-only work. |
| P1 | **Public advertisement is a dead end.** It renders a banner, headline, business name, and body, with only a homepage link. **Live + Code.** | Interest has no clear route to the relevant branch or contact. | Preserve originating location context; add a branch/contact path only when backed by eligible location data. Deep-link support is a contract dependency (§9). |
| P1 | **Location hierarchy favors imagery and coordinates.** A 220px hero and coordinate badge precede useful actions; hours and messaging fields are available but not rendered. **Live + Code.** | Visitors want where, what, and how to reach the business—not raw longitude/latitude. | Identity and actions first; remove public coordinate emphasis; show available hours and contact channels. |
| P1 | **Loading and network errors can masquerade as business state.** Overview/editor/branches infer onboarding from absent business data; checkout renders loading indefinitely when order data is absent. **Code.** | Existing advertisers may see false setup prompts; failures have no recovery. | Distinguish pending/error/success-empty before rendering business instructions. |
| P1 | **Form labels are often visual only.** Business/editor/branch forms use adjacent labels without matching `htmlFor`/`id`. **Code.** | Keyboard and screen-reader use is harder. | Associate labels and help/error text; use field-level validation rather than raw JSON. |
| P1 | **Campaign editor exposes three competing workflow actions.** Save, submit, and quote buttons share a row; quote errors may be JSON; a missing banner can become a placeholder key. **Code.** | The next action and what was actually saved/submitted are unclear. | Group fields, highlight the next valid action, track saved versus unsaved content, and require a real banner before submission. Preserve server transitions. |
| P1 | **Dates/currency do not consistently follow locale and Tashkent time.** Billing slices ISO strings, campaign list uses browser date defaults, currency forces `ru-RU`, and datetime input helpers use browser-local time. **Code.** | Displayed payment/schedule information can be misleading. | Locale-aware display; explicit Asia/Tashkent policy. Treat datetime input conversion as a separate high-risk change. |
| P1 | **Checkout is still development-oriented.** It offers simulated payment after obtaining a redirect URL, without using the returned provider to select UI. **Code.** | A polished page must not imply production payment readiness. | Clearly gate fake controls to local/test + fake provider; verified provider redirect/status behavior remains an external gate. |
| P2 | **Visual inconsistency accumulates.** Emoji branding/navigation, many inline spacing values, multiple gradients/shadows, and different card/banner treatments. **Code.** | The app lacks a coherent hierarchy despite having tokens. | Evolve existing CSS and reuse a small component set; no framework migration. |

### Important data caveats

- A live pin response contained `id`, `name`, coordinates, and `active_ads_count`, but omitted `business_name` and `category`, although frontend types declare them. The serializer declares those fields without mapping their business relations. Do not build rich result cards assuming those values exist; use `name` as the first-pass label and reconcile the contract separately.
- The map currently includes zero-ad locations, and the footer describes both active and inactive locations. Keep that behavior during visual work; resolving active-only discovery versus zero-ad location visibility is a product/backend decision.
- Summing per-location ad counts is a count of ad occurrences/placements across locations, not necessarily unique campaigns. Avoid labeling that sum as a unique-ad total. “Locations in this area” is a clearer first-pass result summary.
- `useLocationPins` requests at most 200 records. Result copy must not imply an exhaustive citywide total.

## 4. Design direction: calm, useful, local

**Design concept: “A clear city guide with a trustworthy advertiser workspace.”**

A contemporary 2026-quality experience here means adaptive layouts, strong content hierarchy, accessible interactions, fast feedback, and transparent transactions. It does not require trendy decoration or an AI feature.

### Visual rules

- **Map is the product:** keep the majority of the desktop viewport available to it. Do not put a large marketing hero above it.
- **Light surfaces, dark readable text, blue actions, restrained orange discovery accents.** Preserve recognizable existing colors while improving contrast.
- **One primary action per task region.** On the public homepage, search is visually dominant; advertiser login is a quieter utility. In checkout, the payment action is dominant.
- **Real business content provides visual character.** Use the uploaded banner, business name, branch name, and address—not decorative illustrations, invented reviews, or “verified” badges without evidence.
- **Use elevation to show layering, not importance everywhere.** Shadows belong on map overlays and sheets; ordinary workspace cards mostly use borders.
- **Progressive disclosure:** show essential facts first, optional contact channels/details second. Do not hide prices, renewal consent, moderation state, or errors.
- **Stable interaction beats motion.** No bouncing pins, pulsing promotions, auto-advancing carousels, or celebratory payment animation before backend confirmation.

### Keep / change / defer

| Keep | Change now | Defer |
|---|---|---|
| React, Vite, TypeScript, React Query, React Router | Shared tokens and component states | UI-library or Tailwind migration |
| MapLibre behind `MapAdapter` | Toolbar, attribution, accessible result access | Provider switch or custom vector basemap |
| Blue/orange identity and light theme | Contrast, type hierarchy, SVG icon consistency | Rebrand, dark mode, custom font purchase |
| RU/UZ dictionaries | Complete labels, pluralization, localized formatting | Additional UI languages |
| Current routes and server-led business workflows | Page hierarchy and truthful state presentation | Native app, reviews, chat, visitor accounts |
| Django Admin | Existing admin integration untouched | Custom admin SPA |

## 5. 80/20 delivery plan

**Effort units are rough engineering estimates, not commitments:** XS = up to half a day; S = roughly one day; M = roughly two to three days. They include ordinary manual review but exclude provider approvals and backend contract work. Confirm against actual implementation constraints.

| Order | Work package | Impact / effort | Definition of done |
|---|---|---|---|
| 1 | Homepage structural repair: MapLibre CSS, mobile toolbar, control/attribution offsets | Very high / XS–S | Nothing essential is off-screen at 320–430px; map controls and attribution remain usable. |
| 2 | Token and primitive pass: text contrast, focus, field sizing, buttons, badges, reduced motion | High, shared across routes / S | Shared controls have consistent states; small-text contrast passes; translations replace raw statuses. |
| 3 | Homepage and location-sheet hierarchy, call/directions actions, empty/error states | Very high / S–M | A visitor can identify a branch and reach an available contact/directions action from its sheet. |
| 4 | Public location/ad pages: identity, banner treatment, context-preserving back path, recovery states | High / S | Public journey is coherent; unavailable ads expose no stale content; API-dependent additions remain explicitly gated. |
| 5 | Login + advertiser overview/campaign list: next action, readable rows, honest metrics | High / S–M | Approved is not labeled live; loading does not trigger onboarding; actions fit mobile. |
| 6 | Editor/checkout/billing workflow clarity and time handling | High, revenue-critical / separate estimate | Maintainer-reviewed state/price/consent behavior; no fake production success. |
| 7 | Map accessibility and interaction completion: result list, counts, cluster and overlap behavior | High / M, validate separately | Keyboard-accessible alternatives, unambiguous counts, independent coincident businesses. |

### First-pass stopping rule

Treat packages 1–4 as the small, high-return public-facing release. Packages 2 and 5 also contain cheap trust fixes that should not wait for a large redesign. Shared styles can improve all pages immediately without redesigning every workflow.

**If only one day is available:** repair map CSS and mobile controls; darken small text; translate badges; correct the dashboard's approved label. Do not spend that day drawing a new logo.

**If only one short sprint is available:** finish the public journey and shared primitives. Do not silently absorb map-provider integration, placement metrics, editing/resubmission routes, or production billing into the visual estimate.

## 6. Design system v1

These are proposed tokens for gradual adoption in `frontend/src/index.css`, not instructions to replace the entire stylesheet. Keep existing class names where practical. Add components only when they reduce actual duplication.

### 6.1 Color tokens

| Token | Proposed value | Use |
|---|---|---|
| `--bg` | `#F4F6FB` | Page background; retained |
| `--surface` | `#FFFFFF` | Cards, controls, sheets |
| `--surface-subtle` | `#F8FAFC` | Quiet sections and disabled surfaces |
| `--ink` | `#0B1220` | Main headings/text; retained |
| `--ink-2` | `#1D2939` | Secondary strong text; retained |
| `--muted` | `#475467` | Body metadata/helper text |
| `--muted-2` | `#667085` | Small secondary labels; replaces current faint gray |
| `--border` | `#E4E9F2` | Decorative card dividers; not sufficient alone to identify inputs |
| `--control-border` | `#667085` | Essential input/control outlines on light surfaces |
| `--primary` | `#1D4ED8` | Primary action/link; white text on blue ≈6.70:1 |
| `--primary-dark` | `#1E40AF` | Hover/pressed primary action |
| `--primary-soft` | `#EAF0FF` | Selected/ informational background |
| `--accent` | `#C2410C` | Orange text/active-ad emphasis |
| `--accent-soft` | `#FFF1E5` | Orange badge background; text pair ≈4.68:1 |
| `--success` | `#166534` | Successful state text |
| `--success-soft` | `#E7F8F0` | Success surface; pair ≈6.48:1 |
| `--danger` | `#B42318` | Error/destructive text |
| `--danger-soft` | `#FEECEB` | Error surface; pair ≈5.76:1 |
| `--warn` | `#92400E` | Warning text |
| `--warn-soft` | `#FEF4E6` | Warning surface; pair ≈6.52:1 |

Ratios were calculated using the WCAG relative-luminance formula for these exact opaque color pairs. They do not certify gradients, opacity, image overlays, hover states, or the whole app. Verify final rendered pairs. Keep bright orange, if desired, for decorative dots—not small text.

**Semantic rules:** blue = action/selection/information; orange = advertising emphasis; green = a specific successful state; red = failure/action required. A green “Approved” badge never means “Live.” Always include a localized text label, not color alone.

### 6.2 Typography

Use the existing system-font stack; do not add a font request in the first pass. Merely naming Inter does not mean it is loaded. Test Russian Cyrillic and Uzbek Latin/apostrophe rendering on actual target devices.

| Role | Desktop | Mobile | Weight / line height |
|---|---|---|---|
| Page title | 28px | 24px | 700 / 1.2 |
| Section heading | 20px | 20px | 650–700 / 1.3 |
| Card heading | 16px | 16px | 600 / 1.4 |
| Body / input | 16px | 16px | 400 / 1.5 |
| Label / button | 14px | 14–16px | 600 / 1.4 |
| Metadata | 14px | 14px | 400–500 / 1.4 |
| Compact badge | 12px | 12px | 600 / 1.4 |

- Use sentence case; remove automatic uppercase from long statuses and ordinary metadata.
- Keep prose around 60–70 characters per line; wrap long business names, addresses, and campaign titles.
- Use tabular numerals for totals, dates, and counts. Do not shrink important financial information to fit a row.
- Use 16px mobile form text to avoid common mobile input zoom issues.

### 6.3 Spacing, shape, and elevation

```css
/* Proposed additions; adopt while touching components, not as a global rewrite. */
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --radius-sm: 8px;
  --radius: 12px;
  --radius-lg: 18px;
  --control-height: 44px;
  --control-height-touch: 48px;
  --shadow-card: 0 1px 2px rgb(16 24 40 / 0.06);
  --shadow-overlay: 0 12px 28px -8px rgb(16 24 40 / 0.16);
  --motion-fast: 140ms;
  --motion-panel: 200ms;
}
```

- 16px mobile page gutters; 24px desktop gutters; 16px compact card padding and 24px spacious card padding.
- 8px label-to-control, 8px control-to-help, 24px between form groups, 32px between page sections.
- Use solid primary buttons. Remove widespread gradient/shadow/lift effects rather than adding more variants.
- Use `min-height`, not fixed text containers; leave space for translated labels and validation messages.
- Layer order: map → map controls → toolbar/results → location panel → modal dialog. Attribution must remain visible, including when a panel opens.

### 6.4 Responsive layout

These are project breakpoints, not a claim that one framework's values are mandatory:

| Width | Public map | Advertiser/detail pages |
|---|---|---|
| `<768px` | Stacked compact controls; bottom location sheet; list as an explicit alternative view | One column; full-width form actions when necessary; readable stacked billing rows |
| `768–1023px` | Two-row toolbar where needed; compact side panel only if map remains useful | Mostly one column; two-column groups only when text fits |
| `≥1024px` | Floating search dock; optional 340–360px results/selection panel | Up to 1120px workspace; 720px reading content; editor summary can sit beside form |

Use content-driven wrapping before breakpoint overrides. Test 320, 390, 768, 1024, and 1440px plus 200% text zoom. Reserve safe-area padding with `env(safe-area-inset-bottom)` and use `100dvh` where appropriate for full-screen map/sheet behavior.

### 6.5 Components: build the small reusable set

Start in the existing `shared/ui.tsx`; split into files only if it becomes unwieldy.

| Component / pattern | Required behavior |
|---|---|
| `Button` | Primary, secondary, quiet, destructive; pending/disabled/focus states; stable label/width; one action per click. Use anchors for navigation. |
| `Field` | Persistent associated label, optional hint, required state, inline error, `aria-describedby`; never placeholder-only. |
| `StatusBadge` | Domain-specific enum → localized label + tone; review/payment/publication remain separate. |
| `PageHeader` | Breadcrumb/back link, one h1, optional explanation, one primary action; wraps on mobile. |
| `AsyncState` | Loading, true empty, recoverable error, unavailable; localized action; never pretend a failure is an empty list. |
| `LocationCard` / `ContactActions` | Business/branch identity, address, active-ad count, available directions/contact links; shared by sheet and detail page. |
| `AdCard` | One banner, headline, business context; stable image dimensions; broken-image fallback; no nested interactive links. |
| `LocationPanel` | Accessible title, close control, constrained scroll region, focus behavior, no overlap with required map controls. |

Do not invent a component library for every HTML element. Reuse the existing native select and checkbox before building custom popovers or switches.

### 6.6 Interaction and accessibility rules

- **Project target:** 44×44px minimum actionable area, 48px for major touch actions. WCAG 2.2 AA's target-size minimum is 24×24 CSS pixels with exceptions; 44px is our stronger usability target, not a misstatement of that criterion.
- Provide a clearly visible `:focus-visible` outline, for example 3px primary blue with 2px offset on light surfaces. Validate focus contrast on the actual background.
- Never let fixed bars/sheets obscure the focused element. Use scroll padding/margins and test the virtual keyboard.
- A nonmodal desktop panel does not trap focus. An actual modal mobile sheet must manage focus, make background content inert, close with Escape, and restore focus to the opener. Provide a keyboard-accessible result item when canvas pins cannot serve as a focus target.
- Provide an expand/collapse button if a sheet has multiple sizes; dragging must never be the only way to operate it.
- Announce settled result counts and submission feedback politely; avoid announcing every keystroke or animation frame.
- Keep motion to opacity/transform feedback around 140–200ms. Honor `prefers-reduced-motion`, including skeleton shimmer and sheet entrance.
- Replace functional emoji with one consistent small SVG icon set. Prefer a tiny local set over a new dependency for this pass. Decorative icons use `aria-hidden`; icon-only controls need localized accessible names.
- Use `<img>` for meaningful ad imagery; preserve full artwork on the ad-detail page. Do not crop text baked into a banner. Thumbnails may crop only when the detail view provides the full image and important offer text is available as text.

## 7. Main-page update specifications

### 7.1 Homepage `/` — highest priority

**User job:** find a relevant local business/ad and understand how to reach it.

**Desktop target:**

```text
┌──────────────────────────────────────────────────────────────────┐
│ Local Ads   [ Search businesses or ads…          ]  RU UZ  Business│
│             [ All categories ▾ ] [ Clear filters ]                │
│                                                                  │
│ [Locations in this area]                  MAP                     │
│ [Optional results panel]                                 [+]      │
│ [or selected location ]                                  [−]      │
│                                                                  │
│ Map/list control                         Visible attribution      │
└──────────────────────────────────────────────────────────────────┘
```

**Mobile target:**

```text
┌───────────────────────────────┐
│ Local Ads       RU UZ Business │
│ [ Search businesses or ads…  ] │
│ [ All categories ▾ ] [Clear]   │
│                               │
│             MAP          [+]  │
│                          [−]  │
│                               │
│ [ Selected branch        ×  ] │
│ [ Business · address        ] │
│ [ Directions ] [ Call       ] │
│ [ Active ads / full details ] │
│       Visible attribution     │
└───────────────────────────────┘
```

Wireframe labels are English design descriptions; shipped text must come from RU/UZ dictionaries.

**First-pass changes**

1. Import the library CSS; inspect the actual controls before adding local offsets.
2. Separate brand/account/language utilities from search/filter layout. Search occupies the full available width on mobile; category selector remains native.
3. Make the advertiser action explicit (“For businesses” as a concept), rather than implying visitors must sign in to browse. Keep it secondary to discovery.
4. Replace the full-width statistics/legend footer with a compact result summary and a small legend/help affordance. Do not cover attribution.
5. Keep the existing 400ms text debounce initially. Show a subtle updating state without clearing useful results during every request. Coalesce viewport requests; do not add a second “Search this area” mode unless deliberately changing the interaction model.
6. Show true no-match feedback with clear-filters action; distinguish API error from tile/map failure. Retain usable results/contact access when map rendering fails where data is available.
7. Preserve query/category/map position when opening a location and returning. URL search parameters are preferable for shareable query/category/selection state; validate selected-location context rather than trusting arbitrary IDs.

**Next map-focused pass**

- Add a keyboard-accessible result list using the same filtered records; do not fetch every location detail solely to decorate the list.
- Individual pin count = active ads at that location. Cluster count = locations, explicitly identified as such. Do not label both simply “ads.”
- Use an adequate hit area and selected-state outline; count text must remain readable. Implement cluster click-to-zoom and a chooser for coincident businesses inside the adapter boundary.
- Keep server ranking authoritative. The currently used bbox endpoint does not implement the separate search endpoint's relevance/distance ranking; wiring ranked search is not a CSS change.

**Acceptance:** no off-screen controls at 320/390px; search and category remain usable in both languages; map controls and attribution remain visible; loading/error/empty are distinct; a selected branch can lead directly to an available contact/directions action.

### 7.2 Selected-location sheet and `/locations/:id`

**Information order:** business name → branch name/category → address → directions/call → active ads → optional hours and other contacts.

- Remove the `ON` badge. The active-ad count already communicates the useful fact.
- Do not let a first campaign's banner masquerade as a permanent branch photo. If reused in a preview, identify it as ad content.
- Remove the prominent coordinate badge from public detail; coordinates belong in branch administration, not the main customer hierarchy.
- Desktop panel: approximately 360px wide; height constrained to the available map viewport; internal scrolling. Mobile: a bounded bottom sheet with safe-area space and a 44px close target, not an unconstrained card above a fixed footer.
- Render available `phone`, `telegram`, `whatsapp`, `business_site`, and `hours`. Omit absent actions instead of showing disabled placeholders. Normalize and validate external destinations; verify directions deep-link syntax against provider documentation/device behavior rather than assuming the existing URL is correct.
- Show provided opening hours; do not invent “Open now” until hours/timezone semantics are reliable.
- Full location page: useful identity and actions near the top; ad grid below; one shared ad-card treatment. A mobile sticky contact bar is optional only after checking keyboard, content overlap, and safe areas.
- If only two ad previews are shown in the sheet, label the link “View all N ads” when appropriate.

**Acceptance:** long addresses wrap; 0/1/multiple ads render correctly; missing contacts are handled honestly; panel content can scroll without losing close/action access; network failure does not leave a permanent skeleton.

### 7.3 Public advertisement `/ads/:id`

**Target hierarchy:** back to originating location when known → full banner → headline/business → ad text → eligible branch/contact action.

- Replace the background-only banner with a responsive image preserving its content and dimensions. No large empty decorative hero when the image fails.
- Keep body text readable and preserve intentional line breaks.
- On navigation from a location, carry its ID as context, then validate that location still exposes this active ad before showing its contact actions. Never rely only on client navigation state for a shared direct link.
- The current ad response has no branch IDs or contacts. **Do not invent a “Call” or “Directions” destination.** A reliable cold-link branch selector requires a small, maintainer-approved public API extension exposing currently eligible locations. Until then, retain a clear map-discovery fallback.
- `starts_at`/`ends_at` currently come from one selected placement. Do not claim those dates apply to every branch of a multi-location campaign.
- Differentiate 404/410 unavailable content from temporary server/network failure. Unavailable content must not render cached expired ad details; offer return-to-map instead.

**Acceptance:** ad copy is not clipped by image cropping; source-location navigation works where context exists; direct links do not fabricate branch data; expired content is not exposed.

### 7.4 Login `/login`

Keep a single compact card; no split-screen illustration or multi-step onboarding redesign.

- Explain this is advertiser sign-in and browsing requires no account. Add a clear back-to-map link.
- Use a real form so Enter and button submission share the same busy/validation guard.
- Phone: visible +998 example, `type="tel"`, `autocomplete="tel"`, persistent label.
- OTP: keep one input supporting paste; `inputmode="numeric"`, `autocomplete="one-time-code"`; align code length with the backend rather than redesigning it by guesswork.
- Show the destination number and a change-number action; retain resend throttling. Do not present the local countdown as authority over server rate limits.
- Inline error feedback with an accessible announcement; use a text pending label rather than only an ellipsis.
- Keep language switching inside a predictable layout and avoid clipping on narrow screens/with the keyboard open.

**Acceptance:** keyboard submission does not issue duplicate requests while busy; number/code labels are associated; paste works; browsing stays anonymous. SMS delivery and provider behavior remain outside this design claim.

### 7.5 Advertiser overview `/app`

**Question to answer:** “What needs my attention, and what should I do next?”

- Page header: business context, “Overview,” one primary action.
- New advertiser: compact checklist linking to existing business → branch → campaign routes. Compute completion only after successful data loads; do not show missing setup while requests are pending.
- Existing advertiser: highest-priority actionable message first, then a small row of status summaries and recent campaigns.
- Immediately rename the current “Active” count to “Approved.” Keep pending/rejected/draft counts grounded in available campaign data. Active/scheduled/expired publication counts need placement-aware data; do not derive them from paid orders or approval.
- Replace emoji statistic icons with subdued consistent icons, or remove them. Do not add charts, revenue forecasts, impressions, or ROI numbers not supported by data.
- Keep the current top navigation for this pass. Wrap/reflow the header; a new sidebar is not necessary to improve the page.

**Acceptance:** no misleading active metric; new and returning users see a valid next action; loading does not flash a setup warning.

### 7.6 Campaign list `/app/campaigns`

- Use a header with one “Create campaign” action and simple review-status filters supported by existing data.
- Row/card: banner thumbnail → headline → business/date metadata → localized review status. Hide content version from the main visual hierarchy; it is secondary technical detail.
- Desktop rows can be compact; mobile cards wrap statuses and actions below the headline.
- Separate review status from payment/publication status if those data are later joined. Never collapse them into a single ambiguous badge.
- **Do not add nonfunctional Edit/Copy/Renew buttons.** The current router has only the new-campaign editor route. Resuming drafts and correcting rejected campaigns require explicit routing/data-loading work, not decorative links.
- Provide a useful empty state with the existing create action and proper error recovery.

**Acceptance:** long titles fit; filters clearly indicate scope; every displayed action works; unavailable workflow actions are not falsely advertised.

### 7.7 Campaign editor `/app/campaigns/new`

This is the next revenue-focused pass, not a prerequisite for fixing the homepage.

- Keep one page, grouped into numbered sections: **Ad content → Branches → Schedule → Renewal → Review/payment**. No wizard framework.
- Desktop may use a sticky preview/summary beside the form; mobile places summary before the final action. Preview is local data, not a public publication claim.
- Use the actual uploaded banner; provide replace/remove, progress, validation, and a stable preview. Display upload limits only after checking backend configuration. Never substitute a placeholder banner as proof of valid submission.
- Bind labels to controls; render server field errors beside the relevant input, not as JSON.
- Maintain explicit saved/unsaved/submitted state. If content changes after save, require saving the current version before submission; do not submit an older saved version while previewing newer text.
- In the first pass retain the existing save → submit → quote operations, but visually highlight only the next valid step. Combining them into one “Continue” action requires careful partial-failure and retry handling and separate review.
- Branch selector: checkbox rows with address and selected count; select-all is useful for 20 branches if implemented against the actual eligible set.
- Schedule: clearly label Tashkent time; disclose whole-24-hour billing and server-priced totals. Do not calculate an authoritative quote client-side.
- Renewal stays **OFF by default**, with explicit consent and the approved price policy. Missing provider capabilities must not be papered over by a switch.

### 7.8 Checkout `/app/checkout/:id`

**Goal:** make the amount, purchased scope, and next state understandable before payment.

- Header with campaign and order reference; separate localized order status.
- Summary: selected branches, requested schedule with timezone, charged units, rate snapshot, line totals, final UZS total, quote expiry, and renewal choice.
- One clear payment action when eligible; no “Publish now” label. Explain that confirmed payment and moderation are separate gates.
- Preserve server quote immutability and idempotency. Disable duplicate UI actions while pending, but do not treat client disabling as the financial safeguard.
- Pending/processing: “Checking payment status” rather than success; do not encourage another charge when the outcome is ambiguous.
- Paid: show payment confirmation and the current moderation/publication explanation from authoritative data; do not claim immediate visibility.
- Failed/expired: explain recovery only through supported server operations. Network failure and missing order need distinct recovery states, not indefinite loading.
- Fake payment controls must require development/test configuration and `provider === "fake"`. A real redirect return is not evidence of successful payment. Verified provider integration remains a launch gate, not a design task.

**Acceptance:** the displayed total matches the server; mobile line items remain readable; auto-renew consent is visible; no client-only success or publication claim.

### 7.9 Billing `/app/billing`

- Separate **Orders/payments** from **Automatic renewals** with clear section headings.
- Desktop table; mobile labeled rows/cards. Keep campaign, date, amount, status, and action together.
- Display dates in Asia/Tashkent, not by slicing UTC strings.
- Cancellation copy must state that future renewal stops while already-paid time remains. Re-enable needs appropriate consent/eligibility, not an optimistic success badge.
- Add clear pending/error feedback for renewal mutations. Use warnings for alerts, not the same blue badge for every renewal state.
- A refund request is not a completed refund. Show its returned state honestly; durable refund history requires backend data not currently exposed by `ApiOrder`.
- Do not promise downloadable receipts without a real endpoint.

### 7.10 Business and branches `/app/business`, `/app/locations`

Apply shared field/form styles first; keep these behind the main public pages in visual priority.

- Business: separate identity, category, description, and contact groups; use the selected locale for category names; give each contact input a persistent label.
- Branches: show a concise list with name/address/status, then a clearly separated add form. Keep coordinate picking and owner-entered address distinct.
- Provide a keyboard-operable alternative to clicking the map, such as validated coordinate fields with a confirm-position action; do not invent address geocoding while licensing/provider support is unresolved.
- An address alone is not proof of ownership. Never add a “Verified business” badge from phone verification alone.
- Missing business, loading, and API failure need different states.

### 7.11 Not found and administration

- Not-found page: shared header/typography, short explanation, return-to-map action.
- `/admin/`: keep Django Admin. No custom admin redesign in this workstream.

## 8. Localization and content guidance

Documentation remains English; the shipped UI remains **Russian and Uzbek**.

- Put every new visible/accessibility string in both `shared/i18n/ru.ts` and `uz.ts`; keep dictionary keys/types aligned.
- Translate campaign/order status labels and accessible names. API enum values remain unchanged.
- Use parameterized messages and `Intl.PluralRules` where needed; avoid concatenations such as `1` + a fixed plural word.
- Use the selected locale for currency, dates, and category names. Prefer `Intl.NumberFormat` and `Intl.DateTimeFormat` with explicit `timeZone: "Asia/Tashkent"` for display.
- Datetime input parsing needs an explicit timezone conversion policy. Merely changing the label to “Tashkent” while parsing in browser-local time is incorrect.
- Preserve the existing HTML language update; localize route titles as a small follow-up so Uzbek pages do not retain a Russian-only document title.
- Leave room for longer translations; never solve overflow by truncating the primary action or reducing it to unreadable type.
- Use “advertisement/campaign,” not “discount” everywhere: discounts are optional under the product specification.
- Avoid unsupported claims: “guaranteed customers,” “instant publication,” “verified,” “secure payment by CLICK,” or a moderation SLA not established by the product/provider.
- Have fluent RU/UZ reviewers approve financial, renewal, refund, and legal wording before launch.

## 9. Frontend-only work versus dependencies

| Improvement | Can use current data? | Boundary |
|---|---|---|
| Mobile controls, tokens, focus, readable cards, localized badges | Yes | Frontend-only; no schema change |
| Contact actions and hours on location sheet/detail | Yes, when fields are populated | Validate external links; no invented opening status |
| Basic accessible results list | Yes: use returned location name and count | Live payload lacks some declared fields; no per-row detail-fetch storm |
| Rich result identity/category | Not reliably today | Fix serializer/type contract mapping; regenerate schema if changed |
| Individual count labels, cluster expansion, overlap picker | Coordinates/counts available | Map-adapter implementation; review callers before interface changes |
| Contextual ad → originating branch | Yes, with revalidated location context | Cold direct links still need a supported branch lookup |
| Ad deep-link eligible branch selector | No branch relation in current ad payload | Maintainer-owned discovery/API contract extension; only public-eligible locations |
| Real active/scheduled/expired overview counts | Not in campaign review status | Placement-aware endpoint/summary; do not infer financial/public states |
| Rejected-campaign correction / resume draft | Backend capabilities and UI route must be checked together | New editor-loading/resubmission workflow; do not charge again casually |
| Ranked relevance/distance result list | Separate search implementation exists | Explicit search contract integration; preserve ranking semantics |
| Provider-branded payment and recurring promises | No production verification in current baseline | Spec §19 external gate; maintainer review |
| Tashkent schedule conversion, recurrence/refund behavior | Requires careful existing-contract review | High-risk date/financial work, not a styling refactor |

### Open decisions to resolve, not silently decide in CSS

1. Final brand name/logo: this guide retains “Local Ads” provisionally; no rebrand is required.
2. Whether zero-ad locations remain in discovery; existing behavior differs from the active-only emphasis in parts of the spec.
3. The 25-hour request rule: specification/open-questions propose requested-duration display, while README/placement logic also discusses preserving charged duration after late moderation. Resolve one approved policy before writing definitive schedule promises.
4. Renewal price policy, tariff changes, partial refunds, and production payment provider readiness remain the existing product/provider gates.
5. Ad-detail branch relation and truthful publication metrics need agreed API contracts.
6. Search-result completeness/ranking and missing pin fields must be settled before claiming rich, exhaustive search.

Do not modify the confirmed product decisions to simplify the design: anonymous discovery, one banner per campaign, no paid ranking boost, explicit optional renewal, and separate payment/moderation/publication remain intact.

## 10. Implementation map and guardrails

| Files | Intended work |
|---|---|
| `frontend/src/main.tsx` | Import the installed MapLibre stylesheet before app overrides |
| `frontend/src/index.css` | Tokens, responsive toolbar/panels, controls, typography, focus, reduced motion, layout helpers |
| `frontend/src/shared/ui.tsx` | Localized badges and a small set of shared presentation patterns |
| `frontend/src/shared/i18n/{ru,uz}.ts`, `index.tsx` | Complete messages, accessibility labels, pluralization support |
| `frontend/src/pages/MapHomePage.tsx` | Header/search hierarchy, sheet actions, asynchronous states, map context |
| `frontend/src/map-adapters/maplibre/adapter.ts` | Count semantics, control placement, clustering/overlap interactions in a separate pass |
| `frontend/src/pages/{LocationDetailPage,PublicAdPage,LoginPage}.tsx` | Public hierarchy, valid navigation/contact paths, accessible sign-in presentation |
| `frontend/src/pages/app/{layout,OverviewPage,CampaignsPage}.tsx` | Responsive workspace shell, truthful summaries, status rows, next actions |
| `frontend/src/pages/app/{CampaignEditorPage,CheckoutPage,BillingPage}.tsx` | Later, maintainer-reviewed workflow clarity and asynchronous recovery |
| `frontend/src/shared/format.ts` | Locale/time presentation; date conversion separately reviewed |
| `backend/apps/discovery/{serializers,views}.py` | Only separately approved contract corrections/extensions—not a hidden dependency of the CSS pass |

**Execution rules**

- Retain current routes, auth/CSRF protections, throttling, server quotes, idempotency, and API enums.
- Work incrementally: foundations + homepage first; then reuse on detail pages; then advertiser views. Avoid a large CSS rewrite that risks every route at once.
- Do not hand-edit generated clients/schema files; regenerate from the source of truth if an API change is approved.
- No package upgrades or new design-system dependency are necessary for the first release.
- Keep map vendor differences behind `MapAdapter`. Do not copy current online MapLibre v6 migration instructions into this v5-based app just to add its stylesheet.
- Paid-entitlement, auth, and date-conversion changes need focused verification and maintainer review; presentation improvements must not alter financial invariants.
- Rollback for the frontend-only release is the previous frontend artifact. It needs no migration or data backfill. API/financial work must have its own rollback assessment.

## 11. Verification and success criteria

### Public first-pass checklist

- [ ] At 320/390/768/1024/1440px, essential controls remain visible and readable in RU and UZ.
- [ ] Map fills the intended viewport; its zoom controls and required attribution are visible with and without a selected location.
- [ ] Search, category filtering, clear filters, selected location, and back navigation preserve understandable context.
- [ ] Loading, no matches, server/network error, and unavailable content are separate states with appropriate recovery.
- [ ] Business identity and available contact/directions actions are reachable without visitor login.
- [ ] Banner rendering preserves useful content; failed images do not destroy layout.
- [ ] Small text meets 4.5:1 contrast; large text meets 3:1; essential non-text controls/focus are checked against their actual backgrounds.
- [ ] Keyboard users can reach public content and dismiss panels without traps; focus is restored and not hidden by sticky elements.
- [ ] 200% text zoom, reduced motion, long translated labels, and mobile keyboard behavior have been manually checked.

### Advertiser follow-up checklist

- [ ] Approved, paid, and publicly active are not interchangeable labels.
- [ ] No false onboarding/zero state while data is loading or unavailable.
- [ ] Form labels and errors are programmatically associated; pending actions cannot be accidentally repeated via Enter.
- [ ] Quote total, branch scope, term, timezone, expiry, and renewal choice are clear and server-backed.
- [ ] Payment return/timeout does not imply success; fake controls cannot appear in production provider flows.
- [ ] Renewal cancellation explains preserved paid time; refund request is not described as refund completion.
- [ ] Existing relevant lint/typecheck/tests pass; fix regressions caused by implementation.

### Commands and manual proof

For future implementation, the current frontend exposes:

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

There is currently no frontend test script in `package.json`; do not claim `npm test` was run. Follow repo testing policy for behavior changes and use the existing backend checks when approved backend work is involved. A documentation-only deliverable does not establish that the app passes these gates.

Manually walk the public journey in both languages and an existing non-production advertiser account. Exercise failure/empty states and fake payments only in the appropriate local/test environment. Screenshots and real-device review remain necessary before visual sign-off because this audit's screenshot tooling failed.

### Measurement: small and honest

- Record a before/after baseline for search → location open → contact/directions click and advertiser start → quote → confirmed payment, if approved analytics instrumentation exists or is added as a separate small task.
- Prefer minimal aggregate events; do not record phone numbers, OTPs, sensitive free-text queries, raw card data, or unnecessary precise user location.
- Primary business outcome remains real paid advertising revenue, not page views or a design score.
- Measure mobile and desktop separately. Do not promise an “80% uplift.”
- Use standard Core Web Vitals targets as goals: p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1. These are not measured current results. Also measure usable map/results time separately: canvas/map readiness is not fully represented by LCP.
- Avoid new font/animation dependencies, reserve image dimensions, lazy-load below-fold media, and avoid one detail request per result card. Set map performance budgets after measuring realistic Tashkent data and device/network conditions.

## 12. Sources and rationale

### Project sources — authoritative for product behavior

- [Engineering specification](../../Local_Advertising_Engineering_Spec_v1_EN.md): scope, map-first homepage, routes, localization, billing/moderation separation, provider gates.
- [ADR-0001](../architecture/adr-0001-monorepo-and-stack.md): locked stack, map abstraction, financial and API boundaries.
- [Open questions](../architecture/open-questions.md): provisional schedule/renewal/refund decisions.
- [Frontend routes](../../frontend/src/app/router.tsx), [current styles](../../frontend/src/index.css), [public homepage](../../frontend/src/pages/MapHomePage.tsx), [UI badges](../../frontend/src/shared/ui.tsx), [public serializers](../../backend/apps/discovery/serializers.py), and [public views](../../backend/apps/discovery/views.py): implementation evidence.

### External references — standards and guidance, not trend forecasts

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): text/non-text contrast, reflow, keyboard operation, accessible authentication, and focus requirements.
- [Understanding Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): the 24px AA criterion and its exceptions; this guide chooses a stronger 44–48px product target.
- [What's New in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/): focus not obscured and alternatives to dragging.
- [Material adaptive breakpoints](https://m3.material.io/foundations/layout/breakpoints): change composition with available space, rather than merely shrinking a desktop row. The guide's actual breakpoint values are project recommendations.
- [MapLibre GL JS documentation](https://maplibre.org/maplibre-gl-js/docs/): library CSS is required to style its DOM controls. Use the installed version's bundled stylesheet; current online examples are not a package-upgrade instruction.
- [Web Vitals](https://web.dev/articles/vitals): performance metric definitions and p75 targets.

---

**Bottom line:** fix the first screen, improve the shared foundations, and complete the public discovery-to-contact journey. Then improve advertiser next actions and transaction clarity. That is the highest-confidence route to a more polished, useful product without turning a focused frontend update into a rebuild.
