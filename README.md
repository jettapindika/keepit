# KeepIt

**Keep every moment, together.**

KeepIt is a private, BeReal-style mobile app built strictly for couples (`2` partners per space), crafted with Expo Router (React Native + TypeScript), Supabase (Postgres RLS, Realtime, Private Storage, Edge Functions), native iOS WidgetKit + Android Jetpack Glance widgets, and a dark-first visual and spring-motion system adapted from [`realidkroo/Mochy-Music`](https://github.com/realidkroo/Mochy-Music).

## Core Features

1. **Couple Pairing (`(auth)/welcome` & `(auth)/pair`):**
   - Passwordless 6-digit Email OTP sign-in.
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
   - Shared daily streak counter, `"Together"` side-by-side daily Moment collage, rate-limited partner Nudge/Poke, interactive Calendar archive, and Monthly Memory Recap story deck.
   - Motion controls (`AppMotion` speed `0.5x`..`2x` + Reduce Motion), Theme selector (`Dark` / `Light` / `System`), one-tap **Unpair**, and **Delete Account & All Data**.

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
