# Phoenix Portal Design System Guidelines

## Core principle

Use design tokens from `src/styles/theme.css` only. Never inline hex colors, raw spacing values, or radii in components. Extend the token source before introducing a new visual value.

## Tokens (quick reference)

- **Color:** `--background`, `--foreground`, `--card`, `--primary`, `--success`, `--warning`, `--destructive`, `--border`, and `--sidebar-*`. Dark and light variants are defined in `:root` and `:root[data-theme='light']`.
- **Typography:** `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-body`, `text-small`, and `text-micro`, applied through Tailwind utilities.
- **Spacing:** `--space-1` through `--space-12` for page-level rhythm. Prefer Tailwind built-ins inside components.
- **Radii:** `--radius`, `--radius-sm`, `--radius-md`, and `--radius-lg`.
- **Shadows:** `--shadow-sm`, `--shadow-md`, and `--shadow-lg`.

## Anti-slop rules (hard constraints)

1. No hex colors outside `src/styles/theme.css`, `src/lib/theme-tokens.ts`, tests, and `src/lib/database.types.ts`.
2. No `!important` outside `@media print`.
3. No `rounded-*` doubling on a parent and child for the same edge.
4. No `bg-gradient-*` combined with `shadow-*` on the same element.
5. Do not animate `width`, `height`, `top`, `left`, `margin`, or `padding`. Animate opacity and transform only.
6. Do not place a card inside another card without a border or a meaningful surface-level shift.
7. Do not add z-index values. Use `z-0`, `z-10`, `z-20`, `z-50`, or sidebar `z-[10]`.
8. Do not add third-party dependencies without explicit plan approval.

## Component usage

- **Cards:** use `<Card variant="default|elevated|inset|stat">` with `padding="none|sm|md|lg"`. The default variant has no padding; preserve headered-card layouts.
- **Buttons:** use `<Button variant="default|secondary|outline|ghost|link|destructive|success">`. There is no `cta` variant; use `default`.
- **Empty states:** use `<EmptyState>` from `ui/empty-state` with a verb-led title, concrete next step, and a Button CTA.
- **Skeletons:** use `<Skeleton>` from `ui/skeleton` and match the final layout's grid and shape.
- **Forms:** wrap fields in `<Form>` and show validation through `<FormErrorSummary>` at the top.
- **Touch targets:** keep interactive elements at least 44px tall on mobile.

## Motion

- Reduced motion is respected by `MotionConfig reducedMotion="user"` at the `AppLayout` root.
- Use centralized recipes from `src/lib/animations.ts`: `fadeUp`, `fadeUpVariants`, `staggerContainer`, `hover`, and `tap`.
- Avoid inline `transition={{ duration: N }}`. First check whether a centralized recipe covers the interaction.
- Keep transitions purposeful: communicate hierarchy, state change, or continuity; never add motion decoratively.

## Theming

- Support both light and dark themes through `:root[data-theme='light']` and the default token block.
- `ThemeProvider` persists the choice in localStorage under `phoenix-theme` and synchronizes `dataset.theme` on `<html>`.
- `ThemeToggle` in the sidebar is the user-facing theme switcher. The system preference is respected when `theme="system"`.
- Do not hardcode theme-dependent colors. Use semantic tokens rather than direct `var(--phoenix-*)` values for surfaces.

## Form labels

Every `<input>`, `<textarea>`, and `<select>` must have a visible `<Label htmlFor={id}>` whose `htmlFor` matches the input `id`. An `aria-label` alone is not sufficient for visible labeling.

## When adding a new pattern

1. Check whether an existing primitive covers it: `Card`, `Button`, `EmptyState`, `Skeleton`, or `Form`.
2. If one does, use it through its existing props and variants.
3. If none does, extend the primitive with a cva variant; never create a parallel component for the same concern.
4. Add a focused test for the new behavior or variant.
5. Update this file so the next contributor can reuse the pattern.
