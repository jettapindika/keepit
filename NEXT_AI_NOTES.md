# Next AI Notes: Strict Antislop Gate Follow-up

The current implementation fixes the blocking interaction problems and is ready to integrate into `main`. The latest verified checks were `npm test` with 14/14 passing, `npx tsc --noEmit`, `npx expo lint`, a fresh Expo web export, direct tab/header click-through in Chromium, and zero horizontal overflow at the tested narrow and tablet widths.

Do not claim a clean strict antislop gate without finishing these items:

- **R-25:** Audit every text/background pairing, image overlay, non-text boundary, focus state, and semantic state in both themes. `src/theme/tokens.ts` uses corrected placeholder values (`#94949C` Dark, `#686870` Light), but `DESIGN.md` still documents the old `#77777D` value. Reconcile this only after reading the owner's latest `DESIGN.md` update. Do not overwrite that other-worktree change.
- **R-26:** Build an inventory of every interactive control and exercise each action, including modal close/save/cancel controls, switches, radios, calendar cells, map controls, widget controls, profile controls, and destructive confirmations.
- **R-27:** Add or verify explicit loading, empty, and error/retry states for Status, Widget, Profile/Friends paths, Settings, Pairing, and any remaining query-backed surfaces.
- **R-32:** Focus treatment currently exists on `KeepItButton` and `MochyCard`; audit custom `Pressable`, `Switch`, radio, tab, and modal controls for keyboard focus visibility and logical tab order.
- **R-35:** Keep evidence for the exhaustive control click-through separate from the core smoke test. Real-device camera, GPS, haptics, and native widget behavior remain unverified on the VPS.
- **R-38 / C-5:** Existing local/demo data still includes plausible named directory profiles and seeded demo conversation/location/moment content (`Sora Kim`, `Leo Vance`, `Maya Lin`, `Kai Tanaka`). Some actions are labeled `Demo`, but the underlying records still look realistic. Either make the demo boundary unmistakable everywhere or replace the seeded content with explicit placeholders before claiming a strict pass.
- **R-29:** The app system palette is monochrome, but filter presets, music covers, generated media, and some seeded profile data intentionally contain additional colors. Decide whether those content colors are exempted as user/content imagery or normalize them before claiming strict palette compliance.
- **R-31:** The decision ledger covers major design choices, not every visual decision in the repository. Expand it only if the strict gate requires repository-wide provenance.
- **R-37:** `DESIGN.md` is owner-managed in another worktree. Read the latest version before further visual/token work; current source tokens should not silently override the owner's direction.

Integration warning: the main worktree contains uncommitted user changes in `src/api/moments.ts`, `src/api/supabase.ts`, `src/app/(tabs)/profile.tsx`, `src/app/camera.tsx`, `src/store/sessionStore.ts`, `tests/remediation.test.ts`, and generated/untracked files. Preserve those changes while applying the UI update; do not reset or overwrite them.
