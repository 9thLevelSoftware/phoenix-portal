import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  formatPersonalRecordName,
  generateInsights,
  type InsightInput,
  type TrainingInsight,
  type WeightUnit,
} from './insightRules.ts';

interface FixtureCase {
  id: string;
  unit: WeightUnit;
  input: InsightInput;
  expected: TrainingInsight[];
}

// Golden fixture. Three `description` keys in insight-cases.json were
// spliced twice each by a `merge=union` (balanced-progress-kg,
// balanced-progress-lbs, volume-record-and-legacy-pr-shape); `JSON.parse`
// keeps the last of a duplicate key, so the old non-cable string was winning
// while `formatPerCableWeight` produced the per-cable one.
// Was `"225 kg (up 10 kg from 215 kg)."`, `"496.0 lbs (up 22.0 lbs from
// 474.0 lbs)."` and `"180 kg."` — collapsed onto the per-cable forms
// (KD-8: a weight PR has no cable count, so it is labelled per cable and no
// total is shown). The duplicate keys are gone; the goldens are single-valued.
const fixture: { cases: FixtureCase[] } = JSON.parse(
  await Deno.readTextFile(
    new URL('../../../tests/fixtures/insight-cases.json', import.meta.url),
  ),
);

assert(fixture.cases.length > 0, 'insight-cases.json has no cases');

// The Vitest side (src/lib/__tests__/insights.test.ts) asserts the SAME file
// through src/lib/insights.ts. If either runtime drifts from the golden, one
// of the two suites goes red — which is the point: this fixture is what stops
// the rules being forked again (F-059).
for (const testCase of fixture.cases) {
  Deno.test(`insightRules parity fixture: ${testCase.id}`, () => {
    const actual = generateInsights(testCase.input, testCase.unit);
    assertEquals(JSON.parse(JSON.stringify(actual)), testCase.expected);
  });
}

Deno.test('insightRules: every fixture insight id is unique per case', () => {
  for (const testCase of fixture.cases) {
    const ids = testCase.expected.map((i) => i.id);
    assertEquals(new Set(ids).size, ids.length, testCase.id);
  }
});

Deno.test('formatPersonalRecordName keeps MAX_WEIGHT/MAX_VOLUME distinct from 1RM', () => {
  assertEquals(
    formatPersonalRecordName('Bench Press', 'MAX_WEIGHT', 'COMBINED'),
    'Bench Press Max Weight',
  );
  assertEquals(
    formatPersonalRecordName('Bench Press', 'MAX_VOLUME', 'ECCENTRIC'),
    'Bench Press Eccentric Max Volume',
  );
  assertEquals(
    formatPersonalRecordName('Bench Press', '1RM', null),
    'Bench Press 1RM',
  );
});
