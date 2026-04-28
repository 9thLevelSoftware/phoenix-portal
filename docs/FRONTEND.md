# Frontend

Phoenix Portal is a Vite 7, React 19, TypeScript, Tailwind v4, shadcn/ui, and
Radix application.

## UI Structure

- Routes and app shell live in `src/app/routes/`.
- Feature pages and components live in `src/app/components/`.
- Shared UI primitives live in `src/app/components/ui/`.
- App-local hooks live in `src/app/hooks/`; shared runtime hooks live in
  `src/hooks/`.

## State

- Use TanStack Query for server state through `src/queries/` and
  `src/mutations/`.
- Use Zustand stores in `src/stores/` for client-only state.
- Keep auth access through `useAuth` and subscription access through
  `useSubscription`.

## Design Rules

- Match the existing dark Phoenix visual system and tokens in
  `src/styles/theme.css`.
- Use shadcn/Radix primitives and existing UI components before adding new
  primitives.
- Build responsive layouts with predictable dimensions, especially for charts,
  navigation, and repeated cards.
- Preserve reduced-motion support when adding animation.
- Avoid duplicating pricing, subscription, or feature-gate constants in UI.

## Validation

Use Playwright for user-visible workflow changes and Vitest with Testing Library
for component behavior. Accessibility regressions should be covered in E2E when
the changed flow is user-facing.
