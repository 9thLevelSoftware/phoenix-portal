import { assertEquals } from "jsr:@std/assert@1";
import { nextWatermark } from "./syncWatermark.ts";

const END = "2026-09-19T12:00:00.000Z";
const PREV = "2026-09-12T12:00:00.000Z";

Deno.test("syncWatermark: an initial with an existing watermark leaves it alone", () => {
  assertEquals(nextWatermark({ syncType: "initial", previous: PREV, contiguousUpTo: END }), null);
});

Deno.test("syncWatermark: a first initial (no watermark) sets it", () => {
  assertEquals(nextWatermark({ syncType: "initial", previous: null, contiguousUpTo: END }), END);
});

Deno.test("syncWatermark: incremental and manual runs advance to the contiguous end", () => {
  for (const syncType of ["incremental", "manual"]) {
    assertEquals(nextWatermark({ syncType, previous: PREV, contiguousUpTo: END }), END);
  }
});
