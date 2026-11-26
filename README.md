# KeepIt

**Keep every moment, together.**

KeepIt is a private, BeReal-style mobile app built strictly for couples (`2` partners per space), crafted with Expo Router (React Native + TypeScript), Supabase (Postgres RLS, Realtime, Private Storage, Edge Functions), native iOS WidgetKit + Android Jetpack Glance widgets, and a Dark Bento / Electric Blue visual system with spring motion.

## Core Features

1. **Couple Pairing (`(auth)/welcome` & `(auth)/pair`):**
   - Email and password signup/sign-in, with existing Supabase and local account behavior preserved.
   - Concurrency-safe 6-character invite code (`create_or_refresh_invite`, `redeem_invite_code`) and `keepit://pair?code=XXXXXX` deep link preserved across sign-in.
   - Hard database constraint of 2 partners per couple (`distinct_partners`, `active_requires_two`, `trg_single_couple_membership`).
2. **Daily Moment (`(tabs)/index` & `camera`):**
   - Synchronized random daily notification within overlapping waking hours (`schedule-daily-prompts` Edge Function).
   - 2-minute live countdown (`useMomentCountdown`), back + front dual-camera capture, up to 2 retakes during the 2-minute window, optional 100-char caption, and automatic late flag (`is_late`).
   - Server-enforced reciprocal lock (`get_today_moment_bundle` & `sign-moment-urls`): your partner's photos stay locked until you post your own.
3. **Status Share (`status-sheet` & `StatusHeaderCard`):**
   - Emoji + short text (`<= 40` chars) with quick presets (`In class`, `On my way`, `Low battery`, `Coffee run`, `Deep work`, `Winding down`) and custom status.
   - Auto-expiry (`1h`, `3h`, `Till tonight` in poster's local timezone) synced via Supabase Realtime.
4. **Home Screen Widgets (`modules/keepit-widget-bridge`, `targets/ios-widget`, `targets/android-widget`):**
   - Native iOS WidgetKit (`systemSmall` & `systemMedium`) reading App Group `group.com.keepit.shared`.
   - Native Android Jetpack Glance AppWidget reading `SharedPreferences` (`keepit_widget_prefs`).
   - Live in-app interactive widget preview (`Small 2x2` & `Medium 4x2`) and automatic snapshot sync hook (`useWidgetSync`).
5. **Consent-First Map & Location (`(tabs)/map`):**
   - Ghost mode (off) by default (`lat/lng = null`).
   - Three privacy modes: `Live`, `On Moment`, and `Ghost`.
   - Postgres trigger (`trg_location_privacy`) + `dispatch-push` notify your partner automatically every time location sharing turns on or off.
6. **Couple Extras & Privacy (`(tabs)/memories` & `(tabs)/settings`):**
   - Shared daily streak counter, `"Together"` side-by-side daily Moment collage, top-right **Chat** access on Home & Profile, **Memories** in the main 5-tab dock, interactive Calendar archive, and Monthly Memory Recap story deck.
   - Front-camera **Mirror** option (unmirrored by default, toggleable in Camera top bar and Settings), motion toggle, Theme selector (`Light` / `Dark` / `System`), side-by-side widget photo layout, **Unpair**, and **Delete Account & All Data**.

## Visual system and UX patterns

KeepIt v0.6.0 uses a **Dark Bento / Electric Blue** design system across every screen:

- **Palette:** `#000000` canvas, `#0D0D0D` / `#141414` / `#1C1C1E` surfaces, one electric blue accent (`#2F55FF`, with `#4B73FF` and `#8FA8FF` tints), soft blue glows, and fine film grain. Bento tiles replace dense card stacks on Home, Memories, Map, and Recap.
- **Accessibility (WCAG 2.2 AA):** skip link and main landmark on Web, focus-trapped dialogs with a shared Escape stack, labelled form fields with focus on the first error, screen reader announcements, arrow-key navigation for tabs and radio groups, keyboard map controls (`+`, `-`, `0`, arrows), and 44x44 minimum tap targets.
- **Chat:** photo attachments, message search, Copy, sender-only Unsend, and Reply in Chat from a partner or friend Moment.
- **Home, Memories, Profile, Settings:** feed filters (All, Partner, Friends, Yours), memory filters and search, Bestie/Friend tier toggle, Friend Code sharing, and an animation speed control.
- **Navigation and safety:** `NavigationGuard` resumes `pendingInviteCode` after sign-in, peer tabs (`Home`, `Map`, `Capture`, `Memories`, `Profile`) switch in a compact dock, and destructive actions require confirmation via `ConfirmModal`.
- **Truthful states:** Missing, failed, or SVG-generated Moment media shows an unavailable/retry state instead of synthetic photos. Missing location coordinates remain `null` until a real GPS fix, located Moment, or confirmed place check-in exists.

[NEXT_AI_NOTES.md](NEXT_AI_NOTES.md) records the remaining native-device and strict-gate items.

## Quick Start

```bash
npm install
npx expo start
```

### Optional Supabase Backend Setup

Without environment variables, KeepIt runs out of the box in **Local Sandbox Mode** (backed by `AsyncStorage` with partner simulators on Pair, Home, Map, and Memories). To connect a live Supabase project:

1. Apply migrations in `supabase/migrations/0001_initial_schema.sql` through `0004_map_and_extras.sql`.
2. Deploy Edge Functions in `supabase/functions/` (`schedule-daily-prompts`, `sign-moment-urls`, `dispatch-push`, `delete-couple-or-user`).
3. Create `.env`:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
4. For native widgets on physical devices/simulators, run `npx expo prebuild` and build via `npx expo run:ios` / `npx expo run:android` or EAS Build.

## UX maintenance handoff

The recent UX update adds permission primers, location pause controls, loading/error treatments, and navigation hit-target fixes. The strict antislop gate is still incomplete.

Read [NEXT_AI_NOTES.md](NEXT_AI_NOTES.md) before continuing the UX audit. It lists the remaining contrast, control coverage, data states, keyboard focus, demo-content, palette, decision-rationale, and design-direction checks. Coordinate `DESIGN.md` changes with the owner instead of replacing their other-worktree update.
