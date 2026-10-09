import { assert, assertEquals } from 'jsr:@std/assert@1';
import { calculateRTL, type WorkoutLoadInput } from './trainingLoad.ts';

interface FixtureCase {
  id: string;
  sessions: WorkoutLoadInput[];
  expected: number;
}

const fixture: { cases: FixtureCase[] } = JSON.parse(
  await Deno.readTextFile(
    new URL('../../../tests/fixtures/rtl-cases.json', import.meta.url),
  ),
);

assert(fixture.cases.length > 0, 'rtl-cases.json has no cases');

// The Vitest side (src/lib/__tests__/training-load.test.ts) asserts the SAME
// file through src/lib/training-load.ts. Both runtimes import ONE module.
for (const testCase of fixture.cases) {
  Deno.test(`trainingLoad parity fixture: ${testCase.id}`, () => {
    assertEquals(calculateRTL(testCase.sessions), testCase.expected);
  });
}

Deno.test('generate-insights uses the shared calculateRTL', async () => {
  const source = await Deno.readTextFile(
    new URL('../generate-insights/index.ts', import.meta.url),
  );
  assert(source.includes("from '../_shared/trainingLoad.ts'"));
  assert(
    !/function calculateRTL\b/.test(source),
    'generate-insights must not keep a local calculateRTL',
  );
});
