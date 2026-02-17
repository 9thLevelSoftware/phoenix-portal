---
phase: 12-schedule-dependent-features-delivery
plan: 03
subsystem: infra
tags: [pwa, service-worker, vite-plugin-pwa, workbox, offline, web-vitals, sentry]

# Dependency graph
requires:
  - phase: 09-foundation-toolchain
    provides: Vite 7 config, Tailwind v4, Sentry integration
provides:
  - VitePWA plugin with autoUpdate service worker and web manifest
  - PNG icons (192x192, 512x512) for PWA installation
  - OfflineBanner component for network connectivity awareness
  - usePWAInstall hook with beforeinstallprompt capture and workout gating
  - PWAInstallPrompt dismissible banner component
affects: [13-hardening-polish]

# Tech tracking
tech-stack:
  added: [vite-plugin-pwa, workbox]
  patterns: [module-level event listener for beforeinstallprompt, localStorage dismiss persistence]

key-files:
  created:
    - public/pwa-192x192.png
    - public/pwa-512x512.png
    - src/app/components/OfflineBanner.tsx
    - src/app/components/PWAInstallPrompt.tsx
    - src/app/hooks/usePWAInstall.ts
  modified:
    - vite.config.ts
    - tsconfig.app.json
    - src/app/routes/AppLayout.tsx
    - src/app/components/Dashboard.tsx
    - src/app/components/DashboardMobile.tsx

key-decisions:
  - "updateViaCache set to 'none' explicitly (workbox default is 'imports', not 'none') per DLVR-03"
  - "DLVR-04 (web vitals) satisfied by existing Sentry browserTracingIntegration with tracesSampleRate 0.1 in production -- no code changes needed"
  - "Module-level beforeinstallprompt listener captures event before React mounts, surviving component remounts"
  - "PNG icons generated from WebP sources via sharp, not copied from fallback"

patterns-established:
  - "PWA install gating: workoutCount >= minWorkouts AND not dismissed AND prompt available"
  - "Network status detection: navigator.onLine + online/offline event listeners"

requirements-completed: [DLVR-01, DLVR-02, DLVR-03, DLVR-04]

# Metrics
duration: 4min
completed: 2026-02-17
---

# Phase 12 Plan 03: PWA & Delivery Summary

**VitePWA with autoUpdate service worker, offline banner, and workout-gated install prompt**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-17T20:50:23Z
- **Completed:** 2026-02-17T20:54:46Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- App is installable as a PWA with standalone display, dark theme, and proper icons
- Service worker auto-updates silently with updateViaCache: none (DLVR-03)
- Offline banner alerts users when network drops, positioned above all content
- Install prompt appears only for users with 3+ completed workouts, dismissible with localStorage persistence
- Web vitals (LCP, CLS, INP, FCP, TTFB) captured by existing Sentry browserTracingIntegration (DLVR-04 verified)

## Task Commits

Each task was committed atomically:

1. **Task 1: PWA configuration, icons, and service worker setup** - `8665cb5` (feat)
2. **Task 2: Offline banner, install prompt hook, and Dashboard integration** - `edb4e79` (feat)

## Files Created/Modified
- `vite.config.ts` - Added VitePWA plugin with manifest, workbox, and autoUpdate config
- `tsconfig.app.json` - Added vite-plugin-pwa/react types
- `public/pwa-192x192.png` - 192x192 PWA icon converted from WebP via sharp
- `public/pwa-512x512.png` - 512x512 PWA icon (also used as maskable) converted from WebP
- `src/app/components/OfflineBanner.tsx` - Fixed-position banner shown when navigator.onLine is false
- `src/app/hooks/usePWAInstall.ts` - Hook capturing beforeinstallprompt with workout count gating
- `src/app/components/PWAInstallPrompt.tsx` - Dismissible install banner using usePWAInstall
- `src/app/routes/AppLayout.tsx` - Added OfflineBanner at top of layout
- `src/app/components/Dashboard.tsx` - Added PWAInstallPrompt after main content grid
- `src/app/components/DashboardMobile.tsx` - Added PWAInstallPrompt at bottom of content

## Decisions Made
- updateViaCache explicitly set to "none" per DLVR-03 requirement -- workbox default is "imports", not "none"
- DLVR-04 (Sentry web vitals) verified as already satisfied by browserTracingIntegration() with tracesSampleRate 0.1 in production -- no modifications needed
- Module-level beforeinstallprompt listener pattern chosen so the event is captured even before React hydrates
- PNG icons generated from WebP via sharp rather than using the smaller fallback PNG

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing test failures (10 component tests failing due to missing AuthProvider/Router context) were observed but are not caused by this plan's changes. The 2 passing test files (computeNextWorkout, recovery) with 20 passing tests confirm no regressions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- PWA infrastructure complete, app installable from Chrome/Safari
- Service worker caches all static assets for offline-first experience
- Ready for Phase 13 hardening and polish

---
*Phase: 12-schedule-dependent-features-delivery*
*Completed: 2026-02-17*

## Self-Check: PASSED

All 10 files verified present. Both commits (8665cb5, edb4e79) confirmed in git log.
