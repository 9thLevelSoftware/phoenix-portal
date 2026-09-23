## [Unreleased]

### Added

- Phoenix dark/light theme with ThemeProvider persisting user choice (Sprint 1).
- Design tokens: typography scale, spacing scale, soft-state backgrounds, text-on-brand foregrounds (Sprints 1+2).
- Card variants (default/elevated/inset/stat) with padding presets (Sprint 2).
- Centralized motion recipes (fadeUp/fadeUpVariants/staggerContainer/hover/tap) (Sprint 3).
- Axe-compliant accessibility across authenticated pages; keyboard nav + reduced-motion + form-label sweeps (Sprint 5).
- Mobile bottom-nav parity, empty states with primary CTAs, error fallback with error-id copy, form error summaries (Sprint 4).
- 44px minimum touch targets on mobile (Sprint 4).

### Changed

- Tailwind theme structured with dark+light blocks; inline hex colors eliminated from components (Sprint 1).
- Route transitions keyed by location pathname (Motion stability) (Sprint 3).
- Skeleton loading states unified across pages (Sprint 4).
- PageShell uses page-stack utility for consistent route rhythm (Sprint 2).

### Fixed

- Boot script validates persisted phoenix-theme value (no data-theme flash) (Sprint 1).
- Single aria-current on settings route (no double-active navlink) (Sprint 4).

### Developer experience

- `.gitignore` patterns block sync-conflict duplicate artifacts (`* 2.tsx` etc.) (Sprint 4).
- `guidelines/Guidelines.md` now documents the real design system for contributors (Sprint 6).
