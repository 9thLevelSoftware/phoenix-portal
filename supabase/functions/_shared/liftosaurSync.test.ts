import { assertEquals } from 'jsr:@std/assert@1';
import {
  fetchLiftosaurHistory,
  liftosaurDateOrder,
  parseLiftoscriptMetadata,
} from './liftosaurSync.ts';

Deno.test('parseLiftoscriptMetadata: a pattern-matching but invalid timestamp is undated', () => {
  assertEquals(
    parseLiftoscriptMetadata('2026-13-45T99:99:99Z / program: "P"').timestamp,
    null,
  );
  assertEquals(
    parseLiftoscriptMetadata('2026-03-01T10:00:00Z / program: "P"').timestamp,
    '2026-03-01T10:00:00Z',
  );
});

Deno.test('fetchLiftosaurHistory: hasMore without nextCursor stops after one request as truncated', async () => {
  let requests = 0;
  const result = await fetchLiftosaurHistory(() => {
    requests++;
    return Promise.resolve({
      data: {
        records: [{ id: 1, text: '2026-03-01T10:00:00Z / x' }],
        hasMore: true,
        nextCursor: null,
      },
    });
  });
  assertEquals(requests, 1);
  assertEquals(result.truncated, true);
  assertEquals(result.reason, 'missing_cursor');
  assertEquals(result.records.length, 1);
  assertEquals(result.nextCursor, null);
});

Deno.test('fetchLiftosaurHistory: page budget reached reports page_budget and the next cursor', async () => {
  let offset = 0;
  const result = await fetchLiftosaurHistory(() => {
    offset += 1;
    return Promise.resolve({
      data: { records: [{ id: offset, text: 'x' }], hasMore: true, nextCursor: offset },
    });
  }, { maxPages: 3 });
  assertEquals(result.truncated, true);
  assertEquals(result.reason, 'page_budget');
  assertEquals(result.nextCursor, 3);
});

Deno.test('liftosaurDateOrder: needs two distinct dates in one direction', () => {
  assertEquals(liftosaurDateOrder([]), 'unknown');
  assertEquals(liftosaurDateOrder([5]), 'unknown');
  assertEquals(liftosaurDateOrder([5, 5, 5]), 'unknown');
  assertEquals(liftosaurDateOrder([1, 2, 2, 3]), 'ascending');
  assertEquals(liftosaurDateOrder([3, 2, 2, 1]), 'descending');
  assertEquals(liftosaurDateOrder([1, 3, 2]), 'unknown');
});
