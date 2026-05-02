# Phoenix Portal — UX/UI Audit Plan

**Branch:** `feat/ux-ui-audit-2026-05-01`
**Audit date:** 2026-05-01
**Scope:** All UX/UI findings affecting `phoenix-portal` only. Cross-cutting items requiring coordinated changes in `Project-Phoenix-MP` are in `PARITY-COORDINATION.md` (read alongside this plan).
**Read-only audit deliverable.** No production source modified by the audit itself; this plan is the input to implementation.

---

## 0. Executive summary (portal-focused)

Portal is the more visually-disciplined of the two Phoenix surfaces — the `theme.css` design system (Chakra Petch + Inter + JetBrains Mono on `#06060A`, signal-pulse, hairline radii, `prefers-reduced-motion` handled at two layers, 44px touch targets on coarse pointers) is deliberately well-built. The audit found portal **passing every measured WCAG AA contrast test on dark mode at the public landing surface (lowest 6.79:1)** and respecting reduced-motion correctly.

The damage is concentrated in **four areas**:

1. **Doc rot in user-visible billing copy** — FAQ describes a 2-tier product when the actual product is 4-tier; Profile shows `undefined` for FLAME subscribers (the most popular paid tier); Goals upsells fictional "Phoenix and Elite" tiers. These are 30-minute fixes that are bleeding paid-user trust right now.
2. **Routing UX is broken for unauthenticated users** — Every protected-route deep-link (`/dashboard`, `/analytics`, etc.) and every truly-404 path silently redirects to the landing page with the URL rewritten. 13 of 18 audited authenticated surfaces silently rendered as the landing page during a Playwright walkthrough — bookmarks break, link-shares are unactionable, the `NotFound` component literally exists but is unreachable for the audience that needs it most.
3. **75 `useQuery` calls × only 4 handle `isError`** — combined with `retry: 1` and `refetchOnWindowFocus: false` defaults, transient failures park indefinitely as empty state ("No workouts yet"). Users perceive *data loss* when there is none.
4. **One a11y CRITICAL: `BottomSheet.tsx` is not an accessible modal** — no `role="dialog"`, no focus trap, no ESC, no return-focus, drag-only snap-points. Keyboard + screen-reader users can't use it.

Plus a maintenance bomb: **~30 components hardcode `#FF6B35`/`#DC2626`/`#F59E0B` literals** (notably inside Framer Motion `animate.filter` keyframes on Dashboard) — defeats `theme.css` tokens. Future palette changes require a 30-file find-replace.

**Estimated effort for the portal CRITICAL backlog (Section 2):** ≈ **6-9 dev days**. Wave 1 (copy fixes) ships day 1; full routing redesign is the largest single-PR item at ~1 day.

---

## 1. Audit yield (portal)

| Source file | Findings | C / H / M / P |
|---|---|---|
| `findings/02-portal-static.md` | 22 | 4 / 8 / 7 / 3 |
| `findings/05-portal-live.md` | 15 | 1 / 5 / 7 / 2 |
| `findings/04-a11y-parity.md` (portal-relevant rows) | ~10 | 1 / 4 / 4 / 1 |
| `findings/03-visual-brand.md` (portal-relevant rows) | ~6 | 0 / 3 / 2 / 1 |
| **Portal-affecting unique (after dedup with mobile)** | **~50** | **6 / 18 / 18 / 8** |

Counts include parity items where the *portal-side* fix is required. Mobile-side fixes for the same parity items are tracked in `Project-Phoenix-MP/audit/PLAN.md`.

---

## 2. Top fix-first list (portal)

Each row links back to the source agent's finding ID. **Effort estimates are dev-only.**

| # | Severity | Title | Effort | Source | Notes |
|---|---|---|---|---|---|
| P-1 | CRITICAL | **Profile renders `undefined` for FLAME subscribers** (`PLAN_LABELS` missing FLAME entry) | ≤30 min | `02-F-002` | `Profile.tsx:73-77`. Pull labels from `TIER_PRICING` |
| P-2 | CRITICAL | **Goals upsell references fictional "Phoenix and Elite" tiers** | ≤30 min | `02-F-003` | `Goals.tsx:357`. Verify gate logic vs `maxGoals` math |
| P-3 | CRITICAL | **FAQ pricing copy contradicts product** (lists 2 tiers; actual is FREE / EMBER $5 / FLAME $15 / INFERNO $25) | ≤2 hr | `02-F-001` | `FAQ.tsx:73-85`. Regenerate from `lib/pricing.ts` + add vitest assertion |
| P-4 | CRITICAL | **Velocity zone palette flip + dead-code deletion** (3 contradictory portal palettes; adopt mobile canonical) | ≤1 hr | `04-F-001` | **PARITY** — see `PARITY-COORDINATION.md §1`. Update `lib/vbt.ts:SIMPLIFIED_ZONES`, delete `lib/colors.ts:VELOCITY_ZONES` |
| P-5 | CRITICAL | **Unauth 404 + protected-route silent landing-redirect** (broken deep-linking, lost destination URL on auth) | ~1 day | `05-F-001` + `05-F-002` | **Mockup ready: `mockups/M-03-portal-protected-route-ux.md`** (537 lines, 4 surfaces specified) |
| P-6 | CRITICAL | **`BottomSheet.tsx` not an accessible modal** (no `role`, no focus trap, no ESC, no return-focus) | ≥1 day | `04-F-002` | Replace with Radix `<Dialog>` for a11y plumbing; preserve `motion.div` for snap animation. Also fixes `04-F-014` (drag has no keyboard equiv) |
| P-7 | CRITICAL | **75 useQuery, 4 isError → silent failures look like empty state** (semantic data-loss illusion across Profile, Recovery, Analytics, Leaderboard, Integrations, WorkoutHistory) | ≥1 day | `02-F-004` + `02-F-012` | Build `<QueryStateBoundary loading error empty />`. Set `throwOnError: true` on protected routes. Subscribe `queryClient.getQueryCache()` for global error toasts. Migrate 30 consumers (incremental) |
| P-8 | HIGH | **Per-cable weight disclosure missing on portal** (silent ×2 multiplication; user plans at "200 kg" expecting per-cable, machine maxes at 110 kg/cable) | ≤2 hr | `04-F-004` | **PARITY** — see `PARITY-COORDINATION.md §3`. Add tooltip + dual-display pattern |
| P-9 | HIGH | **Asymmetry threshold has 3 values in code** (canonical = 2% per `CLAUDE.md`) | ≤2 hr | `04-F-005` | **PARITY** — see `PARITY-COORDINATION.md §4`. Export shared constant in `lib/biomechanics.ts` |
| P-10 | HIGH | **`--destructive-foreground #FFF` on `--destructive #ff5252` = 3.19:1 (FAILS AA Normal)** | ≤30 min | `04-F-006` | `theme.css:42-43`. Darken `--destructive` to `#dc2626` (4.83:1) or change foreground to `#06060a` |
| P-11 | HIGH | **~30 components hardcode `#FF6B35`/`#DC2626`/`#F59E0B`** (defeats theme tokens; Framer Motion drop-shadow keyframes are worst) | ≥1 day | `02-F-006` | Add Biome rule banning literal hex outside `lib/colors.ts` and `charts/shared/`. Build `getThemeColor()` helper for Framer Motion sites |
| P-12 | HIGH | **FREE-tier dead-end first-paint** (`/dashboard` is `SubscribedRoute requiredTier="EMBER"`, fresh user lands directly on paywall) | ~1 day | `02-F-007` | **Covered by Mockup M-03 Surface 4.** Build FREE-tier dashboard, move SubscriptionGate inside pages, AppSidebar gets lock-icon overlays |
| P-13 | HIGH | **No mobile→portal sync confirmation** (silent invalidation; users can't tell when fresh data arrived) | ≤2 hr | `02-F-005` | Add throttled toast on `sync_complete` broadcast; "Last sync: 12s ago" in AppSidebar header |
| P-14 | HIGH | **Mobile top-nav drops Features/Pricing/Support at ≤900px** (no hamburger, pricing discoverability collapses) | ~3 hr | `05-F-003` | Add hamburger Sheet with focus trap |
| P-15 | HIGH | **Auth dialog inputs missing `autocomplete`, `required`, `aria-label`** (password manager + screen reader broken) | ≤1 hr | `05-F-004` | `AuthDialog.tsx`. Add `autocomplete="email"` + `current-password`/`new-password`, `required`, `aria-label` |
| P-16 | HIGH | **Two inconsistent focus indicators on landing** (1px-50%-alpha outline on top-nav vs 3px ring on hero CTAs) | ≤1 hr | `05-F-005` | Standardize on 3px ring globally |
| P-17 | HIGH | **Footer links Ko-fi (20px) + Features (22px) FAIL WCAG 2.5.8 (24×24)** | ≤1 hr | `05-F-006` | Add `py-2.5` minimum; `min-h-[24px]` on link targets |
| P-18 | HIGH | **ResetPassword brands as "Project Phoenix"** (rest of portal uses "Phoenix Portal") | ≤30 min | `02-F-009` + `05-F-009` | Standardize `<PageHeader brand="Phoenix Portal" />` |
| P-19 | HIGH | **Goals descriptions hardcode "kg"** (ignores user `weight_unit = lbs` preference) | ≤2 hr | `02-F-010` | Pipe `formatVolume(value, unit)` from `profileOptions` into `getGoalDescription`/`getProgressText` |
| P-20 | HIGH | **PortalBanner non-persistent dismissal** (re-shows every page load) | ≤1 hr | `02-F-011` | Persist via `localStorage` or onboarding row mirroring `dismissed_hints` |

**P-1 → P-7 = the immediate-attention block (CRITICAL).**
**P-8 → P-20 = the next-sprint block (HIGH).**
**Remaining MEDIUM/POLISH = Section 3 catalog.**

---

## 3. Severity-ranked findings catalog (portal-only)

> Format: ID — title — finding-source. Full text in `findings/`.

### CRITICAL (6)

| ID | Title | Source |
|---|---|---|
| P-C1 | Profile `undefined` plan label for FLAME | `02-F-002` |
| P-C2 | Goals fictional tier upsell ("Phoenix and Elite") | `02-F-003` |
| P-C3 | FAQ pricing copy 2-tier vs actual 4-tier | `02-F-001` |
| P-C4 | Velocity-zone palette divergent (3 contradictory tables, neither matches mobile) | `04-F-001` (PARITY) |
| P-C5 | Unauth 404 + protected-route → silent landing redirect | `05-F-001` + `05-F-002` |
| P-C6 | `BottomSheet.tsx` not an accessible modal | `04-F-002` |
| P-C7 | 75 useQuery silent-failure pattern (`react-error-boundary` doesn't catch query errors) | `02-F-004` + `02-F-012` |

(7 listed; P-C7 is a pattern affecting 30+ files.)

### HIGH (≈ 18)

| ID | Title | Source |
|---|---|---|
| P-H1 | Per-cable weight ×2 multiplication undisclosed | `04-F-004` (PARITY) |
| P-H2 | Asymmetry threshold has 3 values (canonical 2%) | `04-F-005` (PARITY) |
| P-H3 | `--destructive-foreground` AA fail (3.19:1) | `04-F-006` |
| P-H4 | ~30 components hardcode primary hex | `02-F-006` |
| P-H5 | FREE-tier dashboard dead-end | `02-F-007` |
| P-H6 | No mobile→portal sync confirmation | `02-F-005` |
| P-H7 | Mobile top-nav drops items at ≤900px (no hamburger) | `05-F-003` |
| P-H8 | Auth dialog inputs missing autocomplete/required/aria | `05-F-004` |
| P-H9 | Two inconsistent focus indicators on landing | `05-F-005` |
| P-H10 | Footer links < 24×24 (WCAG 2.5.8 fail) | `05-F-006` |
| P-H11 | ResetPassword brand mismatch | `02-F-009` + `05-F-009` |
| P-H12 | Goals descriptions hardcode "kg" | `02-F-010` |
| P-H13 | PortalBanner non-persistent dismiss | `02-F-011` |
| P-H14 | Inconsistent loading affordances (4+ visual styles) | `02-F-008` |
| P-H15 | RPG attributes surface missing on portal | `04-F-007` (PARITY) |
| P-H16 | Badges grid missing locked/secret/category on portal | `04-F-007` (PARITY) |
| P-H17 | Portal lacks SYSTEM theme toggle (mobile has but unreachable) | `04-F-010` (PARITY) |
| P-H18 | Cable A/B color identity diverges (portal canonical, mobile inverted) | `03-F-001` (PARITY — mobile flips) |
| P-H19 | Inconsistent destructive-action confirmations (DeleteConfirmDialog vs inline AlertDialog vs **none on Goals archive**) | `02-F-013` |

### MEDIUM (≈ 18 — see findings files for full text)

Highlights: Sentry consent banner unequal Reject/Accept (GDPR risk) [`05-F-007`]; eyebrow text 11px [`05-F-008`]; Inferno tier "Coming Soon" with disabled-button affordance [`05-F-010`]; auth dialog tab indicator subtle [`05-F-011`]; FAQ accordion weak hover/focus [`05-F-012`]; Framer Motion `whileInView` keeps below-fold sections opacity:0 (Lighthouse / OG-image impact) [`05-F-013`]; OnboardingOverlay → paywall bait-and-switch [`02-F-014`]; mobile-bottom-nav buries 7/11 [`02-F-015`]; PageShell width inconsistent (max-w-7xl/5xl/4xl) [`02-F-016`]; Dashboard streak progress math misleading [`02-F-017`]; FormAnalysis hardcodes `#10B981`/`#F59E0B`/`#EF4444` instead of `--signal-*` [`02-F-018`]; Subscription tier badge not surfaced in main shell [`02-F-022`]; `--disabled-foreground` 2.98:1 [`04-F-011`]; `--sidebar-group-label` 2.32:1 [`04-F-012`]; BottomSheet drag has no keyboard equiv [`04-F-014`]; portal English-hardcoded zone labels (multi-locale parity risk) [`04-F-017`]; PR phases not surfaced on portal [`04-F-007`]; empty-state tone differs from mobile [`04-F-019`].

### POLISH (≈ 8)

CookieConsentBanner z-index collision risk [`02-F-019`]; AppSidebar collapsed hides streak with no tooltip [`02-F-020`]; WhatsNewBanner X-button overdoes 44px on desktop [`02-F-021`]; Forgot password link orphaned [`05-F-014`]; AI-POWERED pill too small [`05-F-015`]; AMRAP indicator text-only [`04-F-018`]; iconography divergence Lucide vs Material [`03-F-019`]; portal has scan-line/grain texture mobile lacks [`03-F-020` — mobile-side fix].

---

## 4. Cross-cutting items (require mobile coordination)

See `PARITY-COORDINATION.md` for full coordination protocol. Summary table:

| # | Item | Portal action | Mobile action | Sequence |
|---|------|---------------|---------------|----------|
| §1 | Velocity-zone palette | **Flip portal `lib/vbt.ts:SIMPLIFIED_ZONES`** to mobile-canonical mapping; delete dead `lib/colors.ts:VELOCITY_ZONES` | Reference (no mobile change — portal converges to mobile) | Portal first; mobile is reference |
| §2 | Cable A/B color identity | Reference (no portal change — mobile converges to portal) | **Flip mobile `DataColors.LoadA/B/PositionA/B`** | Mobile first; portal is reference |
| §3 | Per-cable weight | **Add disclosure tooltip + dual-display on weight surfaces** | Keep existing (already explained on `WeightStepper`) | Portal-only change |
| §4 | Asymmetry threshold | **Use canonical 2% in `lib/biomechanics.ts`**; remove inline `<= 2` and `=10` flag-line | **Update `BalanceBar` classification** to `<2 = good, 2-10 = caution, >10 = bad` | Coordinated single PR per repo, ship together |
| §5 | Theme toggle (Light/Dark/System tri-mode) | **Add toggle to AppLayout** | **Convert `ThemeToggle.kt` to 3-state cycle** | Independent per repo |
| §6 | RPG attributes surface | **Build `<RpgAttributeCard>` portal component**, place on Profile/Dashboard | Reference (data already synced via `rpg_attributes`) | Portal-only |
| §7 | Badges grid | **Build `<BadgesGrid>` with locked/secret/category like mobile** | Reference | Portal-only |
| §8 | ConsistencyCalendar | Reference | **Build `ConsistencyCalendar.kt` Composable** mirroring portal | Mobile-only |
| §9 | Brand palette unification (Ember `#FF6B35`, surface scale, radii, typography) | Canonical | Mobile adopts | Mobile-side, multi-PR |

---

## 5. Recommended sequencing (portal)

| Wave | Days | Items |
|------|------|-------|
| **W1 — Stop the bleeding** | ~1 day | P-1, P-2, P-3, P-4, P-10, P-18, P-H4 partial. Pure copy/lookup-table/palette/contrast fixes. 1 PR per item or 1 squashed PR |
| **W2 — A11y + a single auth-required redesign** | 3-5 days | P-5 (mockup M-03 implementation), P-6 (BottomSheet a11y), P-15 (auth inputs), P-16 (focus indicators), P-17 (footer targets) |
| **W3 — State coverage + brand discipline** | 1-2 weeks | P-7 (`<QueryStateBoundary>` + 30-file migration), P-11 (Biome rule for hex literals), P-13 (sync feedback toast), P-14 (mobile hamburger) |
| **W4 — Parity coordination + missing surfaces** | 2-3 weeks | P-12 (FREE-tier dashboard, M-03 Surface 4), P-H15 (RpgAttributeCard), P-H16 (BadgesGrid), per-cable disclosure (P-8), asymmetry alignment (P-9) |
| **W5 — Polish backlog** | rolling | All MEDIUM + POLISH from §3, addressed during regular maintenance |

---

## 6. Mockup index

| Mockup | Covers | File | Lines |
|---|---|---|---|
| **M-03** | Portal protected-route + 404 + AuthRequired + TierLocked + FREE-tier dashboard + AppSidebar lock affordances | `mockups/M-03-portal-protected-route-ux.md` | 537 |

(Mobile mockups M-01 + M-02 are in `Project-Phoenix-MP/audit/mockups/` — no portal-side equivalent needed.)

---

## 7. Acceptance criteria (definition-of-done for the audit response)

The audit response is "complete" when:
- [ ] All CRITICAL items P-1 through P-7 are merged.
- [ ] All HIGH items P-8 through P-20 are either merged or have a tracked ticket with an owner.
- [ ] `Biome` rule banning literal hex outside `lib/colors.ts` is in effect (CI-enforced).
- [ ] `<QueryStateBoundary>` is shipped and at least 10 of the 30 silent-failure consumers are migrated; remainder tracked.
- [ ] Cross-cutting items §1-§4 are coordinated with mobile per `PARITY-COORDINATION.md`.
- [ ] Doc-rot in CLAUDE.md / FAQ / Goals / Profile is fixed (zero stale tier/animation references).
- [ ] Re-runnable Playwright walkthrough scripts (`audit/scripts/portal-walkthrough.mjs`) pass without finding new CRITICAL regressions.

---

## 8. Resources

- **`README.md`** — folder structure overview
- **`PARITY-COORDINATION.md`** — cross-cutting items + mobile coordination
- **`findings/02-portal-static.md`** — 22 findings, full text, code locations
- **`findings/05-portal-live.md`** — 15 findings + 56 captured screenshots + Playwright walkthrough scripts
- **`findings/03-visual-brand.md`** — palette/typography/spacing parity (cross-platform context)
- **`findings/04-a11y-parity.md`** — WCAG ratios + 20-row parity matrix (cross-platform context)
- **`mockups/M-03-portal-protected-route-ux.md`** — 537-line redesign mockup for routing + paywall UX
- **`screenshots/`** — 56 PNGs + 3 JSON probe files
- **`scripts/portal-walkthrough.mjs`**, **`portal-rescan.mjs`** — re-runnable Playwright walkthrough scripts

---

## 9. Out of scope (not addressed by this audit)

- Sync/backend/Edge Functions logic
- Performance benchmarking (jank, LCP, CLS — only perceived loading-state UX is in scope)
- Test coverage gaps
- iOS-specific portal rendering (this is a web app — out of context)
- Authenticated-walkthrough verification of the 13 redirected surfaces — needs follow-up walkthrough with credentials (recommended after P-5 ships)
- Brand voice / copy tone consistency (no brand voice doc available)
- Competitive analysis vs Strong / Hevy / Liftosaur

---

**End of plan.** This document is the definitive scope for the portal UX/UI audit response. All claims trace back to `findings/` and `screenshots/` for verification.
