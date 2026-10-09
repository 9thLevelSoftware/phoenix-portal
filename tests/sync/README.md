# Sync harness/fixture smoke suite

> **This is not the sync contract suite.** Everything under `tests/sync/`
> (except `tests/sync/live/`) runs against the in-memory mock in
> `helpers/mock-edge-functions.ts`. That mock has one global store keyed by
> entity id: no user scoping, no profile scoping, no LWW, no per-row delta, no
> cursor or pageSize handling, no tombstones, no tier gate, no rate limit, no
> RLS. These tests prove that the **fixtures and the push/pull harness** carry
> a payload of a given shape intact. They cannot prove a single server-side
> sync invariant, whatever an individual case is named.
>
> The mock suite is **not a contract gate**. `npm run test:sync`, and the CI
> job that runs it, do not accept or reject a server invariant. A green run
> means the fixtures and the harness carried a payload intact.
>
> The sync contract is proven by the **Deno handler suites**,
> `supabase/functions/mobile-sync-push/index.test.ts` and
> `supabase/functions/mobile-sync-pull/index.test.ts` (`npm run test:edge`),
> and by the `integration: `-prefixed real-SQL cases in the same files
> (`npm run test:edge:integration`, `.github/workflows/edge-integration.yml`).
> When you need to cover a server behaviour, add it there — not here. Fault
> injection in this directory hits the in-memory harness only; it is not a
> fault-injection gate for the Edge Functions.
>
> Two rules for anything added to this directory:
> 1. No assertion whose subject is a mock behaviour listed above.
> 2. No case whose only assertion is `expect(result.success).toBe(true)`, and
>    no bare `it.skip` (a skip here executes in no mode at all).
>
> See [BASELINE.md](./BASELINE.md) for the list of invariants this suite does
> not prove.

Harness and fixture smoke tests for mobile-to-portal sync payloads, shaped
around the `mobile-sync-push` and `mobile-sync-pull` Edge Function wire
formats.

## Quick Start

```bash
# Mock suite (CI default). Harness and fixture smoke — not a contract gate.
npm run test:sync

# Narrow live smoke only: tests/sync/live/. Dispatch-only in CI.
npm run test:sync:live

# Run specific test file
npm test -- --run tests/sync/round-trip/workout-roundtrip.test.ts
```

## CI labeling (mock vs live)

`npm run test:sync` and the GitHub Actions **Sync Validation Tests (mock)** job
are **mock Edge**. `MOCK_EDGE_FUNCTIONS=true` is the default in `vitest.config.ts`
and on every push/PR. That job is not a live `mobile-sync-push` / `mobile-sync-pull`
run, and it is **not a contract gate**. A green mock job accepts the fixtures
and the harness. It does not accept a server invariant. The contract gate is
the Deno handler suites named in the header.

Live mode (`npm run test:sync:live`, `MOCK_EDGE_FUNCTIONS=false`,
`SYNC_LIVE_TESTS=true`) is a **narrow smoke** and is **workflow_dispatch only**
(`sync-tests.yml` with `use_mocks=false`). The script runs `tests/sync/live/`
and nothing else: `staging-sync.live.test.ts` provisions one disposable user,
pushes one legacy empty payload, pulls it, then round-trips one strict-valid
workout hierarchy. Push and `pull_request` never start it. `liveIt` cases in
other files under `tests/sync/` stay skipped on both commands, because the
live script does not include those files and the mock script never sets
`SYNC_LIVE_TESTS=true`.

`ci.yml` still splits jobs. `npm run verify:full` is the local handoff command;
it is not one CI job. Playwright E2E uses a mocked REST harness — the
DEV `CustomEvent` spec (`e2e/dev-custom-event-cross-tab.spec.ts`) is **not**
Supabase Broadcast proof.

Deno handler tests (`npm run test:edge`) run `mobile-sync-push/index.test.ts`
and `mobile-sync-pull/index.test.ts` against in-process doubles (no live
secrets) in the **Edge Function Deno Check and Handler Tests** job.

## Test Organization

This tree is the full inventory. `CLAUDE.md` → Sync Test Infrastructure →
"Where things live" names a subset (`transforms/`, `round-trip/`,
`multi-device.test.ts`, `hierarchy.test.ts`, `pull-pagination.test.ts`,
`cycle-deletion.test.ts`, `conflicts/`, `batch/`, and
`helpers/mock-edge-functions.ts`) and points here for the rest. When a file
is added or removed, update this tree and that subset together.
`weight-transform.test.ts` is the per-cable loads and the display adapter.

`npm run test:sync` runs this tree against the in-memory mock (the `live/`
file skips itself). `npm run test:sync:live` runs only `live/`. Neither
command is a sync contract gate.

```
tests/sync/
├── setup.ts                         # Env, liveSyncTestsEnabled, tracked-user cleanup
├── setup.cleanup.test.ts            # Tracked test-user cleanup logging
├── README.md                        # This file
├── BASELINE.md                      # Invariants the mock suite does not prove
├── broadcast.test.ts                # In-memory sync_complete capture (harness, not live Broadcast)
├── child-overflow.test.ts           # Mock pull child-page overflow
├── cleanup-sync-preview-users.test.ts  # Preview namespace cleanup script
├── cycle-deletion.test.ts           # deletedCycleIds schema shape (not tombstone propagation)
├── error-classes.test.ts            # Mock wire error signals
├── exercise-catalog.test.ts         # exercise_id through the push schema
├── hierarchy.test.ts                # Nested session hierarchy through the harness
├── multi-device.test.ts             # Multi-device payload shape through the harness
├── paged-by-parent.test.ts          # fetchAllByParentIds helper
├── phases.test.ts                   # WorkoutPhase field through the harness
├── pull-pagination.test.ts          # Response shape; the mock does not page
├── resolve-sync-preview.test.ts     # Preview credential resolver
├── training-cycle-template-id.test.ts  # Migration text; its liveIt is outside the live smoke
├── validation.test.ts               # Mock auth boundaries; cap and rate-limit liveIt stay skipped
├── helpers/
│   ├── edge-function-harness.ts     # Push/pull callers, test user management
│   ├── edge-function-harness.live.test.ts  # Harness doubles; runs in the mock suite
│   ├── mock-broadcast.ts            # In-memory sync_complete capture
│   ├── mock-edge-functions.ts       # In-memory mock (not the server)
│   ├── push-payload-contract.test.ts  # Fixture payloads parse against pushPayloadSchema
│   └── supabase-test-client.ts      # Supabase client configuration
├── fixtures/
│   ├── index.ts                     # Aggregate exports
│   ├── workout-fixtures.ts          # Session, exercise, set, rep factories
│   ├── routine-fixtures.ts          # Routine and exercise factories
│   ├── cycle-fixtures.ts            # Training cycle factories
│   ├── gamification-fixtures.ts     # RPG, badges, stats, PR factories
│   ├── external-fixtures.ts         # Strava/Fitbit/Garmin factories
│   ├── edge-cases.ts                # Boundary and Unicode test data
│   └── fixtures.test.ts             # Fixture validation tests
├── live/
│   └── staging-sync.live.test.ts    # Narrow dispatch-only smoke (the only live-command target)
├── round-trip/
│   ├── workout-roundtrip.test.ts    # Session/exercise/set round-trip
│   └── entity-roundtrip.test.ts     # Routine/cycle/gamification round-trip
├── transforms/
│   ├── weight-transform.test.ts     # Per-cable loads and the display adapter
│   ├── mode-transform.test.ts       # Workout mode mapping
│   └── velocity-zones.test.ts       # VBT zones and asymmetry
├── conflicts/
│   └── conflict-resolution.test.ts  # Harness smoke; not server LWW
└── batch/
    └── batch-failure.test.ts        # Mock batch-failure handling
```

## Running Tests

### With Mocks (Default, CI-safe)

```bash
MOCK_EDGE_FUNCTIONS=true npm test -- tests/sync/
```

Mocks provide:
- Fast execution (no network)
- Deterministic behavior
- No Supabase credentials required

Mock limitations (the full list lives in the header of
`helpers/mock-edge-functions.ts`):
- No user scoping — the store has no user column and any non-empty bearer
  token is accepted
- No profile scoping — `profileId` is ignored on both push and pull
- No LWW — `Map.set` makes the last push in *arrival order* win, which is not
  what `upsert_*_lww` does
- No per-row delta — a pull returns every stored row whenever
  `lastPushTime > lastSync`
- No cursor/pageSize handling, no tombstones, no tier gate, no rate limit,
  no size caps, no weight transform, no telemetry
- Gamification entities partially stored
- No RLS policy testing

### With Live Supabase

```bash
# Set environment variables for local or staging only
export SUPABASE_URL=http://localhost:54321
export SUPABASE_ANON_KEY=your-anon-key
export SUPABASE_SERVICE_ROLE_KEY=your-service-key
export MOCK_EDGE_FUNCTIONS=false
export SYNC_LIVE_TESTS=true

# Narrow live smoke only (tests/sync/live/). Does not run the mock suite,
# and it is not a contract gate.
npm run test:sync:live
```

Live sync tests intentionally refuse the known production Supabase/API hosts.
Use local Supabase or an isolated staging/preview project. The GitHub Actions
workflow supports two fail-closed credential paths:

- Dedicated staging secrets: configure all three of
  `SYNC_STAGING_SUPABASE_URL`, `SYNC_STAGING_SUPABASE_ANON_KEY`, and
  `SYNC_STAGING_SUPABASE_SERVICE_ROLE_KEY`, plus
  `SYNC_STAGING_PROJECT_REF`. A partial credential set is rejected.
- Existing Supabase repository secrets: dispatch the workflow with
  `use_mocks=false` and `staging_project_ref` set to the expected isolated
  preview ref. The resolver uses `SUPABASE_ACCESS_TOKEN` and
  `SUPABASE_PROD_PROJECT_REF` only to list that production project's branch
  metadata and retrieve the verified preview's API keys. It rejects the
  production/default/cross-parent/wrong-Git-branch/unhealthy targets, masks the
  preview keys, and passes them to the live test step through `GITHUB_ENV`.

Both paths require the URL host to exactly match the expected preview ref. The
production database is never queried or mutated by the resolver or live sync
tests.

In live mode, the harness creates disposable `sync-test-*@test.local` users
with the service client's `auth.admin.createUser` API and confirms their email
without invoking public sign-up. Each user receives one active EMBER
subscription with a future period end before the anon client signs in for the
real user session. Tests that intentionally exercise the absent/FREE gate pass
`{ seedSubscription: false }`; this exception is used only by the harness
live test and the training-cycle test that inserts its own EMBER row. (The
push/pull subscription deny paths are pinned by the Deno handler tests under
`supabase/functions/`, not by live sync tests.)

The live workflow enables sanitized failure labels for non-OK push/pull
responses and runs an always-run cleanup after the live test step. Cleanup
revalidates the exact preview host/ref, paginates through Auth users, and
deletes only the generated test namespace. It logs only the preview ref and
deletion count, and fails the job if any required cleanup cannot complete.

`npm run test:sync:live` is a narrow smoke, not a contract gate. It provisions
one disposable user and runs only `tests/sync/live/staging-sync.live.test.ts`:
a legacy empty push and pull, then one strict-valid workout hierarchy
round-trip. One user keeps Auth traffic below its burst limits. The smoke
does not validate RLS, rate limits, LWW, tombstones, or performance.

`npm run test:sync` is not a contract gate and not a fault-injection gate.
Injected failures in this directory hit the in-memory harness. Server
behaviour is the Deno handler suites named in the header.

Profile-preference byte, conflict, and cross-owner staging coverage is
recorded separately in the Task 10 evidence.

## Adding New Fixtures

### 1. Create a fixture factory

```typescript
// In fixtures/my-entity-fixtures.ts
export function createMyEntityFixture(
  overrides: Partial<MyEntityRow> = {}
): MyEntityRow {
  return {
    id: nextTestUuid(),
    user_id: DEFAULT_USER_ID,
    // ... default values
    ...overrides,
  };
}
```

### 2. Export from index

```typescript
// In fixtures/index.ts
export {
  createMyEntityFixture,
  // ...
} from './my-entity-fixtures';
```

### 3. Use in tests

```typescript
import { createMyEntityFixture } from '../fixtures';

const entity = createMyEntityFixture({
  name: 'Custom Name',
});
```

## Debugging Sync Failures

### 1. Check mock vs live mode

```bash
# Verify which mode is active
node -e "console.log(process.env.MOCK_EDGE_FUNCTIONS)"
```

### 2. Enable verbose logging

```typescript
// In your test
const result = await callPushEndpoint(payload, token);
console.log('Push result:', JSON.stringify(result, null, 2));
```

### 3. Inspect mock store

```typescript
import { getMockSession, getAllMockSessions } from '../helpers/mock-edge-functions';

// After push
const stored = getMockSession(sessionId);
console.log('Stored session:', stored);
```

### 4. Check for transform issues

```typescript
// Loads are per cable end to end; the portal never doubles them.
// A total is derived only by src/lib/units/loadDisplay.ts when the
// exercise's cable count is known.
const rawWeight = 50; // Per-cable
expect(pulledSet.weightKg).toBe(rawWeight); // DB stores per-cable
expect(toLoadDisplay(rawWeight, null)).toEqual({ perCableKg: 50, totalKg: null });
```

### 5. Validate DTO structure

```typescript
// Ensure payload matches expected DTO format
import type { SessionDto } from '../helpers/edge-function-harness';

const session: SessionDto = {
  id: 'valid-uuid',
  userId: testUser.id,
  // All required fields...
};
```

## Parity-Critical Values

These values MUST match between mobile and portal:

| Transform           | Mobile                | Portal              | Notes                              |
| ------------------- | --------------------- | ------------------- | ---------------------------------- |
| Weight display      | per cable             | per cable first; total = per cable x cable_count only when known | `src/lib/units/loadDisplay.ts` |
| Velocity: EXPLOSIVE | >= 1.0 m/s            | >= 1.0 m/s          |                                    |
| Velocity: FAST      | >= 0.75 m/s           | >= 0.75 m/s         |                                    |
| Velocity: MODERATE  | >= 0.5 m/s            | >= 0.5 m/s          |                                    |
| Velocity: SLOW      | >= 0.25 m/s           | >= 0.25 m/s         |                                    |
| Velocity: GRIND     | < 0.25 m/s            | < 0.25 m/s          |                                    |
| Asymmetry balanced  | <= 2%                 | <= 2%               | `ASYMMETRY_BALANCED_THRESHOLD = 2` |

## Baseline Documentation

See [BASELINE.md](./BASELINE.md) for:
- Current test results
- Known working features
- Known limitations
- Partial/edge case coverage
- Fix complexity estimates

## Related Documentation

- [Root CLAUDE.md](../../CLAUDE.md) - Portal architecture
- [Monorepo CLAUDE.md](../../../CLAUDE.md) - Cross-project parity rules
- [Edge Functions](../../supabase/functions) - Sync endpoint implementations
- [Transforms](../../src/schemas/transforms.ts) - Portal transform logic
