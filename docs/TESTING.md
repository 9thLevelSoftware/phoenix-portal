# Testing

## Local Commands

```bash
npm run lint
npm run check:harness
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Use `npm run verify` for broad or cross-cutting changes.

## Unit And Integration

Vitest runs with jsdom and Testing Library. Tests live next to source under
`src/**/__tests__/`, as sibling `*.test.ts` files, and under `tests/`.

## Sync Contract Tests

Mobile sync coverage lives in `tests/sync/`.

```bash
npm run test:sync       # mocked Edge Functions
npm run test:sync:live  # live Supabase, requires secrets
```

Mock mode is the default for CI and local runs. Live mode should be used for
release confidence or Supabase behavior changes.

## E2E

Playwright tests live in `e2e/` and boot an isolated dev server on port `45173`.
Run E2E after route, auth, pricing, navigation, onboarding, realtime, or
accessibility changes.

## CI

GitHub Actions run lint, typecheck, unit tests, E2E, production build,
repository standards, sync tests, and migration checks. CI should call package
scripts rather than duplicating command details.
