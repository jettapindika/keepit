# KeepIt Design Direction (`DESIGN.md`)

## Identity & Voice
- **Product:** KeepIt
- **Tagline:** "Keep every moment, together."
- **Audience:** Two partners sharing an intimate, private daily photo ritual and ambient presence.
- **Mood:** Warm, tactile, calm, playful without being childish, photo-first.
- **Dial:** `ENERGY 2 / RHYTHM 2 / MOTION 2`

## Palette (Semantic Light & Dark)
- **Canvas:** `#FAF7F2` (Light Warm Alabaster) / `#141210` (Dark Warm Charcoal) — keeps skin tones warm and natural.
- **Surface:** `#F2ECE4` (Light) / `#1E1B18` (Dark) — separates cards, sheets, and status pills without heavy drop shadows.
- **Surface Elevated:** `#FFFFFF` (Light) / `#282420` (Dark) — used for input slots and active segmented controls.
- **Border:** `#E4DCD2` (Light) / `#332E29` (Dark) — subtle 1px structural dividers.
- **Primary Ink:** `#1F1B18` (Light) / `#F5F0EA` (Dark) — >= 14.8:1 contrast ratio.
- **Muted Ink:** `#6B625B` (Light) / `#A69B90` (Dark) — >= 5.3:1 contrast ratio for timestamps and hints.
- **Locked Accent:** `#D95D39` (Light Terracotta) / `#E66E4C` (Dark Soft Terracotta) — single primary action, active timer, and streak hue.
- **Semantic Status:** Success `#2E7D5B` / `#4BA37C`, Warning `#B86B19` / `#E09132`, Danger `#C43B31` / `#E55A4F`.

## Typography & Shape Scale
- **Typeface:** Platform system font (`SF Pro` on iOS, `Roboto` on Android, system-ui on Web) with `tabular-nums` on timers, invite expiry, and distances.
- **Radii (`borderCurve: 'continuous'`):**
  - Photo frames: `24pt`
  - Cards & sheets: `20pt`
  - Inputs & code slots: `12pt`
  - Primary CTA pills & status chips: `999pt`
- **Spacing:** `8pt` base rhythm (`4, 8, 12, 16, 24, 32, 40`).
- **Identity Motif:** Overlapping `3:4` dual-photo corner PIP.
