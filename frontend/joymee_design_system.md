# Local Ads design system (Joymee-derived)

**Reference:** https://joymee.uz/
**How the reference values were obtained:** computed styles and `:root` custom
properties read from the live site in Chromium (desktop 1440×900, mobile
390×844), 2026-10-14. Joymee is built on Mantine; its theme variables are
quoted below verbatim.

We copy Joymee's **design language** (one loud brand color on black and white,
borderless gray fills, 16px radius, pill chips, flat surfaces). We do **not**
copy its brand: no yellow `#FEE02A`, no Gotham, no logo or imagery. Joymee is a
known brand in the same city, so a yellow-and-black clone would read as theirs.

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
| Radius | 16px default (`--mantine-radius-default`), pills `999px`; scale 8 / 10 / 16 / 40 / 100 |
| Shadows | essentially none; image cards use a dark bottom gradient for text legibility |
| Header | 83px, white, bottom border `#EEE` |
| Inputs | 48px tall, borderless, `#FAFAFA` fill, 16px radius |
| Primary button | yellow fill, black 600 label, 16px radius, ~40px tall |
| Selected state | brand fill (segmented tabs, view toggle, chips) |
| Breakpoints | 576 / 768 / 992 / 1200 / 1400 |
| Mobile | bottom tab bar; horizontally scrolling filter chips |

## 2. Our adaptation

| Token | Value | Notes |
|---|---|---|
| `--brand` | `#C6F432` lime | Fill only (CTA, selected chip/tab, logo tile, map clusters). Never text on white. |
| `--on-brand` | `#000000` | 16:1 on `--brand` |
| `--ink` / `--primary` | `#000000` | Text, links, focus rings, selected outlines |
| `--muted` | `#5C5C5C` | Joymee's `#9E9E9E` fails WCAG AA (2.7:1); we keep ≥ 4.5:1 |
| `--muted-2` | `#6B6B6B` | Meta text, placeholders |
| `--bg` / `--surface` | `#FFFFFF` | |
| `--surface-subtle` | `#FAFAFA` | |
| `--fill` | `#F2F3F4` | Default button, inputs, chips, stat tiles, segmented track |
| `--fill-hover` | `#E8EAEC` | |
| `--border` / `--border-2` | `#EEEEEE` / `#E0E0E0` | Used sparingly |
| `--radius` | 16px | Surfaces and buttons |
| `--radius-sm` | 10px | Small controls, thumbnails |
| `--radius-lg` | 24px | Bottom sheet top corners |
| `--radius-pill` | 999px | Chips, segmented controls |
| `--header-height` | 72px (desktop) / 124px (mobile map, two rows) | |
| `--panel-width` | 380px | Docked results panel on the map |
| Shadows | `--shadow-sm/md/lg` | Only for things floating over the map (chips, sheet, map controls) |
| Font | Montserrat 400–800 (self-hosted, Cyrillic) | Closest free match for Gotham |

Semantic colors (`--success`, `--danger`, `--warn`, `--accent` and their
`*-soft` tints) stay AA on their soft backgrounds.

## 3. Component rules

- **Buttons:** default = `--fill`, borderless, 16px radius, 600 weight.
  `.primary` = brand fill + black label. `.dark` = black fill + white label.
  `.subtle` = same as default. No shadows.
- **Inputs:** `--fill` background; focus = black 1px border (search) or a brand
  ring (forms).
- **Chips:** pills; inactive white (over the map) or `--fill`; active = brand.
- **Segmented controls** (language switcher, cabinet nav): `--fill` track,
  pill items; active item = white thumb (language) or brand (nav).
- **Cards:** prefer `--fill` tiles or a 1px `--border` outline. No decorative
  color strips, no gradients, no glass blur.
- **Icons:** one set — 24px Lucide-style line glyphs, `stroke: currentColor`.
  No 3D renders, no gradient badges.
- **Labels:** sentence case. No uppercase tracking.
- **Map:** markers with ads = black circle with brand-colored count; no ads =
  gray dot; clusters = brand circle with black count; selected = brand halo
  with black outline.

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
