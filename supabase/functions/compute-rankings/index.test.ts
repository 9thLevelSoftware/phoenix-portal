import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type ComputeRankingsDependencies,
  createComputeRankingsHandler,
} from "./index.ts";

// The service client is a real supabase-js client whose fetch is a fake
// PostgREST. Every request (URL, headers, body) is recorded, so the tests
// assert on what would really go over the wire.

const PARTICIPANTS = 300;
const VIEWER_ID = userId(0);
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function userId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

interface SnapshotFixtureRow {
  metric: string;
  period: string;
  user_id: string;
  value: number;
  rank: number;
}

interface RecordedRequest {
  method: string;
  url: string;
  path: string;
  body: string;
}

// The UTC ISO-week Monday, as refresh_leaderboard_snapshots() keys weeks.
function currentWeekStart(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function buildSnapshot(participants: number): SnapshotFixtureRow[] {
  const rows: SnapshotFixtureRow[] = [];
  const week = currentWeekStart();
  const metrics: Array<[string, string]> = [
    ["total_volume_kg", "all_time"],
    ["total_workouts", "all_time"],
    ["longest_streak", "all_time"],
    ["current_streak", "all_time"],
    ["pr_count", "all_time"],
    ["exercise_mastery", "all_time"],
    ["total_volume_kg", week],
    ["total_workouts", week],
    ["pr_count", week],
  ];
  for (const [metric, period] of metrics) {
    for (let i = 0; i < participants; i++) {
      // Viewer (index 0) ranks 5th; the rest descend by index.
      const value = i === 0 ? participants - 4.5 : participants - i;
      rows.push({ metric, period, user_id: userId(i), value, rank: 0 });
    }
  }
  // SQL RANK() per (metric, period).
  const groups = new Map<string, SnapshotFixtureRow[]>();
  for (const row of rows) {
    const key = `${row.metric}|${row.period}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    for (const row of group) {
      row.rank = group.filter((other) => other.value > row.value).length + 1;
    }
  }
  return rows;
}

function eqParam(params: URLSearchParams, column: string): string | null {
  const raw = params.get(column);
  return raw?.startsWith("eq.") ? raw.slice(3) : null;
}

interface HarnessOptions {
  tier?: string;
  snapshot?: SnapshotFixtureRow[];
  optedOut?: Set<string>;
  event?: Record<string, unknown> | null;
}

function createHarness(options: HarnessOptions = {}) {
  const requests: RecordedRequest[] = [];
  const snapshot = options.snapshot ?? buildSnapshot(PARTICIPANTS);
  const optedOut = options.optedOut ?? new Set<string>();

  const fakeFetch = async (
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === "GET" || request.method === "HEAD"
      ? ""
      : await request.text();
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    requests.push({ method: request.method, url: request.url, path, body });
    const params = url.searchParams;

    if (path === "rpc/check_rate_limit") {
      return Response.json({ allowed: true, remaining: 29, retry_after_seconds: null });
    }
    if (path === "subscriptions") {
      return Response.json([{
        tier: options.tier ?? "FLAME",
        status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
      }]);
    }
    if (path === "profiles") {
      const target = eqParam(params, "user_id");
      const participates = target !== null &&
        snapshot.some((row) => row.user_id === target) && !optedOut.has(target);
      return Response.json([{ leaderboard_participation: participates }]);
    }
    if (path === "leaderboard_events") {
      return Response.json(options.event ? [options.event] : []);
    }
    if (path === "leaderboard_snapshots") {
      const metric = eqParam(params, "metric");
      const period = eqParam(params, "period");
      const user = eqParam(params, "user_id");
      assertEquals(params.get("profiles.leaderboard_participation"), "eq.true");
      let rows = snapshot.filter((row) =>
        (metric === null || row.metric === metric) &&
        (period === null || row.period === period) &&
        (user === null || row.user_id === user) &&
        !optedOut.has(row.user_id)
      );
      rows = [...rows].sort((a, b) => a.rank - b.rank || a.user_id.localeCompare(b.user_id));
      const total = rows.length;
      const offset = Number(params.get("offset") ?? "0");
      const limit = Number(params.get("limit") ?? `${total}`);
      const page = rows.slice(offset, offset + limit).map((row) => ({
        user_id: row.user_id,
        metric: row.metric,
        value: row.value,
        rank: row.rank,
        profiles: {
          display_name: `Athlete ${row.user_id.slice(-4)}`,
          avatar_url: null,
          leaderboard_participation: true,
        },
      }));
      const headers = new Headers({
        "Content-Type": "application/json",
        "Content-Range": `${offset}-${offset + page.length - 1}/${total}`,
      });
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      return new Response(JSON.stringify(page), { status: 200, headers });
    }
    return Response.json({ message: `unexpected path ${path}` }, { status: 404 });
  };

  const deps: ComputeRankingsDependencies = {
    createAuthClient: () => ({
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: VIEWER_ID } }, error: null }),
      },
    }),
    createServiceClient: () =>
      createClient("http://fake.supabase.test", "service-role-key", {
        global: { fetch: fakeFetch as typeof fetch },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
  };

  return { handler: createComputeRankingsHandler(deps), requests };
}

function rankingRequest(body: unknown): Request {
  return new Request("http://localhost/functions/v1/compute-rankings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-jwt",
    },
    body: JSON.stringify(body),
  });
}

// No request may carry a list of user ids (the GET `.in('user_id', …)` URL
// wall) nor rely on an unbounded select of every participant.
function assertNoIdLists(requests: RecordedRequest[]) {
  assert(requests.length > 0);
  for (const request of requests) {
    const decoded = decodeURIComponent(request.url);
    assert(!/\bin\.\(/.test(decoded), `id list in ${request.method} ${decoded}`);
    const idsInRequest = (decoded.match(UUID_PATTERN) ?? []).length +
      (request.body.match(UUID_PATTERN) ?? []).length;
    assert(idsInRequest <= 1, `${idsInRequest} ids in ${request.method} ${decoded}`);
    assert(decoded.length < 1000, `URL of ${decoded.length} chars: ${decoded}`);
  }
}

function assertSnapshotReadsBounded(requests: RecordedRequest[]) {
  const reads = requests.filter((r) => r.path === "leaderboard_snapshots" && r.method === "GET");
  assert(reads.length > 0, "expected snapshot reads");
  for (const read of reads) {
    const params = new URL(read.url).searchParams;
    assert(params.get("limit") !== null, `unbounded snapshot read: ${read.url}`);
  }
}

Deno.test("global rankings for 300 participants read the snapshot without id lists", async () => {
  const { handler, requests } = createHarness();
  const response = await handler(rankingRequest({ type: "global" }));
  assertEquals(response.status, 200);
  const body = await response.json();

  for (const key of [
    "totalVolume",
    "workoutCount",
    "longestStreak",
    "currentStreak",
    "prCount",
    "exerciseMastery",
  ]) {
    assertEquals(body[key].length, 100, key);
    assertEquals(body[key][0].rank, 1);
    assertEquals(body[key][0].percentile, 100);
    assertEquals(body[key][0].displayName, `Athlete ${userId(1).slice(-4)}`);
  }
  const viewer = body.prCount.find((e: { userId: string }) => e.userId === VIEWER_ID);
  assertEquals(viewer.rank, 5);
  assertEquals(viewer.value, PARTICIPANTS - 4.5);
  assertEquals(viewer.percentile, Math.round(((300 - 5) / 299) * 100));

  assertNoIdLists(requests);
  assertSnapshotReadsBounded(requests);
  // Nothing reads raw history tables or the old aggregate RPCs.
  for (const request of requests) {
    assert(
      !/^(gamification_stats|workout_sessions|personal_records|exercises|rpc\/get_)/.test(
        request.path,
      ),
      `raw read ${request.path}`,
    );
  }
});

Deno.test("weekly rankings for 300 participants read the week's snapshot without id lists", async () => {
  const week = currentWeekStart();
  const { handler, requests } = createHarness({
    event: {
      id: "evt-1",
      name: "Volume Week",
      metric: "total_volume_kg",
      metric_label: "Total Volume",
      start_date: week,
      end_date: week,
    },
  });
  const response = await handler(rankingRequest({ type: "weekly", weekStart: week }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.metric, "total_volume_kg");
  assertEquals(body.isSpecialEvent, true);
  assertEquals(body.entries.length, 100);
  assertEquals(body.entries[0].rank, 1);

  const snapshotReads = requests.filter((r) => r.path === "leaderboard_snapshots");
  for (const read of snapshotReads) {
    assertEquals(new URL(read.url).searchParams.get("period"), `eq.${week}`);
  }
  assertNoIdLists(requests);
  assertSnapshotReadsBounded(requests);
});

Deno.test("a weekStart that is not a UTC Monday reads that week's Monday snapshot", async () => {
  const monday = currentWeekStart();
  const wednesday = new Date(`${monday}T00:00:00Z`);
  wednesday.setUTCDate(wednesday.getUTCDate() + 2);
  const weekStart = wednesday.toISOString().slice(0, 10);
  const { handler, requests } = createHarness({
    event: {
      id: "evt-3",
      name: "Volume Week",
      metric: "total_volume_kg",
      metric_label: "Total Volume",
      start_date: monday,
      end_date: weekStart,
    },
  });
  const response = await handler(rankingRequest({ type: "weekly", weekStart }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.entries.length, 100);
  const snapshotReads = requests.filter((r) => r.path === "leaderboard_snapshots");
  assert(snapshotReads.length > 0);
  for (const read of snapshotReads) {
    assertEquals(new URL(read.url).searchParams.get("period"), `eq.${monday}`);
  }
});

Deno.test("weekly current_streak reads the all-time snapshot", async () => {
  const week = currentWeekStart();
  const { handler, requests } = createHarness({
    event: {
      id: "evt-2",
      name: "Streak Week",
      metric: "current_streak",
      metric_label: "Current Streak",
      start_date: week,
      end_date: week,
    },
  });
  const response = await handler(rankingRequest({ type: "weekly", weekStart: week }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.entries.length, 100);
  for (const read of requests.filter((r) => r.path === "leaderboard_snapshots")) {
    assertEquals(new URL(read.url).searchParams.get("period"), "eq.all_time");
  }
  assertNoIdLists(requests);
});

Deno.test("user rankings for 300 participants return all six metrics without id lists", async () => {
  const { handler, requests } = createHarness();
  const response = await handler(rankingRequest({ type: "user", userId: VIEWER_ID }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(
    body.map((r: { metric: string }) => r.metric),
    ["totalVolume", "workoutCount", "longestStreak", "currentStreak", "prCount", "exerciseMastery"],
  );
  for (const ranking of body) {
    assertEquals(ranking.rank, 5);
    assertEquals(ranking.totalUsers, PARTICIPANTS);
    assertEquals(ranking.value, PARTICIPANTS - 4.5);
  }
  assertNoIdLists(requests);
  assertSnapshotReadsBounded(requests);
  // The only id sent is the target user's, as a single eq filter.
  const userReads = requests.filter((r) => new URL(r.url).searchParams.has("user_id"));
  for (const read of userReads) {
    assertEquals(new URL(read.url).searchParams.get("user_id"), `eq.${VIEWER_ID}`);
  }
});

Deno.test("an opted-out user gets no rankings", async () => {
  const { handler } = createHarness({ optedOut: new Set([VIEWER_ID]) });
  const response = await handler(rankingRequest({ type: "user", userId: VIEWER_ID }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), []);
});

Deno.test("another non-participating user's rankings are forbidden", async () => {
  const { handler, requests } = createHarness({ optedOut: new Set([userId(7)]) });
  const response = await handler(rankingRequest({ type: "user", userId: userId(7) }));
  assertEquals(response.status, 403);
  assert(!requests.some((r) => r.path === "leaderboard_snapshots"));
});

Deno.test("the FLAME gate still applies before any snapshot read", async () => {
  const { handler, requests } = createHarness({ tier: "EMBER" });
  const response = await handler(rankingRequest({ type: "global" }));
  assertEquals(response.status, 402);
  await response.body?.cancel();
  assert(!requests.some((r) => r.path === "leaderboard_snapshots"));
});

Deno.test("an empty snapshot yields empty leaderboards", async () => {
  const { handler } = createHarness({ snapshot: [] });
  const response = await handler(rankingRequest({ type: "global" }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.prCount, []);
  assertEquals(body.totalVolume, []);
});
