---
phase: 16-legal-pricing
plan: 01
subsystem: ui
tags: [pricing, privacy-policy, legal, react, single-source-of-truth]

# Dependency graph
requires:
  - phase: 14-security-hardening
    provides: CSP and CORS configuration for production readiness
provides:
  - Shared pricing constants module (src/lib/pricing.ts)
  - Corrected landing page pricing (Phoenix $14.99, Elite $24.99)
  - Privacy Policy with Sentry, OAuth, and biometric disclosures
affects: [pricing, subscriptions, stripe, legal]

# Tech tracking
tech-stack:
  added: []
  patterns: [single-source-of-truth pricing constants]

key-files:
  created:
    - src/lib/pricing.ts
  modified:
    - src/app/components/PricingPlans.tsx
    - src/app/components/LandingPage.tsx
    - src/app/components/PrivacyPolicy.tsx

key-decisions:
  - "Pricing constants use TIER_PRICING array with TierPricing interface exported from src/lib/pricing.ts"
  - "PricingPlans uses TIER_DISPLAY record merged with TIER_PRICING to separate display config from prices"
  - "LandingPage derives pricingTiers via TIER_PRICING.map() with tier-conditional CTA and period text"
  - "Privacy Policy biometric notice uses Biometric-Adjacent Data Notice heading for clarity"

patterns-established:
  - "Single source of truth: All tier prices must import from src/lib/pricing.ts — no hardcoded dollar amounts in components"

requirements-completed: [LEGAL-01, LEGAL-03]

# Metrics
duration: 2m 30s
completed: 2026-02-28
---

# Phase 16 Plan 01: Legal & Pricing Summary

**Shared pricing constants module fixing $9.99/$19.99 drift to $14.99/$24.99, plus Privacy Policy disclosures for Sentry error tracking, OAuth sign-in, and biometric-adjacent data**

## Performance

- **Duration:** 2m 30s
- **Started:** 2026-02-28T02:16:30Z
- **Completed:** 2026-02-28T02:19:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `src/lib/pricing.ts` as single source of truth for all tier pricing (Free/$0, Phoenix/$14.99, Elite/$24.99)
- Fixed pricing discrepancy where LandingPage showed $9.99/$19.99 instead of $14.99/$24.99
- Added three Privacy Policy disclosures: Sentry error monitoring, Google/Apple OAuth data sharing, biometric-adjacent data clarification
- Rephrased "no analytics" to "no marketing analytics" to accurately distinguish from error tracking

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract pricing constants and fix landing page discrepancy** - `a5c695c` (feat)
2. **Task 2: Add Sentry, OAuth, and biometric disclosures to Privacy Policy** - `b971379` (feat)

## Files Created/Modified

- `src/lib/pricing.ts` - Shared pricing constants with TIER_PRICING array and TierPricing interface
- `src/app/components/PricingPlans.tsx` - Refactored to import prices from shared module via TIER_DISPLAY merge
- `src/app/components/LandingPage.tsx` - Replaced hardcoded pricingTiers with TIER_PRICING.map()
- `src/app/components/PrivacyPolicy.tsx` - Added Sentry, OAuth, biometric disclosures; updated summary box; rephrased analytics bullet

## Decisions Made

- **TIER_DISPLAY record pattern:** Separated display-only config (icons, colors, CSS classes) from pricing data using a `Record<SubscriptionTier, TierDisplayConfig>` that merges with TIER_PRICING at build time. This keeps the component's visual configuration colocated while pricing comes from the shared module.
- **LandingPage tier mapping:** Used `TIER_PRICING.map()` with conditional logic for CTA text, period, and highlight based on tier type, keeping the landing page's simpler card structure while sourcing all prices from the shared module.
- **Biometric-adjacent phrasing:** Used "Biometric-Adjacent Data Notice" as a bold heading to clearly distinguish from actual biometric data while maintaining legal transparency.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Pricing is now consistent across the entire app with a single source of truth
- Privacy Policy accurately describes all current data practices
- Ready for Phase 16 Plan 02 (Terms of Service) and Plan 03 (remaining legal pages)

## Self-Check: PASSED

- All 5 files verified present on disk
- Both task commits (a5c695c, b971379) verified in git history

---
*Phase: 16-legal-pricing*
*Completed: 2026-02-28*
