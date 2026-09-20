import { assertEquals } from 'jsr:@std/assert@1';
import { completeClaimedSyncQueueEntry } from './completeSyncQueueEntry.ts';
import { FakeDb } from './testing/fakeSupabase.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';

Deno.test('completeClaimedSyncQueueEntry completes only the claimed row', async () => {
  const db = new FakeDb({
    sync_queue: [
      { id: 'claimed', user_id: USER_ID, provider: 'hevy', status: 'processing' },
      { id: 'pending', user_id: USER_ID, provider: 'hevy', status: 'pending' },
      { id: 'other', user_id: USER_ID, provider: 'hevy', status: 'processing' },
    ],
  });

  await completeClaimedSyncQueueEntry(db as never, {
    queueId: 'claimed',
    userId: USER_ID,
    provider: 'hevy',
  });

  assertEquals(db.rows('sync_queue').map(({ id, status }) => ({ id, status })), [
    { id: 'claimed', status: 'completed' },
    { id: 'pending', status: 'pending' },
    { id: 'other', status: 'processing' },
  ]);
});

Deno.test('completeClaimedSyncQueueEntry without an owned row changes nothing', async () => {
  const db = new FakeDb({
    sync_queue: [
      { id: 'pending', user_id: USER_ID, provider: 'liftosaur', status: 'pending' },
    ],
  });

  await completeClaimedSyncQueueEntry(db as never, {
    queueId: null,
    userId: USER_ID,
    provider: 'liftosaur',
  });

  assertEquals(db.rows('sync_queue')[0].status, 'pending');
});

Deno.test('completeClaimedSyncQueueEntry rejects stale or mismatched claims', async () => {
  const db = new FakeDb({
    sync_queue: [
      { id: 'stale', user_id: USER_ID, provider: 'hevy', status: 'pending' },
      { id: 'wrong-provider', user_id: USER_ID, provider: 'liftosaur', status: 'processing' },
    ],
  });

  await completeClaimedSyncQueueEntry(db as never, {
    queueId: 'stale',
    userId: USER_ID,
    provider: 'hevy',
  });
  await completeClaimedSyncQueueEntry(db as never, {
    queueId: 'wrong-provider',
    userId: USER_ID,
    provider: 'hevy',
  });

  assertEquals(db.rows('sync_queue').map(({ status }) => status), ['pending', 'processing']);
});
