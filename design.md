# Max Wallet onboarding design system

## 1. Overview

- **Target:** iOS portrait, `390 × 844 px` viewport.
- **Mood:** near-black, quiet, editorial, secure, high contrast.
- **Target feel:** a playful crypto introduction with a serious, readable control surface.
- **Design read:** ENERGY `2` / RHYTHM `1` / MOTION `2`.
- **Design principle:** keep every functional control monochrome so the yellow illustration is the only visual accent.
- **Scope:** app viewport only. Exclude the presentation backdrop, phone mockup bezel, Dribbble UI, and macOS chrome.

## 2. Color tokens

The exact sampled app colors are marked `observed`. Composite text colors are marked `approx.` because anti-aliased text pixels blend with the sheet surface.

| Token | HEX | Usage |
|---|---:|---|
| `color.bg.app` | `#0A0708` | Full app viewport and hero zone. Observed. |
| `color.surface.sheet` | `#1F1D1E` | Bottom sheet. Observed. |
| `color.accent.hero` | `#FFCF24` | Main illustration yellow. Observed. |
| `color.accent.hero-bright` | `#FFDD00` | Bright illustration planes. Observed. |
| `color.accent.hero-shadow` | `#FFCC00` | Illustration secondary planes. Observed. |
| `color.accent.hero-light` | `#FFF5B3` | Small illustration highlights. Observed. |
| `color.ink.primary` | `#FFFFFF` | Title, primary CTA fill, links, status icons, home indicator. Observed. |
| `color.ink.secondary` | `#E2E1E2` (approx.) | Subtitle. Implement as `rgba(255,255,255,0.80)`. |
| `color.ink.tertiary` | `#8A8889` (approx.) | Legal copy. Implement as `rgba(255,255,255,0.48)`. |
| `color.button.fill` | `#FFFFFF` | Primary button fill. Observed. |
| `color.button.label` | `#000000` | Primary button label. Observed in darkest label pixels. |
| `color.divider` | `#2A2829` (approx.) | Optional token divider only. No visible divider on the onboarding sheet. |
| `color.disabled.overlay` | `rgba(255,255,255,0.42)` | Disabled primary button opacity. |

### CSS variables

```css
:root {
  --color-bg-app: #0A0708;
  --color-surface-sheet: #1F1D1E;

  --color-accent-hero: #FFCF24;
  --color-accent-hero-bright: #FFDD00;
  --color-accent-hero-shadow: #FFCC00;
  --color-accent-hero-light: #FFF5B3;

  --color-ink-primary: #FFFFFF;
  --color-ink-secondary: rgb(255 255 255 / 0.80);
  --color-ink-tertiary: rgb(255 255 255 / 0.48);

  --color-button-fill: #FFFFFF;
  --color-button-label: #000000;
  --color-divider: rgb(255 255 255 / 0.06);
}
```

### Tailwind `theme.extend.colors`

```js
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        app: {
          bg: '#0A0708',
          sheet: '#1F1D1E',
        },
        hero: {
          yellow: '#FFCF24',
          bright: '#FFDD00',
          shadow: '#FFCC00',
          light: '#FFF5B3',
        },
        ink: {
          primary: '#FFFFFF',
          secondary: 'rgb(255 255 255 / 0.80)',
          tertiary: 'rgb(255 255 255 / 0.48)',
        },
        button: {
          fill: '#FFFFFF',
          label: '#000000',
        },
        divider: 'rgb(255 255 255 / 0.06)',
      },
    },
  },
};
```

**Color rules:** yellow belongs to hero artwork only. Do not use yellow for buttons, text, links, pagination, status icons, or borders.

## 3. Typography

### Families

- **UI sans:** `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", Arial, sans-serif`.
- **CTA mono:** `"Space Mono", "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace`.
- **Closest Google Fonts match:** `Inter` for UI text and `Space Mono` for CTA labels.
- Load only the weights used: sans `400`, `600`; mono `400`, `700`.
- Use `font-variant-numeric: tabular-nums` only for numeric wallet data, not onboarding copy.

### Scale

| Style | Size | Weight | Line height | Letter spacing | Case | Alignment |
|---|---:|---:|---:|---:|---|---|
| Title | `28 px` | `600` | `34 px` | `-0.3 px` | Sentence case | Center |
| Body / subtitle | `13 px` | `400` | `20 px` | `0 px` | Sentence case | Center |
| Primary CTA label | `16 px` | `700` | `20 px` | `0.8 px` | Uppercase | Center |
| Secondary CTA label | `15 px` | `700` | `20 px` | `1.0 px` | Uppercase | Center |
| Legal | `12 px` | `400` | `18 px` | `0 px` | Sentence case | Center |

- Title and body use the sans family.
- Primary and secondary CTA labels use the mono family.
- Legal links use the same sans family and `color.ink.primary`; surrounding legal copy uses `color.ink.tertiary`.
- Keep title and subtitle to exactly 2 lines in the supplied slides. Use explicit line breaks instead of relying on device font metrics.

### Slide copy

| Slide | Title lines | Subtitle lines | Active dot |
|---:|---|---|---:|
| `0` | `Your all access pass` / `to Web3` | `A wallet built to be your ultimate gate to` / `Crypto, NFTs, DeFi and so on` | `0` |
| `1` | `Non-custodial` / `& secure` | `Rest knowing you have complete control` / `over your digital assets, keys, and data` | `1` |
| `2` | `Invest Smarter` / `with AI` | `Our AI helps you make informed smart` / `decisions regarding your assets` | `2` |

The reference capture shows the first indicator active on each presented phone. In the implementation, `activeIndex` MUST move with the current slide.

## 4. Spacing, radius, elevation

### Spacing scale

| Token | Value |
|---|---:|
| `space-1` | `4 px` |
| `space-2` | `8 px` |
| `space-3` | `12 px` |
| `space-4` | `16 px` |
| `space-5` | `20 px` |
| `space-6` | `24 px` |
| `space-7` | `28 px` |
| `space-8` | `32 px` |
| `space-9` | `40 px` |
| `space-10` | `48 px` |

Primary measured values: sheet inset `20 px`, sheet top `384 px`, sheet radius `22 px`, content width `310 px`, CTA height `58 px`.

### Radius tokens

| Token | Value | Usage |
|---|---:|---|
| `radius.sheet` | `22 px` | Bottom sheet. Sampled estimate from a `21.4 px` corner. |
| `radius.button` | `10 px` | Primary button. Sampled estimate from a `10.5 px` corner. |
| `radius.indicator` | `3 px` | Active pagination pill. |
| `radius.indicator-small` | `2 px` | Inactive pagination dash. |

### Elevation and effects

- Sheet shadow: none.
- Sheet border: none.
- Backdrop blur: none.
- Hero glow: none.
- App background: flat `#0A0708`; do not use the yellow-to-cream presentation gradient.
- The sheet is separated by its surface color only: `#1F1D1E` over `#0A0708`.

## 5. Layout

All coordinates below are viewport coordinates for `390 × 844 px`. `y=0` is the top of the app viewport.

| Region | Bounds | Internal rules |
|---|---|---|
| iOS status bar | `x=0, y=0, w=390, h=47` | Native light-content status bar. Time `9:41` and system icons are white. Do not draw fake signal, Wi-Fi, battery, or Dynamic Island UI. |
| Hero zone | `x=0, y=47, w=390, h=337` | Flat app background. Illustration is centered at `x=195`; no container. |
| Hero art frame | `x=44, y=75, w=302, h=278` | Transparent asset. Keep visible art inside approximately `x=82..308, y=90..335`; exact bounds vary by slide composition. |
| Bottom sheet | `x=20, y=384, w=350, h=434` | Surface `#1F1D1E`, radius `22 px`; no border or shadow. |
| Sheet content column | `x=40, y=418, w=310` | All title, subtitle, dots, CTAs, and legal copy remain inside this column. |
| Title block | `x=40, y=418, w=310, h=68` | Two centered lines, `28/34`; visual ink begins around `y=425`. |
| Subtitle block | `x=40, y=498, w=310, h=40` | Two centered lines, `13/20`; use `color.ink.secondary`. |
| Pagination wrapper | `x=40, y=560, w=310, h=24` | Centered group. Visible indicators sit around `y=567..584`. |
| Primary CTA | `x=40, y=607, w=310, h=58` | White fill, black mono label, radius `10 px`. |
| Secondary CTA target | `x=40, y=678, w=310, h=44` | No fill, no border. Label visual center around `y=701`. |
| Legal block | `x=40, y=744, w=310, h=48` | Two centered lines, `12/18`; links are white. |
| Home indicator | `x=128, y=827, w=134, h=5` | Native iOS home indicator or a white `134 × 5 px` pill with radius `3 px`; bottom gap `12 px`. |

### Flow constraints

1. The sheet is bottom-aligned to `y=818`, leaving `26 px` of app background below it.
2. The home indicator stays below the sheet on the app background.
3. The illustration MUST stop above the sheet. It MUST NOT be clipped by or layered behind the sheet.
4. The card content column is `310 px` wide. The primary button uses the full column width.
5. On a different viewport, preserve `20 px` horizontal margins, bottom safe-area behavior, the sheet radius, and the content hierarchy. Do not scale text below the specified sizes.
6. The sheet remains fixed-height for these three slides. New copy MUST fit the supplied two-line title and two-line subtitle frames.

## 6. Components

### Bottom sheet

**Anatomy**

1. Surface container.
2. Two-line title.
3. Two-line subtitle.
4. Three pagination indicators.
5. Primary CTA.
6. Secondary text CTA.
7. Two-line legal copy with two inline links.

**Dimensions**

- `350 × 434 px` at `390 × 844 px`.
- Horizontal inset `20 px` from the viewport.
- Bottom offset `26 px` above the viewport bottom.
- Radius `22 px` on all four corners.
- Internal horizontal padding `20 px`.
- No scrolling, header, close icon, drag handle, or extra surface.

**States**

- **Default:** `#1F1D1E`, fully opaque, no elevation.
- **Slide transition:** keep the container in place; replace hero and copy as one coordinated state.
- **Pressed:** not applicable to the container. Only child controls respond.
- **Disabled:** not applicable. Disable the relevant child control, not the entire sheet.

### Pagination indicator

- Group: 3 indicators, centered.
- Group width: approximately `30 px` including gaps.
- Active: `6 × 16 px`, `color.ink.primary`, radius `3 px`.
- Inactive: `4 × 10 px`, `color.ink.primary` at `35%` opacity, radius `2 px`.
- Gap: `5 px` horizontal.
- Align indicators by vertical center.
- **Default:** current slide uses the active pill.
- **Pressed:** if dots are tappable, set opacity to `70%` for `100 ms`; do not change color.
- **Disabled:** opacity `20%`; swipe remains the preferred navigation if available.
- Accessibility label: `Slide 1 of 3`, `Slide 2 of 3`, or `Slide 3 of 3`.

### Primary button

- Label: `CREATE WALLET`.
- Frame: `310 × 58 px`.
- Radius: `10 px`.
- Fill: `#FFFFFF`.
- Label: `#000000`, Space Mono, `16/20`, weight `700`, tracking `0.8 px`.
- No icon, gradient, border, or shadow.
- **Default:** full opacity.
- **Pressed:** fill remains white with `88%` overall opacity; scale to `0.98` for `100 ms`.
- **Disabled:** overall opacity `42%`; no yellow replacement state; retain the label and touch target.
- Minimum touch target: `58 px` high, full `310 px` width.

### Secondary text button

- Label: `I ALREADY HAVE A WALLET`.
- Target: `310 × 44 px`.
- No fill, border, background, icon, or underline.
- Label: `color.ink.primary`, Space Mono, `15/20`, weight `700`, tracking `1 px`.
- **Default:** `90%` white opacity.
- **Pressed:** `64%` white opacity for `100 ms`.
- **Disabled:** `30%` white opacity.
- Keep this control visually subordinate to the primary CTA by using text only.

### Legal text

- Copy: `By continuing, you accept our Terms & Conditions and Privacy Policy.`
- Force two lines:
  - `By continuing, you accept our Terms &`
  - `Conditions and Privacy Policy.`
- Frame: `310 × 48 px`.
- Sans, `12/18`, weight `400`, centered.
- Surrounding copy: `rgba(255,255,255,0.48)`.
- `Terms & Conditions` and `Privacy Policy`: `#FFFFFF`.
- Links use underline only if the platform's native link treatment requires it; the reference uses color contrast, not a visible heavy underline.
- **Default:** muted copy, white links.
- **Pressed link:** white link opacity `70%` for `100 ms`.
- **Disabled link:** opacity `35%`; retain surrounding copy.

## 7. Illustration style guide

### Palette

Use a maximum of 6 colors per illustration:

1. `#FFCF24` main yellow.
2. `#FFDD00` bright yellow.
3. `#FFCC00` yellow shadow plane.
4. `#FFF5B3` small yellow highlight.
5. `#000000` line, cutout, and shadow detail.
6. `#FFFFFF` hands, cuffs, and small highlights.

Do not use the app surface color inside the illustration unless it is a deliberate cutout. Do not add blue, purple, green, red, orange, gradients, grain, or photographic texture.

### Form and line rules

- Flat 2D editorial vector style.
- Use 2 to 5 px black contour or internal detail strokes at `390 px` output width.
- Use hard-edged fills and offset black shadow shapes; no soft drop shadows.
- Use white hand or cuff shapes as the secondary material.
- Use black interior cuts to separate overlapping yellow objects.
- Use one primary metaphor per slide: access, security, or intelligent decision-making.
- Use 3 to 7 overlapping objects. Vary scale and angle; avoid a symmetrical icon stack.
- Draw crypto references as recognizable objects: Ethereum coin, globe, ribbon, shield, token, card, hand, or phone.
- Keep all lettering inside artwork optional. If lettering is used, use only short crypto marks such as `ETH`, `DEFI`, or a token symbol.
- Do not place artwork inside a card, circle, gradient, glow, or colored background.

### Composition rules

- Place the art in a transparent frame approximately `302 × 278 px`.
- Keep the visual center near `(195, 215)` in the `390 × 844` viewport.
- Keep visible bounds approximately `x=82..308`, `y=90..335`.
- Leave at least `28 px` of black space above the sheet top.
- Use a diagonal or curved motion line through the object group; do not use a rigid horizontal row.
- Keep the hand, phone, card, or shield as the scale anchor.
- Do not let any object touch the status bar, sheet, or phone edge.
- Preserve large black negative space around the group. The art is the only colored focal point.

### Ready-to-use image-generation prompts

**Create Wallet**

> Transparent-background flat 2D editorial vector illustration for a dark iOS crypto wallet onboarding screen, one open golden wallet with a small white hand presenting a black phone, Ethereum coins and a curved DEFI ribbon orbiting the wallet, colors limited to #FFCF24, #FFDD00, #FFCC00, #FFF5B3, #000000, and #FFFFFF, thick black contour lines, hard-edged offset shadows, white cuff detail, asymmetrical diagonal composition, centered object group with generous negative space, no text except a tiny ETH mark, no gradient, no glow, no frame, no 3D, no photorealism.

**Seed Phrase backup**

> Transparent-background flat 2D editorial vector illustration for a dark iOS crypto wallet onboarding screen, a sealed golden envelope protecting twelve abstract black-and-yellow key tiles, a white gloved hand and cuff holding the envelope, small Ethereum coins and a short ribbon orbiting the object, colors limited to #FFCF24, #FFDD00, #FFCC00, #FFF5B3, #000000, and #FFFFFF, thick black editorial contour lines, hard-edged shadow planes, asymmetrical floating composition, centered in a tall transparent frame, no readable seed words, no gradient, no glow, no frame, no 3D, no photorealism.

**Send and receive**

> Transparent-background flat 2D editorial vector illustration for a dark iOS crypto wallet onboarding screen, two white hands passing a large golden Ethereum coin between a black phone and a golden crypto card, curved golden ribbon bands show movement, three smaller coins overlap the hands, colors limited to #FFCF24, #FFDD00, #FFCC00, #FFF5B3, #000000, and #FFFFFF, thick black contour lines, hard-edged offset shadows, asymmetrical diagonal composition, centered with generous negative space, no UI text, no gradient, no glow, no frame, no 3D, no photorealism.

## 8. Motion

Motion exists to connect the user's swipe to the new slide and to give the static illustration slight physical lightness. It must not compete with the copy.

| Interaction | Duration | Easing | Behavior |
|---|---:|---|---|
| Horizontal swipe transition | `320 ms` | `cubic-bezier(0.22, 1, 0.36, 1)` | Move the current slide out and next slide in on the swipe axis. |
| Hero crossfade | `220 ms` | `ease-out` | Fade the outgoing art to `0` while the incoming art reaches `1`. |
| Hero float | `1,800 ms` each way | `ease-in-out` | Translate the hero group `4 px` vertically; one subtle loop only while the slide is visible. |
| Pagination morph | `180 ms` | `ease-in-out` | Active `6 × 16 px` pill and inactive `4 × 10 px` dash interpolate size and opacity. |
| Primary button press | `100 ms` down, `120 ms` up | `ease-out` | Scale `1.0 → 0.98 → 1.0`; apply `88%` opacity while pressed. |
| Secondary button press | `100 ms` | `ease-out` | Apply opacity `90% → 64% → 90%`; no scale. |

- Support left and right swipe navigation.
- Allow dot tap navigation if dots are interactive.
- Do not autoplay between slides.
- Respect `prefers-reduced-motion`: remove hero float, use a `0 ms` crossfade, and keep the dot state change.
- Keep system status and home indicator static.

## 9. Do's and Don'ts

### Do

1. Do keep the viewport background at `#0A0708` and the sheet at `#1F1D1E`.
2. Do reserve `#FFCF24` and its yellow variants for the illustration.
3. Do keep all title and subtitle copy inside explicit two-line frames.
4. Do use Space Mono or the SF Mono fallback for both CTA labels.
5. Do use the native iOS status bar and home indicator treatment.

### Don't

1. Do not put yellow on buttons, text, dots, links, dividers, or system chrome.
2. Do not add gradients, glows, glass blur, borders, or shadows to the sheet.
3. Do not place CTA or legal text outside the bottom sheet.
4. Do not add a logo, toolbar, close button, skip label, menu, or extra navigation to these screens.
5. Do not replace the editorial vector hero with a 3D render, stock icon, photograph, or generic crypto dashboard.

## 10. Agent usage notes

- Treat this file as the source of truth for the onboarding surface.
- Use the color, spacing, radius, and typography tokens. Never hardcode a second hex value in component code.
- Build mobile-first at `390 × 844 px`; verify the exact viewport before tuning larger devices.
- Use a safe-area-aware root. Let iOS render the status icons and home indicator; do not recreate them with text or SVG icons.
- Keep the hero layer separate from the sheet layer. The sheet owns every text and CTA node.
- Use explicit slide data with `titleLines`, `subtitleLines`, `artAsset`, and `activeIndex`. Do not infer line breaks from incidental font wrapping.
- Make `CREATE WALLET` and `I ALREADY HAVE A WALLET` real controls with real navigation or callbacks. Do not ship decorative dead buttons.
- Keep the pagination state synchronized with the current slide. The active indicator is not permanently index `0`.
- Render artwork as a transparent vector or raster asset with the defined palette. Do not bake the sheet, phone bezel, status bar, or backdrop into the asset.
- Do not implement the presentation backdrop from the reference. The app surface is only the near-black viewport, black artwork details, yellow artwork, white artwork accents, and bottom sheet.
- Test long-font and Dynamic Type behavior. The three supplied slides must remain two lines at the base scale; if accessibility text size changes, preserve readable clipping or move to a scrollable legal-safe variant rather than overlapping controls.
- Check these invariants at `390 × 844`: sheet bounds `20/384/350/434`, button bounds `40/607/310/58`, no text outside the sheet, no yellow UI chrome, and native white status/home indicators.

### Example build prompt

> Build one new Max Wallet onboarding screen at 390 × 844 for the `Seed Phrase backup` step. Use `design.md` as the only visual source of truth. Use `#0A0708` for the viewport and `#1F1D1E` for a 350 × 434 bottom sheet at x=20, y=384. Keep a transparent yellow and black editorial vector illustration centered in the hero zone. Use Inter or the native SF Pro fallback for a 28 px two-line title and 13 px two-line subtitle. Use Space Mono for the uppercase 16 px primary label and 15 px secondary label. Keep the primary button white with black text and 10 px radius. Keep yellow out of all UI chrome. Use native iOS status and home indicators, explicit line breaks, a three-state pagination component with the second dot active, and the motion timings in section 8. Do not add a logo, toolbar, gradient, shadow, or extra control.
