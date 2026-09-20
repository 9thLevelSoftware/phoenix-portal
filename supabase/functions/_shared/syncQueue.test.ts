import { assertEquals } from "jsr:@std/assert@1";
import { completeSyncQueueEntry, heartbeatSyncQueueEntry } from "./syncQueue.ts";
import { FakeDb, type Row } from "./testing/fakeSupabase.ts";

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
    syncType: "initial",
    queueId: ROW_A,
    calledByQueueProcessor: true,
  });

  assertEquals(statuses(db), ["completed", "processing"]);
});

Deno.test("syncQueue: a browser call completes only the newest pending row of its sync_type", async () => {
  const db = new FakeDb({
    sync_queue: [
      row(ROW_A, { status: "pending", sync_type: "manual", created_at: "2026-09-17T00:00:00.000Z" }),
      row(ROW_B, { status: "pending", sync_type: "manual", created_at: "2026-09-19T00:00:00.000Z" }),
      row(ROW_C, { status: "pending", sync_type: "initial", created_at: "2026-09-18T00:00:00.000Z" }),
    ],
  });

  await completeSyncQueueEntry(client(db), {
    userId: USER_ID,
    provider: "strava",
    syncType: "manual",
    queueId: null,
    calledByQueueProcessor: false,
  });

  // Newest manual row only: the older manual row and the initial row stay.
  assertEquals(statuses(db), ["pending", "completed", "pending"]);
});

Deno.test("syncQueue: the service-role path without a queue_id completes nothing", async () => {
  const db = new FakeDb({
    sync_queue: [
      // Same sync_type and status the run would otherwise have guessed at.
      row(ROW_A, { status: "processing", sync_type: "initial", created_at: "2026-09-18T00:00:00.000Z" }),
    ],
  });

  await completeSyncQueueEntry(client(db), {
    userId: USER_ID,
    provider: "strava",
    syncType: "initial",
    queueId: null,
    calledByQueueProcessor: true,
  });

  assertEquals(statuses(db), ["processing"]);
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
      syncType: "initial",
      queueId: ROW_A,
      calledByQueueProcessor: true,
    });

    assertEquals(db.rows("sync_queue")[0].status, patch.status ?? "processing", label);
    assertEquals(db.rows("sync_queue")[0].completed_at, null, label);
  }
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
