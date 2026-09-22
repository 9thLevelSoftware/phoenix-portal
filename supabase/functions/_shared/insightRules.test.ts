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
