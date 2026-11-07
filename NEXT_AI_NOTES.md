# Next AI Notes: Strict Antislop Gate Follow-up

Status: app-wide UI/UX redesign integrated on top of `3499759`; strict antislop gate remains uncertified for native hardware and owner `DESIGN.md` reconciliation.

Completed in this pass:

- Extended the warm monochrome `design.md` system (dark + light palettes, `22px` cards, `10px` actions/inputs, `44px+` touch targets, focus rings, `ScreenKit` controls, and `useAppMotion` live OS/app reduced-motion handling) across Welcome, Auth, Pair, Home, Status Sheet, Moment Cards, Widget Preview, Map, Chat, Profile, Memories, Monthly Recap, Settings, Camera, and the navigation dock.
- Preserved main's account cleanup (`bd630a9`), CARTO map tiles, private Realtime topic builders, Snap Once expiry/scrubbing, 5/day Moment quota, and password/Supabase/local session flows.
- Removed fabricated San Francisco fallback coordinates from `fetchCoupleLocations` and `updateMyLocationShare`, removed synthetic Moment photo fallbacks from `MomentCards` and `camera.tsx`, fixed `data:` URI double-prefixing in web camera capture, resumed `pendingInviteCode` after auth, and surfaced Supabase sign-out and widget-sync errors instead of swallowing them.
- Verified `17/17` behavioral tests (`npm test`), `npx tsc --noEmit`, `npx expo lint`, a clean `expo export --platform web`, a production-bundle browser click-through (onboarding, sign-in, pairing, status save/discard/clear, map modes/check-ins/pan/zoom, dual-camera capture/publish, comments/reactions/story studio/editor, friend add + DM + 15s Snap, memories + monthly recap, light/dark settings), and zero root horizontal overflow across `/`, `/map`, `/messages`, `/profile`, `/memories`, `/settings`, and `/pair` at `320`, `390`, `768`, and `1280` widths.

Still open before claiming a strict gate PASS:

- **R-25 / R-37:** Reconcile `DESIGN.md` (left untouched per owner constraint) with `src/theme/tokens.ts`, and audit dynamic photo/banner overlays at worst-case pixel regions in both themes.
- **R-26 / R-32 / R-35:** Exhaustive keyboard-only traversal of every modal/picker sub-control, 200% zoom / Dynamic Type XL verification, and physical iOS/Android verification for dual-camera video lens switching, hardware GPS, haptics, system share sheets, and WidgetKit/Glance pinning.

## Integration and verification constraints

- `DESIGN.md` was intentionally left untouched. Its typography direction still conflicts with the owner's requested Geist direction; the added `fontSans` token alone does not load or apply a font. Reconcile with the owner's latest design document before implementing typography.
- Preserve the CARTO map tiles already on main and the account-cleanup behavior from `bd630a9` when merging later work.
- Before integration, main had uncommitted camera timing, SVG encoding, authentication, Supabase configuration, test, and native bridge changes. These were restored to the working tree after integration, while concurrent Realtime/security edits were left in place. Backup stash `81967a87948cc167e60e0a9a5ac8396d5c43676f` (`pre-keepit-ui-update-user-changes`) remains available. Do not blindly reapply it or commit unrelated user changes as part of this UX update.
- An isolated snapshot of integrated commit `60248e5` passed 15/15 tests, `tsc --noEmit`, Expo lint, and a clean-cache web export. Validation used loopback Supabase URL `http://127.0.0.1:9` and short key `test` so `isSupabaseConfigured` was false and no live backend received smoke data. A Node loader deprecation and CLI color-environment warnings remain toolchain warnings, not a warning-free certification.
- Chromium smoke coverage at 390x844: empty-submit validation, local signup, Home/Map/Chat/Profile tabs, empty posts/friends/conversations/archive, Memories header navigation, Settings Light/Dark controls, pairing return to the existing Settings route, and saving a status preset. No runtime page errors were recorded; Home root horizontal overflow was false at 360x780 and 768x1024. Some helper clicks needed a fresh visible-element observation after navigation because mounted off-screen routes expose duplicate labels. Exhaustive control coverage, chat with a real peer, error/offline paths, 200% text sizing, native device behavior, and the strict gate remain open.
