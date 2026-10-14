# Joymee.uz — Reconstructed Design System

**Source:** https://joymee.uz/  
**Status:** Provisional reconstruction, **not** a verified extraction of computed website styles.  
**Purpose:** A starting design system for a map-oriented marketplace inspired by Joymee. Validate values against rendered desktop and mobile pages before claiming visual fidelity.

## 1. Design principles

- Clean, modern marketplace interface with prominent search and filtering.
- Map-first browsing alongside listing discovery.
- Clear primary actions, restrained borders and shadows, rounded controls.
- Responsive layouts for desktop and mobile.

## 2. Color tokens (proposed)

| Token | Hex | Usage |
|---|---|---|
| `--color-primary` | `#2563EB` | Primary buttons, selected states |
| `--color-primary-hover` | `#1D4ED8` | Hover states |
| `--color-background` | `#FFFFFF` | Page background |
| `--color-surface` | `#F8FAFC` | Secondary surfaces |
| `--color-border` | `#E5E7EB` | Dividers, inputs, cards |
| `--color-text` | `#111827` | Main text |
| `--color-text-muted` | `#6B7280` | Secondary text |
| `--color-success` | `#16A34A` | Success states |
| `--color-muted` | `#F3F4F6` | Inactive backgrounds |

> These colors are **not confirmed** as Joymee's actual palette.

## 3. Typography (proposed)

- Font stack: `Inter, Arial, sans-serif` (actual font unverified).
- Extra-small: `12px`.
- Small/body UI: `14px`.
- Base content: `16px`.
- Large: `20px`.
- Heading: `24px` to `28px`, weight `600–700`.
- Button labels: `14px`, weight `500–600`.
- Body line-height: `1.5`.

## 4. Spacing and sizing (proposed)

| Element | Value |
|---|---|
| Spacing scale | `4, 8, 12, 16, 24, 32px` |
| Header height | `64px` |
| Inputs | `44px` height |
| Buttons | `40–44px` height |
| Card internal padding | `16px` |
| Section gap | `24–32px` |
| Small radius | `8px` |
| Medium radius | `12px` |
| Large radius | `16px` |
| Pill radius | `999px` |
| Border | `1px solid #E5E7EB` |
| Card shadow | `0 2px 8px rgba(0,0,0,.06)` |
| Fast transition | `150ms ease` |

## 5. Component inventory

### Header and navigation
- Logo/brand area.
- Search entry point.
- Language selection.
- Account/profile navigation.
- Primary listing creation action.
- Compact mobile navigation variant.

### Search and filters
- Search input with search action.
- Transaction-type filter chips (e.g., sale/rent).
- Additional property filters.
- Map/list view action.
- Selected, default, hover, disabled, and focus states.

### Listing cards
- Listing image, title, price, location, and relevant metadata.
- Rounded card container and consistent internal spacing.
- Loading, empty, and error states.

### Map browsing
- Map canvas with listing markers.
- Filter/search controls accessible while browsing.
- Responsive relationship between map and results.

### Forms and account
- Sign-in and account/profile controls.
- Text fields, selects, validation messages, and primary/secondary actions.

> Component categories reflect the site's marketplace functionality; exact component geometry and styling still require browser verification.

## 6. Responsive design recommendations

- Desktop: allow map and results to share the main workspace.
- Tablet: reduce sidebar width and collapse less-important filters.
- Mobile: prioritize search, a compact filter row, map/list switching, and accessible primary actions.
- Verify actual breakpoints, sticky behavior, and mobile navigation directly from the site.

## 7. CSS tokens

```css
:root {
  /* Provisional palette */
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-background: #ffffff;
  --color-surface: #f8fafc;
  --color-text: #111827;
  --color-text-muted: #6b7280;
  --color-border: #e5e7eb;
  --color-success: #16a34a;
  --color-muted: #f3f4f6;

  /* Typography */
  --font-family: Inter, Arial, sans-serif;
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-base: 16px;
  --font-size-lg: 20px;
  --font-size-xl: 24px;

  /* Shapes */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-pill: 999px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  /* Layout */
  --header-height: 64px;
  --input-height: 44px;
  --button-height: 44px;

  /* Effects */
  --shadow-card: 0 2px 8px rgba(0, 0, 0, .06);
  --transition-fast: 150ms ease;
}
```

## 8. Verification checklist for a pixel-accurate extraction

- [ ] Capture desktop and mobile screenshots of main pages.
- [ ] Inspect computed font family, weights, sizes, and line heights.
- [ ] Sample exact brand and semantic colors.
- [ ] Measure header, content widths, gaps, card dimensions, and radii.
- [ ] Inspect buttons, inputs, dropdowns, chips, and shadows.
- [ ] Record responsive breakpoints and sticky/overlay behavior.
- [ ] Capture hover, focus, selected, loading, empty, and error states.
- [ ] Replace all provisional tokens with verified values.

## 9. Implementation note

Use these tokens as an initial theme, not as evidence of Joymee's exact styling. Recreate the design language with original branding, assets, and content for your product.
