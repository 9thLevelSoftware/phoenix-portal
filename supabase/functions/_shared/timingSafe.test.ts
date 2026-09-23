import { assertEquals } from "jsr:@std/assert@1";
import { isServiceRoleBearer, timingSafeEqualString } from "./timingSafe.ts";

Deno.test("timingSafe: equal strings match, byte differences do not", () => {
  assertEquals(timingSafeEqualString({ expected: "s3cr3t", provided: "s3cr3t" }), true);
  assertEquals(timingSafeEqualString({ expected: "s3cr3t", provided: "s3cr3T" }), false);
  assertEquals(timingSafeEqualString({ expected: "s3cr3t", provided: "S3cr3t" }), false);
});

Deno.test("timingSafe: a length difference is folded in, not short-circuited", () => {
  // A repeating-prefix guess is the case an index-modulo comparison gets
  // wrong if the length difference is not part of the accumulator: every byte
  // of `provided` matches `expected[i % expected.length]`, so only the length
  // XOR can reject it.
  assertEquals(timingSafeEqualString({ expected: "ab", provided: "abab" }), false);
  assertEquals(timingSafeEqualString({ expected: "ab", provided: "ababab" }), false);
  assertEquals(timingSafeEqualString({ expected: "abc", provided: "abcabc" }), false);

  // Plain prefixes/suffixes in both directions.
  assertEquals(timingSafeEqualString({ expected: "abcd", provided: "abc" }), false);
  assertEquals(timingSafeEqualString({ expected: "abc", provided: "abcd" }), false);
});

Deno.test("timingSafe: empty operands never throw and never match a non-empty one", () => {
  // A regression guard against a rewrite that THROWS (or matches) on an empty
  // secret — not against removing the `a.length === 0` early return, which is
  // an equivalent mutant: `a[NaN]` reads `undefined`, `undefined ^ x === x`,
  // and `diff` is already non-zero here. The length fold is the only
  // value-level proxy for the hardening; see the note in timingSafe.ts.
  assertEquals(timingSafeEqualString({ expected: "", provided: "" }), true);
  assertEquals(timingSafeEqualString({ expected: "", provided: "x" }), false);
  assertEquals(timingSafeEqualString({ expected: "x", provided: "" }), false);
});

Deno.test("timingSafe: comparison is over UTF-8 bytes", () => {
  assertEquals(timingSafeEqualString({ expected: "héllo", provided: "héllo" }), true);
  assertEquals(timingSafeEqualString({ expected: "héllo", provided: "hello" }), false);
  // 'é' is two UTF-8 bytes, so these differ in byte length as well.
  assertEquals(timingSafeEqualString({ expected: "é", provided: "e" }), false);
});

Deno.test("isServiceRoleBearer: only the exact bearer is accepted", () => {
  assertEquals(isServiceRoleBearer("Bearer key", "key"), true);
  assertEquals(isServiceRoleBearer("Bearer key ", "key"), false);
  assertEquals(isServiceRoleBearer("Bearer ke", "key"), false);
  assertEquals(isServiceRoleBearer("bearer key", "key"), false);
  assertEquals(isServiceRoleBearer("key", "key"), false);
});

Deno.test("isServiceRoleBearer: an unset or blank key never matches", () => {
  // Defence in depth for callers that do not source the header from a
  // `Headers` object (which normalises the trailing space away, making
  // "Bearer " unreachable over HTTP — see the note on isServiceRoleBearer).
  assertEquals(isServiceRoleBearer("Bearer ", undefined), false);
  assertEquals(isServiceRoleBearer("Bearer ", ""), false);
  assertEquals(isServiceRoleBearer("Bearer undefined", undefined), false);
  assertEquals(isServiceRoleBearer(null, "key"), false);
});
