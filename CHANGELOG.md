## [Unreleased]

### Added

- Light theme alongside the default dark one: `ThemeProvider` (dark / light / system), a theme toggle in the desktop sidebar and the mobile More drawer, and `public/theme-boot.js` to apply the stored theme before first paint.
- Design tokens: typography scale, spacing scale, soft-state backgrounds, `text-on-*` foregrounds, chart colours 1–8, podium colours, and per-theme elevation and scrollbar colours.
- Card variants (default/elevated/inset/stat) with padding presets.
- Centralized motion recipes (`fadeUp`, `fadeUpVariants`, `staggerContainer`, `hover`, `tap`).
- Empty states with next-step CTAs on list pages, and an error fallback that shows and copies an error id (Sentry's event id when Sentry is on).
- Form error summaries in the routine and cycle builders, with the invalid field marked `aria-invalid`.
- Accessibility coverage: axe in both themes on 15 pages, keyboard (Tab order, focus-visible, Ctrl/Cmd+B), reduced motion, and 44×44px mobile touch targets.

### Changed

- Colours come from theme tokens instead of inline hex and Tailwind palette classes. Brand marks, mobile-synced profile colours, fixed danger buttons and print styles are the documented exceptions.
- Desktop sidebar groups Train (collapsible) / Explore / Account, shows name, tier and streak, and marks exactly one link `aria-current`. The mobile bar is Dashboard, Workouts, Routines, Analytics and More; the drawer holds every other page.
- Profile opens the tab named in `?tab=` (the sidebar's Settings link).
- Skeleton loading states unified across pages; PageShell uses the `page-stack` rhythm.
- One app-wide toaster, so sign-in, sign-up and password-reset messages show.
- Leaderboard shows "Rankings unavailable" with a retry when rankings fail to load, instead of an empty board.

### Fixed

- Production bundle failed at boot because of a `vendor-ui` ↔ `vendor-react` circular chunk; the build now fails on any circular chunk.
- Collapsing the desktop sidebar (button or Ctrl/Cmd+B) crashed the app, and below 1280px the sidebar could not be expanded (both pre-existing).
- React root errors were dropped until reload when cookie consent was given mid-session, and swallowed entirely without consent.
- Mobile sync pull: a page exactly filled by one entity type ended the sync and skipped later entity types.
- Tier/pricing styles referenced non-existent CSS variables and rendered without colour.

### Developer experience

- `.gitignore` patterns block sync-conflict duplicate artifacts (`* 2.tsx` etc.).
- `guidelines/Guidelines.md` documents the design system, including the colour exceptions and theming rules.
