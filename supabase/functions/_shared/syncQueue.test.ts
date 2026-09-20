import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  completeSyncQueueEntry,
  createSyncQueueEntry,
  failSyncQueueEntry,
  heartbeatSyncQueueEntry,
  noOwnedQueueRow,
  releaseOwnedQueueRow,
  SYNC_RUN_FAILED,
} from "./syncQueue.ts";
import {
  FakeDb,
  type Row,
  syncQueueOneActiveIndex,
  syncQueueOneProcessingIndex,
} from "./testing/fakeSupabase.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const ROW_A = "00000000-0000-4000-8000-0000000000aa";
const ROW_B = "00000000-0000-4000-8000-0000000000bb";
const ROW_C = "00000000-0000-4000-8000-0000000000cc";
const NOW = new Date("2026-09-19T12:00:00.000Z");
const EARLIER = "2026-09-19T11:00:00.000Z";

function row(
  id: string,
  overrides: Partial<Row> & { status: string; sync_type: string; created_at: string },
): Row {
  return {
    id,
    user_id: USER_ID,
    provider: "strava",
    started_at: EARLIER,
    completed_at: null,
    error_message: null,
    ...overrides,
  };
}

// deno-lint-ignore no-explicit-any
const client = (db: FakeDb) => db as any;

const statuses = (db: FakeDb) => db.rows("sync_queue").map((r) => r.status as string);

/** A queue with both migration 20260920005200 unique indexes in force. */
const queueDb = (rows: Row[]) =>
  new FakeDb(
    { sync_queue: rows },
    [syncQueueOneActiveIndex, syncQueueOneProcessingIndex],
  );

Deno.test("syncQueue: a queue_id call completes only that row, even with a sibling in the same status", async () => {
  const db = new FakeDb({
    sync_queue: [
      row(ROW_A, { status: "processing", sync_type: "initial", created_at: "2026-09-18T00:00:00.000Z" }),
      row(ROW_B, { status: "processing", sync_type: "initial", created_at: "2026-09-19T00:00:00.000Z" }),
    ],
  });

  await completeSyncQueueEntry(client(db), {
    userId: USER_ID,
    provider: "strava",
    queueId: ROW_A,
  });

  assertEquals(statuses(db), ["completed", "processing"]);
});

Deno.test("syncQueue: a run that owns no row completes nothing, whatever is queued", async () => {
  const db = new FakeDb({
    sync_queue: [
      // The rows the removed "newest pending of this sync_type" fallback would
      // have guessed at. A run only ever completes the row it owns.
      row(ROW_A, { status: "pending", sync_type: "manual", created_at: "2026-09-17T00:00:00.000Z" }),
      row(ROW_B, { status: "pending", sync_type: "manual", created_at: "2026-09-19T00:00:00.000Z" }),
      row(ROW_C, { status: "processing", sync_type: "initial", created_at: "2026-09-18T00:00:00.000Z" }),
    ],
  });

  await completeSyncQueueEntry(client(db), {
    userId: USER_ID,
    provider: "strava",
    queueId: null,
  });

  assertEquals(statuses(db), ["pending", "pending", "processing"]);
});

Deno.test("syncQueue: a pending row is never completed, not even by id", async () => {
  // Completion is by id AND status: a row reclaimed back to `pending` (lease
  // expiry) belongs to the queue again, not to this run.
  const db = new FakeDb({
    sync_queue: [
      row(ROW_A, { status: "pending", sync_type: "manual", created_at: "2026-09-18T00:00:00.000Z" }),
    ],
  });

  await completeSyncQueueEntry(client(db), {
    userId: USER_ID,
    provider: "strava",
    queueId: ROW_A,
  });

  assertEquals(statuses(db), ["pending"]);
});

Deno.test("syncQueue: a queue_id in the wrong status, provider or user is not completed", async () => {
  for (
    const [label, patch] of [
      ["wrong status", { status: "pending" }],
      ["another provider", { provider: "hevy" }],
      ["another user", { user_id: OTHER_USER_ID }],
    ] as Array<[string, Partial<Row>]>
  ) {
    const db = new FakeDb({
      sync_queue: [
        {
          ...row(ROW_A, {
            status: "processing",
            sync_type: "initial",
            created_at: "2026-09-18T00:00:00.000Z",
          }),
          ...patch,
        },
      ],
    });

    await completeSyncQueueEntry(client(db), {
      userId: USER_ID,
      provider: "strava",
      queueId: ROW_A,
    });

    assertEquals(db.rows("sync_queue")[0].status, patch.status ?? "processing", label);
    assertEquals(db.rows("sync_queue")[0].completed_at, null, label);
  }
});

Deno.test("syncQueue: a created row is `processing` and leased from the start", async () => {
  const db = queueDb([]);

  const created = await createSyncQueueEntry(client(db), {
    userId: USER_ID,
    provider: "strava",
    syncType: "manual",
    now: NOW,
  });

  assertEquals(created.conflict, false);
  assertNotEquals(created.queueId, null);
  const [inserted] = db.rows("sync_queue");
  assertEquals(inserted.id, created.queueId);
  assertEquals(inserted.status, "processing");
  // `pending` would let the next cron pass claim and dispatch it a second time.
  assertEquals(inserted.started_at, NOW.toISOString());
  assertEquals(inserted.created_at, NOW.toISOString());
  assertEquals(inserted.sync_type, "manual");
  assertEquals(inserted.retry_count, 0);
});

Deno.test("syncQueue: a non-conflict insert failure yields no ownership row", async () => {
  const db = queueDb([]);
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table === "sync_queue") {
      query.insert = () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({
            data: null,
            error: { code: "08006", message: "connection failure" },
          }),
        }),
      }) as never;
    }
    return query;
  };

  const created = await createSyncQueueEntry(client(db), {
    userId: USER_ID,
    provider: "strava",
    syncType: "manual",
    now: NOW,
  });

  assertEquals(created, { queueId: null, conflict: false });
  assertEquals(db.rows("sync_queue"), []);
});

Deno.test("syncQueue: a second row of the same kind conflicts and is not inserted", async () => {
  for (const existingStatus of ["pending", "processing"]) {
    const db = queueDb([
      row(ROW_A, {
        status: existingStatus,
        sync_type: "incremental",
        created_at: "2026-09-18T00:00:00.000Z",
      }),
    ]);

    const created = await createSyncQueueEntry(client(db), {
      userId: USER_ID,
      provider: "strava",
      syncType: "manual",
      now: NOW,
    });

    assertEquals(created.conflict, true, existingStatus);
    assertEquals(created.queueId, null, existingStatus);
    assertEquals(db.rows("sync_queue").length, 1, existingStatus);
  }
});

Deno.test("syncQueue: a processing row of the other class serializes provider execution", async () => {
  const db = queueDb([
    row(ROW_A, {
      status: "processing",
      sync_type: "initial",
      created_at: "2026-09-18T00:00:00.000Z",
    }),
  ]);

  const created = await createSyncQueueEntry(client(db), {
    userId: USER_ID,
    provider: "strava",
    syncType: "manual",
    now: NOW,
  });

  assertEquals(created, { queueId: null, conflict: true });
  assertEquals(db.rows("sync_queue").length, 1);
});

Deno.test("syncQueue: an initial, another provider or a finished row does not block a new row", async () => {
  for (
    const [label, existing] of [
      ["a queued initial (other class)", { sync_type: "initial", status: "pending" }],
      ["another provider", { sync_type: "manual", status: "processing", provider: "hevy" }],
      ["a completed row", { sync_type: "manual", status: "completed" }],
      ["a superseded row", { sync_type: "manual", status: "superseded" }],
    ] as Array<[string, Partial<Row> & { status: string; sync_type: string }]>
  ) {
    const db = queueDb([
      row(ROW_A, { created_at: "2026-09-18T00:00:00.000Z", ...existing }),
    ]);

    const created = await createSyncQueueEntry(client(db), {
      userId: USER_ID,
      provider: "strava",
      syncType: "manual",
      now: NOW,
    });

    assertEquals(created.conflict, false, label);
    assertEquals(db.rows("sync_queue").length, 2, label);
  }
});

Deno.test("syncQueue: a failed run hands its own row back, and only while it is processing", async () => {
  const db = queueDb([
    row(ROW_A, { status: "processing", sync_type: "manual", created_at: "2026-09-18T00:00:00.000Z" }),
  ]);

  await failSyncQueueEntry(client(db), ROW_A, USER_ID, SYNC_RUN_FAILED);

  assertEquals(db.rows("sync_queue")[0].status, "failed");
  assertEquals(db.rows("sync_queue")[0].error_message, SYNC_RUN_FAILED);
  assertNotEquals(db.rows("sync_queue")[0].completed_at, null);

  // A row already reclaimed by the queue is not stolen back.
  const reclaimed = queueDb([
    row(ROW_B, { status: "pending", sync_type: "manual", created_at: "2026-09-18T00:00:00.000Z" }),
  ]);
  await failSyncQueueEntry(client(reclaimed), ROW_B, USER_ID, SYNC_RUN_FAILED);
  assertEquals(reclaimed.rows("sync_queue")[0].status, "pending");

  // Another user's row is out of reach.
  const foreign = queueDb([
    row(ROW_C, { status: "processing", sync_type: "manual", created_at: "2026-09-18T00:00:00.000Z" }),
  ]);
  await failSyncQueueEntry(client(foreign), ROW_C, OTHER_USER_ID, SYNC_RUN_FAILED);
  assertEquals(foreign.rows("sync_queue")[0].status, "processing");
});

Deno.test("syncQueue: releasing an empty holder (a queue-dispatched run) changes nothing", async () => {
  const db = queueDb([
    row(ROW_A, { status: "processing", sync_type: "manual", created_at: "2026-09-18T00:00:00.000Z" }),
  ]);

  // A queue-dispatched run never fills the holder: its row must stay
  // `processing` so process-sync-queue can re-run it (PR 51).
  await releaseOwnedQueueRow(noOwnedQueueRow());

  assertEquals(db.rows("sync_queue")[0].status, "processing");
});

Deno.test("syncQueue: a heartbeat renews only the named processing row", async () => {
  const db = new FakeDb({
    sync_queue: [
      row(ROW_A, { status: "processing", sync_type: "initial", created_at: "2026-09-18T00:00:00.000Z" }),
      // Same user, another provider, also live: it must not be renewed.
      {
        ...row(ROW_B, {
          status: "processing",
          sync_type: "initial",
          created_at: "2026-09-18T00:00:00.000Z",
        }),
        provider: "hevy",
      },
    ],
  });

  await heartbeatSyncQueueEntry(client(db), ROW_A, USER_ID, NOW);

  assertEquals(db.rows("sync_queue")[0].started_at, NOW.toISOString());
  assertEquals(db.rows("sync_queue")[1].started_at, EARLIER);
});

Deno.test("syncQueue: a heartbeat never revives a row that is no longer processing", async () => {
  for (const status of ["pending", "completed", "failed", "permanently_failed"]) {
    const db = new FakeDb({
      sync_queue: [
        row(ROW_A, { status, sync_type: "initial", created_at: "2026-09-18T00:00:00.000Z" }),
      ],
    });

    await heartbeatSyncQueueEntry(client(db), ROW_A, USER_ID, NOW);

    assertEquals(db.rows("sync_queue")[0].started_at, EARLIER, status);
  }
});

Deno.test("syncQueue: a heartbeat for another user's row, or without a queue id, changes nothing", async () => {
  const db = new FakeDb({
    sync_queue: [
      row(ROW_A, { status: "processing", sync_type: "initial", created_at: "2026-09-18T00:00:00.000Z" }),
    ],
  });

  await heartbeatSyncQueueEntry(client(db), ROW_A, OTHER_USER_ID, NOW);
  assertEquals(db.rows("sync_queue")[0].started_at, EARLIER);

  await heartbeatSyncQueueEntry(client(db), null, USER_ID, NOW);
  assertEquals(db.rows("sync_queue")[0].started_at, EARLIER);
});
