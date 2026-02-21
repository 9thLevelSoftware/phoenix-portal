# Phase 14: CSS Foundation & Typography - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish Inter Variable font with correct weight hierarchy across the entire app; add ambient ember/flame radial gradient glows to the body background; apply a subtle noise texture overlay; define and verify CSS surface tokens (shadows, borders) so all subsequent phases can reference them. This is the visual foundation layer — no card hierarchy, no glassmorphism, no animations (those are Phases 16-17).

</domain>

<decisions>
## Implementation Decisions

### Typography character
- Bold, confident type hierarchy — this is a fitness app, it should feel authoritative, not delicate
- Page titles: Inter Variable weight 700 — commanding presence
- Section headers: weight 625 (non-standard) — premium intermediate step
- Card titles: weight 500 — medium, clean, readable
- Body text: weight 400 — standard comfortable reading
- Eyebrow/stat labels: weight 450 uppercase, letter-spacing 0.08em, smaller font size — distinctive "label" treatment
- The non-standard weights (450/625) are the premium touch — they create contrast you can feel but can't easily name
- Remove all hardcoded `fontFamily: "system-ui"` and dead CSS variables — clean slate

### Ambient glow intensity
- Cinematic but restrained — visible when you notice it, never competing with content
- Ember orange glow (#FF6B35 at ~8% opacity) anchored top-left, large radius (40-50% of viewport)
- Flame red glow (#DC2626 at ~6% opacity) anchored bottom-right, similar radius
- Static positioning — no movement or pulse (animation belongs to Phase 17)
- Applied to all dashboard/authenticated pages for consistency — not just the landing page
- The goal: when a user glances at the background, it feels warm and alive, not flat black

### Grain & texture feel
- Nearly invisible depth layer — felt more than seen
- Neutral-warm tone to complement the ember palette
- Very low opacity (2-3%) — just enough to break the digital flatness
- Applied via `::after` pseudo-element on body as the requirements specify
- Should disappear at a glance but add subtle richness on sustained viewing

### Card surface primitives
- This phase sets the baseline — Phase 16 will differentiate into hero/primary/secondary
- Default card border: `rgba(255,255,255,0.06)` — barely visible separator, replacing the heavier `border-secondary` (#374151)
- Shadow tokens (`--shadow-sm`, `--shadow-md`, `--shadow-lg`) defined with warm-tinted shadows (slight ember undertone, not pure black)
- Default cards get `--shadow-sm` applied — subtle but present elevation
- `--surface-1` through `--surface-3` tokens defined for layered background colors
- `bg-[#0D0D0D]` hardcoded values replaced with `bg-background` token (BUG-08)
- All tokens verifiable in Chrome DevTools `:root` panel — zero undefined vars

### Claude's Discretion
- Exact pixel values for font sizes at each hierarchy level
- Specific gradient spread and blur values for ambient glows
- Noise texture generation method (PNG vs SVG vs CSS)
- CSS variable naming conventions and organization
- Font loading strategy (preload, font-display swap, etc.)
- Exact shadow color values and spread for warm-tinted shadows

</decisions>

<specifics>
## Specific Ideas

- The ember/flame palette is already defined in `src/styles/theme.css` — build on it, don't duplicate
- Inter Variable supports continuous weight axis — use this for the non-standard 450/625 weights rather than loading separate font files
- The background should evoke "glowing embers in darkness" — warm spots of light in deep black
- Card shadows should have a warm undertone to feel cohesive with the ember glow, not cold/grey
- User gave full creative discretion: "Make this site look amazing"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-css-foundation-typography*
*Context gathered: 2026-02-20*
