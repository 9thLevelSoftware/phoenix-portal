# Sync Test Suite

Comprehensive test suite for validating mobile-to-portal sync via `mobile-sync-push` and `mobile-sync-pull` Edge Functions.

## Quick Start

```bash
# Run all sync tests with mocks (CI-safe, no Supabase required)
npm run test:sync

# Run all sync tests with live Supabase (local or staging only)
npm run test:sync:live

# Run specific test file
npm test -- --run tests/sync/round-trip/workout-roundtrip.test.ts
```

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

# Run tests
npm run test:sync:live
```

Live sync tests intentionally refuse the known production Supabase/API hosts.
Use local Supabase or a disposable staging project with the
`SYNC_STAGING_SUPABASE_*` GitHub secrets.

Live testing provides:
- Real database behavior
- RLS policy validation
- Edge Function runtime testing
- Performance characteristics

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
