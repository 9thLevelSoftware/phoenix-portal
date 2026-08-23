# Sync Test Suite

Comprehensive test suite for validating mobile-to-portal sync via `mobile-sync-push` and `mobile-sync-pull` Edge Functions.

## Quick Start

```bash
# Run all sync tests with mocks (CI-safe, no Supabase required)
npm run test:sync

# Run the bounded real-service smoke suite with live Supabase
npm run test:sync:live

# Run specific test file
npm test -- --run tests/sync/round-trip/workout-roundtrip.test.ts
```

## CI labeling (mock vs live)

`npm run test:sync` and the GitHub Actions **Sync Validation Tests (mock)** job
are **mock Edge**. `MOCK_EDGE_FUNCTIONS=true` is the default in `vitest.config.ts`
and on every push/PR. That job is not a live `mobile-sync-push` / `mobile-sync-pull`
run.

Live mode (`npm run test:sync:live`, `MOCK_EDGE_FUNCTIONS=false`) is
**workflow_dispatch only** (`sync-tests.yml` with `use_mocks=false`). Push and
`pull_request` never start live tests.

`ci.yml` still splits jobs. `npm run verify:full` is the local handoff command;
it is not one CI job. Playwright E2E uses a mocked REST harness — the
DEV `CustomEvent` spec (`e2e/dev-custom-event-cross-tab.spec.ts`) is **not**
Supabase Broadcast proof.

Deno handler tests (`npm run test:edge`) run `mobile-sync-push/index.test.ts`
and `mobile-sync-pull/index.test.ts` against in-process doubles (no live
secrets) in the **Edge Function Deno Check and Handler Tests** job.

## Test Organization

```
tests/sync/
├── setup.ts                    # Test environment setup
├── README.md                   # This file
├── BASELINE.md                 # Sync behavior baseline documentation
├── helpers/
│   ├── edge-function-harness.ts   # Push/pull callers, test user management
│   ├── mock-edge-functions.ts     # Mock implementations for CI
│   └── supabase-test-client.ts    # Supabase client configuration
├── fixtures/
│   ├── index.ts                   # Aggregate exports
│   ├── workout-fixtures.ts        # Session, exercise, set, rep factories
│   ├── routine-fixtures.ts        # Routine and exercise factories
│   ├── cycle-fixtures.ts          # Training cycle factories
│   ├── gamification-fixtures.ts   # RPG, badges, stats, PR factories
│   ├── external-fixtures.ts       # Strava/Fitbit/Garmin factories
│   ├── edge-cases.ts              # Boundary and Unicode test data
│   └── fixtures.test.ts           # Fixture validation tests
├── round-trip/
│   ├── workout-roundtrip.test.ts  # Session/exercise/set round-trip
│   └── entity-roundtrip.test.ts   # Routine/cycle/gamification round-trip
└── transforms/
    ├── weight-transform.test.ts   # Per-cable to display transforms
    ├── mode-transform.test.ts     # Workout mode mapping
    └── velocity-zones.test.ts     # VBT zones and asymmetry
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

Mock limitations:
- Simplified delta sync (no per-row timestamps)
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

# Run the bounded real-service smoke suite. The comprehensive sync suite stays
# in mock mode because it includes mock-only assertions such as in-memory
# broadcast capture and injected failure behavior.
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
`{ seedSubscription: false }`; this exception is used only by the validation
gate tests and the training-cycle test that inserts its own EMBER row.

The live workflow enables sanitized failure labels for non-OK push/pull
responses and runs an always-run cleanup after the live test step. Cleanup
revalidates the exact preview host/ref, paginates through Auth users, and
deletes only the generated test namespace. It logs only the preview ref and
deletion count, and fails the job if any required cleanup cannot complete.

Live testing provides:
- Real database behavior
- RLS policy validation
- Edge Function runtime testing
- Performance characteristics

The live command deliberately provisions one disposable user for its legacy
push/pull and strict workout-hierarchy smoke cases. This keeps Auth traffic
below its burst limits. The comprehensive `npm run test:sync` suite remains the
contract and fault-injection gate; profile-preference byte, conflict, and
cross-owner staging coverage is recorded separately in the Task 10 evidence.

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
// Compare raw DB value to transformed display
const rawWeight = 50; // Per-cable
const displayWeight = rawWeight * 2; // WEIGHT_MULTIPLIER
expect(pulledSet.weightKg).toBe(rawWeight); // DB stores per-cable
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
| Weight multiplier   | x1 (stores per-cable) | x2 (displays total) | `WEIGHT_MULTIPLIER = 2`            |
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
