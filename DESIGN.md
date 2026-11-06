# KeepIt Design Direction (`DESIGN.md`)
> Adapted directly from [`realidkroo/Mochy-Music`](https://github.com/realidkroo/Mochy-Music) (`Theme.kt`, `Type.kt`, `OnboardingDesign.kt`, `SearchDesign.kt`, `FrostedGlass.kt`, `AppNavigation.kt`, `TouchFeedback.kt`, `RevealOnAppear.kt`, `PopupSheet.kt`).

## Identity & Voice
- **Product:** KeepIt
- **Tagline:** "Keep every moment, together."
- **Audience:** Two partners sharing an intimate, private daily photo ritual and ambient presence.
- **Visual Language:** Mochy-Music high-contrast monochrome tonal architecture — deep obsidian/pure-black surfaces, crisp white/silver typography with tight negative tracking (`-0.04em` to `-0.05em`), concentric superellipse (`continuous`) radii, a single floating frosted-chrome pill tab bar, and tactile spring physics.
- **Dial:** `ENERGY 2 / RHYTHM 2 / MOTION 2`

## Palette (Mochy-Music Dark Default + Light Counterpart)
- **Dark Mode (Default, from `Theme.kt`, `SearchDesign.kt`, `MenuSheet.kt`, `FrostedGlass.kt`):**
  - `canvas`: `#000000` (Pure OLED Black — lets daily Moment photos pop without competing color cast)
  - `sheetSurface`: `#0B0B0C` (`MenuSurface`)
  - `surface`: `#141416` (`SearchColors.Field` / card & group container)
  - `surfaceElevated`: `#1E1E21` (`SearchColors.FieldFocused` / inner elevated pills & inputs)
  - `surfacePressed`: `#2C2C2C` (`Onb.Card` / pressed card lift)
  - `border`: `#232326` (`SearchColors.Divider` / hairline structural divider)
  - `chromeGlass`: `rgba(19, 19, 19, 0.78)` (`GlassChromeColor` `#131313` @ `78%`) + `rgba(255, 255, 255, 0.05)` hairline
  - `chromeHighlight`: `rgba(255, 255, 255, 0.10)` (`ChromeHighlightColor` for active sliding nav pill)
  - `ink`: `#FFFFFF` (`21:1` contrast)
  - `inkMuted`: `#9A9AA0` (`SearchColors.Secondary` — `7.5:1` contrast)
  - `placeholder`: `#77777D` (`SearchColors.Placeholder`)
  - `accent`: `#E0E0E0` (`MochyTheme.primary` crisp silver-white CTA pill with `#000000` `onAccent` text — single monochrome primary action)
  - `accentSoft`: `#282830` (`ClusterRows` expanded pill container)
  - `badgeBg` / `badgeFg`: `#E5E5EA` / `#1C1C1E` (`SettingsGroup` circular icon badge)
- **Light Mode (from `Theme.kt` `lightColorScheme`):**
  - `canvas`: `#FFFFFF`
  - `sheetSurface`: `#F7F7F8`
  - `surface`: `#F0F0F2`
  - `surfaceElevated`: `#FFFFFF`
  - `surfacePressed`: `#E4E4E8`
  - `border`: `#DCDCE0`
  - `chromeGlass`: `rgba(245, 245, 247, 0.84)` + `rgba(0, 0, 0, 0.06)` hairline
  - `chromeHighlight`: `rgba(0, 0, 0, 0.08)`
  - `ink`: `#000000` (`21:1` contrast)
  - `inkMuted`: `#55555C` (`7.3:1` contrast)
  - `accent`: `#141416` (with `#FFFFFF` `onAccent` text)
  - `accentSoft`: `#E5E5EA`
  - `badgeBg` / `badgeFg`: `#1C1C1E` / `#FFFFFF`
- **Semantic State Signals (used strictly for real status/late/danger states):**
  - `success`: `#34C759` / `#2E7D5B` (live status / active sharing dot)
  - `warning`: `#F5A623` / `#B86B19` (late Moment flag)
  - `danger`: `#FF453A` / `#C43B31` (destructive unpair / delete)

## Typography & Shape Scale (`Type.kt` & `SettingsGroup.kt`)
- **Typeface:** `Inter` / system sans, `SemiBold` (`600`) & `Bold` (`700`) default weights, tight letter-spacing (`-0.04em` on titles, `-0.03em` on body/inputs), `tabular-nums` on timers and distances.
- **Concentric Radii (`borderCurve: 'continuous'`):**
  - Grouped containers & sheets: `28pt` (`SettingsGroup.GroupedItems`)
  - Photo frames & Hero cards: `24pt` (`OnbCard`)
  - Classic cards & inner clusters: `20pt` (`SettingsGroup.ClassicItems`)
  - Inputs & compact tiles: `14pt`
  - Buttons, single-line pill fields, & floating nav bar: `999pt` (`CircleShape` / stadium `64pt` nav bar)

## Mochy-Music Motion System (`TouchFeedback.kt`, `AppNavigation.kt`, `RevealOnAppear.kt`, `AppMotion.kt`)
- **Global Motion Speed (`AppMotion`):** User-adjustable speed multiplier (`0.5x` .. `2x`, default `1x`) + Reduce Motion toggle in Settings.
- **`pressBounce` (`TouchFeedback.kt`):** Press-in squishes with `spring(dampingRatio = 1.0, stiffness = 1600)` (`0.97` for pill buttons, `0.985` for cards, `0.88` for icon/tab buttons); release rebounds with bouncy overshoot `spring(dampingRatio = 0.38, stiffness = 520)`.
- **Stretching Nav Pill (`AppNavigation.kt`):** `64pt` floating frosted-chrome stadium bar (`#131313` @ `78%` — single glass chrome element, well within `R-10` 1–2 element cap). Leading edge springs faster (`dampingRatio = 0.82, stiffness = 700`) than trailing edge (`dampingRatio = 0.82, stiffness = 320`), stretching across tabs before settling.
- **`RevealOnAppear` (`RevealOnAppear.kt`):** First-mount elements fade (`0 -> 1`) and slide up `20pt` over `520ms` using `Easing.bezier(0.2, 0, 0, 1)` with `60ms` cascade steps (max `6` steps).
- **`PopIn` (`LibraryDownloadIcon.kt`):** Badges, PIP swaps, and Nudge pops use `spring(dampingRatio = 0.45, stiffness = 420)`.
