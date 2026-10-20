# Local Ads design system (Joymee-derived)

**Reference:** https://joymee.uz/
**How the reference values were obtained:** computed styles and `:root` custom
properties read from the live site in Chromium (desktop 1440×900, mobile
390×844), 2026-10-14. Joymee is built on Mantine; its theme variables are
quoted below verbatim.

We copy Joymee's design language **and its colors**: brand yellow `#FEE02A`
with black labels, black ink, borderless gray fills, rounded-square corners (no pills),
flat surfaces. We do **not** copy its typeface (Gotham is commercial;
Montserrat stands in), logo, name or imagery. Two deliberate deviations:
muted text stays darker than Joymee's `#9E9E9E` to pass WCAG AA, and the
content is our own (local business advertisements).

Implementation: `src/index.css` (`:root` tokens), `src/shared/icons.tsx`,
`src/map-adapters/maplibre/adapter.ts` (map paint mirrors the tokens).

## 1. What Joymee actually uses (measured)

| Aspect | Joymee value |
|---|---|
| Brand | `#FEE02A` yellow (Mantine `yellow-0…9` all set to it), label text `#000` |
| Ink | `#000000` for nearly all text |
| Secondary text | `#9E9E9E`, `#868E96` |
| Surfaces | page `#FFFFFF`; inputs `#FAFAFA`; segmented track `#EEEEEE`; chips `rgba(135,143,151,.1)` |
| Borders | almost none; a single `1px #EEEEEE` under the header |
| Font | Gotham (`gothamFamily`) — commercial license |
| Type sizes | 16px body (dominant), 20px card/section titles, 25px page titles, 13px and 11px meta |
| Weights | 400 / 500 / 600 / 700 / 800 |
| Radius | Joymee: 16px default, pills `999px`. **Ours:** rounded squares only, scale 6 / 8 / 12 / 16 — no pills, circles only for true dots |
| Shadows | essentially none; image cards use a dark bottom gradient for text legibility |
| Header | 83px, white, bottom border `#EEE` |
| Inputs | 48px tall, borderless, `#FAFAFA` fill, 12px radius |
| Primary button | yellow fill, black 600 label, 12px radius, ~40px tall |
| Selected state | brand fill (segmented tabs, view toggle, chips) |
| Breakpoints | 576 / 768 / 992 / 1200 / 1400 |
| Mobile | bottom tab bar; horizontally scrolling filter chips |

## 2. Our adaptation

| Token | Value | Notes |
|---|---|---|
| `--brand` | `#FEE02A` (Joymee yellow) | Fill only (CTA, selected chip/tab, logo tile, map clusters). Never text on white. |
| `--on-brand` | `#000000` | 15:1 on `--brand` |
| `--brand-hover` | `#F5D30F` | |
| `--ink` / `--primary` | `#000000` | Text, links, focus rings, selected outlines |
| `--muted` | `#5C5C5C` | Joymee's `#9E9E9E` fails WCAG AA (2.7:1); we keep ≥ 4.5:1 |
| `--muted-2` | `#6B6B6B` | Meta text, placeholders |
| `--bg` / `--surface` | `#FFFFFF` | |
| `--surface-subtle` | `#FAFAFA` | |
| `--fill` | `#F3F4F5` (Joymee chip `rgba(135,143,151,.1)` on white) | Default button, inputs, chips, stat tiles, segmented track |
| `--fill-hover` | `#E8EAEC` | |
| `--border` / `--border-2` | `#EEEEEE` / `#E0E0E0` | Used sparingly |
| `--radius-xs` | 6px | Chips, badges, counters |
| `--radius-sm` | 8px | Small controls, segmented items, icon buttons, avatars, thumbnails |
| `--radius` | 12px | Surfaces, buttons, segmented tracks |
| `--radius-lg` | 16px | Bottom sheet top corners, large panels |
| `--header-height` | 72px (desktop) / 124px (mobile map, two rows) | |
| `--panel-width` | 380px | Docked results panel on the map |
| Shadows | `--shadow-sm/md/lg` | Only for things floating over the map (chips, sheet, map controls) |
| Font | Montserrat 400–800 (self-hosted, Cyrillic) | Closest free match for Gotham |

Semantic colors (`--success`, `--danger`, `--warn`, `--accent` and their
`*-soft` tints) stay AA on their soft backgrounds.

## 3. Component rules

- **Buttons:** default = `--fill`, borderless, 12px radius, 600 weight.
  `.primary` = brand fill + black label. `.dark` = black fill + white label.
  `.subtle` = same as default. No shadows.
- **Inputs:** `--fill` background; focus = black 1px border (search) or a brand
  ring (forms).
- **Chips:** rounded squares (`--radius-xs`/`--radius-sm`), never pills; inactive white (over the map) or `--fill`; active = brand.
- **Segmented controls** (language switcher, cabinet nav): `--fill` track,
  rounded-square items; active item = white thumb (language) or brand (nav).
- **Cards:** prefer `--fill` tiles or a 1px `--border` outline. No decorative
  color strips, no gradients, no glass blur.
- **Icons:** one set — 24px Lucide-style line glyphs, `stroke: currentColor`.
  No 3D renders, no gradient badges.
- **Labels:** sentence case. No uppercase tracking.
- **Motion:** transform/opacity only. Entrances use `--ease-out` (header →
  search → chips staggered by `--i` → floating controls); small "pops" use
  `--ease-pop`; pressables scale to ~0.96 on `:active`. Lists stagger by
  ~30ms per item (capped). The selected map pin has a sonar pulse that runs
  only while something is selected. Everything collapses under
  `prefers-reduced-motion`.
- **Map:** every location with ads = brand count badge (white ring, soft
  shadow), always drawn, never hidden by collision; its name rides above in a
  white tag when there's room (tags yield to badges). All badges are one
  size (shrinking together in crowded views); priority on collision is
  neutral — result order in search, distance from the map center while
  browsing — never ad volume (spec §10: no paid boost). No ads = gray dot. Clusters = brand circle with black count.
  Selected = black badge + black tag with brand text, plus a sonar pulse.

## 4. Layout

- **Map desktop:** a solid 72px header bar (brand · search · business CTA ·
  language), a results panel docked to the left edge below it, and a category
  chip row floating over the map.
- **Map mobile:** two header rows (brand + utilities, then full-width search),
  a scrolling chip row, and the results as a full-width bottom sheet.
- **Cabinet:** header with a bottom rule, then the section nav as a segmented
  track.

## 5. Not adopted (yet)

- **Bottom tab bar on mobile:** the public side has one destination (the
  map), so there's nothing to tab between. Revisit if favorites or messages
  get added.
- **Image-led listing cards with gradient overlays:** ad banners are
  advertiser-uploaded with no aspect or quality guarantee yet.
- **Dark mode:** Joymee has one; the token split above makes it a contained
  follow-up.
