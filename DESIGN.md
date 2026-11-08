# KeepIt Design Direction (`DESIGN.md` — Threads Light System)

## Identity & Voice
- **System:** Threads Light System
- **Product:** KeepIt
- **Tagline:** "Keep every moment, together."
- **Audience:** Two partners and close friends sharing a daily dual-camera photo ritual, ambient status, and private moments.
- **Visual Language:** Minimal, confident, and utilitarian social-feed system with high black-and-white contrast (`#FFFFFF` surfaces, `#F5F5F5` tertiary cards, `#000000` ink and primary button fills), subtle `#00000026` 1px borders, `system-ui` sentence-case typography (`0px` letter-spacing), `20px` (`rounded.lg`) interactive controls, `24px` (`rounded.xl`) cards/modals, and a single vivid blue (`#1876F2`) reserved for focus, links, and active states.
- **Dial:** `ENERGY 1 / RHYTHM 2 / MOTION 1`

## Colors
- **Light Mode (Default — Threads Light System):**
  - `primary` / `focusRing`: `#1876F2` (Threads blue for focus, links, and active states)
  - `secondary` / `ink` / `accent`: `#000000` (Pure black for brand marks, headings, icons, and primary button fills)
  - `tertiary` / `surface`: `#F5F5F5` (Soft neutral gray for cards and subtle tonal separation)
  - `neutral` / `canvas` / `sheetSurface` / `surfaceElevated`: `#FFFFFF` (Base white surface for app shell, modals, inputs, and secondary button fills)
  - `border` / `controlBorder`: `#00000026` (1px translucent black divider and card/button outline)
  - `inkMuted`: `#595959` / `#8E8E8E` (Secondary text color for timestamps, helper text, and lower-emphasis instructions; `#595959` on `#F5F5F5` / `#FFFFFF` ensures >= 4.5:1 AA contrast for normal text while `#8E8E8E` serves muted decorative chrome)
  - `error` / `danger`: `#D92D20`
- **Dark Mode Counterpart:**
  - `canvas`: `#0A0A0A`
  - `sheetSurface` / `surfaceElevated`: `#121212`
  - `surface` (card): `#181818`
  - `ink` / `accent`: `#FFFFFF` (`onAccent`: `#000000`)
  - `inkMuted`: `#A3A3A3`
  - `border` / `controlBorder`: `#FFFFFF26`
  - `focusRing`: `#1876F2`
  - `danger`: `#F04438`

## Typography (`system-ui`, `0px` letter-spacing, sentence case)
- `headline-display`: `32px`, weight `600`, line-height `1.1` (`35px`) — onboarding and hero titles
- `headline-lg`: `24px`, weight `600`, line-height `25px` — page headers
- `headline-md`: `22px`, weight `600`, line-height `25px` — modal and card headlines
- `headline-sm`: `20px`, weight `600`, line-height `24px` — sub-headers
- `title-md`: `18px`, weight `600`, line-height `22px` — section headers
- `body-lg`: `16px`, weight `400`, line-height `23px` (`1.45`)
- `body-md`: `16px`, weight `400`, line-height `22px`
- `body-sm`: `15px`, weight `400`, line-height `21px` (`1.4`)
- `label-lg`: `16px`, weight `600`, line-height `20px` (`1.2`)
- `label-md`: `15px`, weight `600`, line-height `18px` (`1.2`) — button labels (sentence case, never uppercase or monospace)
- `label-sm`: `14px`, weight `600`, line-height `17px` (`1.2`) — nav items and compact labels
- `micro`: `12px`, weight `400`, line-height `15px` (`1.2`)

## Radii & Spacing
- **Radii:** `none: 0px`, `sm: 4px`, `md: 8px` (nav items), `lg: 20px` (buttons & inputs), `xl: 24px` (cards & modals), `full: 9999px` (avatars & status dots).
- **Spacing:** `xs: 6px`, `sm: 16px`, `md: 24px`, `lg: 32px`, `xl: 56px`.
- **Components:**
  - `button-primary`: `#000000` fill (`#1876F2` on hover/focus), `#FFFFFF` text, `label-md` (`15px` weight `600`), `20px` radius.
  - `button-secondary`: `#FFFFFF` fill, `#000000` text, `1px` `#00000026` border, `20px` radius.
  - `button-tertiary`: transparent fill, `#000000` text, `body-sm` (`15px` weight `400`), `0px` radius.
  - `card`: `#F5F5F5` fill, `#000000` text, `24px` radius, `1px` `#00000026` border, `32px 24px 28px` padding.
  - `input`: `#FFFFFF` fill, `#000000` text, `20px` radius, `12px 16px` padding, `#00000026` border, `#1876F2` focus border.
  - `modal`: `#FFFFFF` fill, `#000000` text, `24px` radius, `32px 24px` padding.
  - `nav-item`: transparent fill (subtle tint when active), `#000000` text, `label-sm` (`14px` weight `600`), `8px` radius, `8px 12px` padding.
