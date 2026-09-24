# Phoenix Portal Design System Guidelines

## Core principle

Use design tokens from `src/styles/theme.css` only. Never inline hex colors, raw spacing values, or radii in components. Extend the token source before introducing a new visual value.

## Tokens (quick reference)

- **Color:** `--background`, `--foreground`, `--card`, `--primary`, `--success`, `--warning`, `--destructive`, `--border`, and `--sidebar-*`. Dark and light variants are defined in `:root` and `:root[data-theme='light']`.
- **Text on a filled colour:** use the matching foreground (`text-primary-foreground`, `text-accent-foreground`, `text-success-foreground`, `text-on-danger`, …), never `text-white` or `text-foreground` on `bg-primary` and friends.
- **Charts:** `--chart-1` … `--chart-8`, all at least 3:1 on the page background in both themes. Use a new slot rather than repeating a colour inside one chart.
- **Podium:** `--rank-gold`, `--rank-silver`, `--rank-bronze`.
- **Typography:** `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-body`, `text-small`, and `text-micro`, applied through Tailwind utilities.
- **Spacing:** `--space-1` through `--space-12` for page-level rhythm. Prefer Tailwind built-ins inside components.
- **Radii:** `--radius`, `--radius-sm`, `--radius-md`, and `--radius-lg`.
- **Shadows:** the `shadow-sm|md|lg` utilities, backed by the per-theme `--elevation-sm|md|lg` values.

## Anti-slop rules (hard constraints)

1. No hex colors, and no raw Tailwind palette classes (`text-amber-400`, `bg-zinc-800`, …), outside `src/styles/theme.css`, `src/lib/theme-tokens.ts`, tests and `src/lib/database.types.ts`. The only exceptions are values that must not follow the theme, each with a comment saying why: third-party brand marks (the Google/Apple sign-in buttons), synced data that must match the mobile app (`LocalProfileFilter` profile colours), fixed danger buttons (`bg-red-600` with white text), print-only styles, the muscle heatmap legend (it must match the heatmap's own scale), the Strong import brand purple, and decorative effects that animate colour strings (`EmberParticles`, the Challenges swipe hint, the replay annotation overlay).
2. No `!important` outside `@media print`.
3. No `rounded-*` doubling on a parent and child for the same edge.
4. No `bg-gradient-*` combined with `shadow-*` on the same element.
5. Do not add new animations of `width`, `height`, `top`, `left`, `margin`, or `padding`; animate opacity and transform. The existing shadcn sidebar collapse (width) and the few custom outliers in `docs/motion/audit-2026-09-22.md` are the documented exceptions. The reduced-motion stylesheet collapses every duration for users who ask for it.
6. Do not place a card inside another card without a border or a meaningful surface-level shift.
7. Do not add z-index values. Use `z-0`, `z-10`, `z-20`, `z-50`, or sidebar `z-[10]`.
8. Do not add third-party dependencies without explicit plan approval.

## Component usage

- **Cards:** use `<Card variant="default|elevated|inset|stat">` with `padding="none|sm|md|lg"`. The default variant has no padding; preserve headered-card layouts.
- **Buttons:** use `<Button variant="default|secondary|outline|ghost|link|destructive|success">`. There is no `cta` variant; use `default`.
- **Empty states:** use `<EmptyState>` from `ui/empty-state` with a verb-led title, concrete next step, and a Button CTA.
- **Skeletons:** use `<Skeleton>` from `ui/skeleton` and match the final layout's grid and shape.
- **Forms:** wrap fields in `<Form>` and show validation through `<FormErrorSummary>` at the top. Mark each invalid field `aria-invalid` so "jump to first error" has a target. Server failures are a toast with a generic message, never raw error text in the summary.
- **Error vs empty:** a failed query gets an error state with a retry, never the empty state. Empty-state CTAs must lead somewhere else: not the current page, and never "start a workout" (workouts are recorded on the mobile app).
- **Touch targets:** keep interactive elements at least 44×44px on mobile.
- **Tooltips in the sidebar:** icon-mode menu buttons use a native `title` (they already have an accessible name). Wrapping an `asChild` router link in a Radix `Tooltip` loops under React 19 with the pinned Radix compose-refs and crashed the app on collapse.

## Motion

- Reduced motion is respected by `MotionConfig reducedMotion="user"` in `App.tsx` (all routes) and `AppLayout`.
- Use centralized recipes from `src/lib/animations.ts`: `fadeUp`, `fadeUpVariants`, `staggerContainer`, `hover`, and `tap`. `fadeUp` is spread into props (`{...fadeUp}`); inside a `staggerContainer` use `variants={fadeUpVariants}`, because `fadeUp` has no `hidden`/`visible` keys.
- Avoid inline `transition={{ duration: N }}`. First check whether a centralized recipe covers the interaction.
- Keep transitions purposeful: communicate hierarchy, state change, or continuity; never add motion decoratively.

## Theming

- Support both light and dark themes through `:root[data-theme='light']` and the default token block.
- `ThemeProvider` persists the choice in localStorage under `phoenix-theme` and synchronizes `dataset.theme` on `<html>`. `public/theme-boot.js` applies it before first paint (an external file, not inline, so it passes the CSP).
- `ThemeToggle` lives in the expanded desktop sidebar footer and in the mobile "More" drawer. The system preference is respected when `theme="system"`.
- Canvas and ECharts code reads colours through `getThemeTokens()` / `useThemeTokens()` (cached; invalidated by `ThemeProvider` on a switch). Put the tokens in the dependencies of any memo or effect that draws with them. DOM and SVG styles can use `var(--token)` directly, and `withAlpha()` adds transparency to any colour, `var()` included; never append hex digits to a colour string.
- Do not hardcode theme-dependent colors. Use semantic tokens rather than direct `var(--phoenix-*)` values for surfaces.

## Form labels

Every `<input>`, `<textarea>`, and `<select>` must have a visible `<Label htmlFor={id}>` whose `htmlFor` matches the input `id`. An `aria-label` alone is not sufficient for visible labeling.

## When adding a new pattern

1. Check whether an existing primitive covers it: `Card`, `Button`, `EmptyState`, `Skeleton`, or `Form`.
2. If one does, use it through its existing props and variants.
3. If none does, extend the primitive with a cva variant; never create a parallel component for the same concern.
4. Add a focused test for the new behavior or variant.
5. Update this file so the next contributor can reuse the pattern.
