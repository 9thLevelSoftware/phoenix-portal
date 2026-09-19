import { assertEquals } from "jsr:@std/assert@1";
import {
  computeIncrementalWindow,
  DEFAULT_INCREMENTAL_LOOKBACK_HOURS,
} from "./incrementalWindow.ts";

const HOUR = 60 * 60 * 1000;

Deno.test("computeIncrementalWindow returns null with no anchors", () => {
  assertEquals(computeIncrementalWindow({ lastWatermark: null }), null);
  assertEquals(
    computeIncrementalWindow({ lastWatermark: undefined, maxStoredStartedAt: "not a date" }),
    null,
  );
});

Deno.test("computeIncrementalWindow defaults to a 72h lookback", () => {
  assertEquals(DEFAULT_INCREMENTAL_LOOKBACK_HOURS, 72);
  const window = computeIncrementalWindow({ lastWatermark: "2026-09-10T12:00:00.000Z" });
  assertEquals(
    window?.after.toISOString(),
    new Date(Date.parse("2026-09-10T12:00:00.000Z") - 72 * HOUR).toISOString(),
  );
});

Deno.test("computeIncrementalWindow anchors on the earlier of watermark and newest stored start", () => {
  const olderStored = computeIncrementalWindow({
    lastWatermark: "2026-09-10T12:00:00.000Z",
    maxStoredStartedAt: "2026-09-01T08:00:00.000Z",
    lookbackHours: 1,
  });
  assertEquals(olderStored?.after.toISOString(), "2026-09-01T07:00:00.000Z");
  assertEquals(olderStored?.anchor.toISOString(), "2026-09-01T08:00:00.000Z");

  const olderWatermark = computeIncrementalWindow({
    lastWatermark: "2026-08-01T00:00:00.000Z",
    maxStoredStartedAt: "2026-09-01T08:00:00.000Z",
    lookbackHours: 0,
  });
  assertEquals(olderWatermark?.after.toISOString(), "2026-08-01T00:00:00.000Z");
});

Deno.test("computeIncrementalWindow uses stored rows when there is no watermark", () => {
  const window = computeIncrementalWindow({
    lastWatermark: null,
    maxStoredStartedAt: "2026-09-01T08:00:00.000Z",
    lookbackHours: 2,
  });
  assertEquals(window?.after.toISOString(), "2026-09-01T06:00:00.000Z");
});
