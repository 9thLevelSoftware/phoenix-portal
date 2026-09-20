import { assertEquals } from "jsr:@std/assert@1";
import { isServiceRoleBearer, timingSafeEqualString } from "./timingSafe.ts";

Deno.test("timingSafe: equal strings match, byte differences do not", () => {
  assertEquals(timingSafeEqualString("s3cr3t", "s3cr3t"), true);
  assertEquals(timingSafeEqualString("s3cr3t", "s3cr3T"), false);
  assertEquals(timingSafeEqualString("s3cr3t", "S3cr3t"), false);
});

Deno.test("timingSafe: a length difference is folded in, not short-circuited", () => {
  // A repeating-prefix guess is the case an index-modulo comparison gets
  // wrong if the length difference is not part of the accumulator: every byte
  // of `provided` matches `expected[i % expected.length]`, so only the length
  // XOR can reject it.
  assertEquals(timingSafeEqualString("ab", "abab"), false);
  assertEquals(timingSafeEqualString("ab", "ababab"), false);
  assertEquals(timingSafeEqualString("abc", "abcabc"), false);

  // Plain prefixes/suffixes in both directions.
  assertEquals(timingSafeEqualString("abcd", "abc"), false);
  assertEquals(timingSafeEqualString("abc", "abcd"), false);
});

Deno.test("timingSafe: empty operands never throw and never match a non-empty one", () => {
  // The expected value is indexed modulo its own length; an empty secret must
  // not divide by zero or NaN its way to a match.
  assertEquals(timingSafeEqualString("", ""), true);
  assertEquals(timingSafeEqualString("", "x"), false);
  assertEquals(timingSafeEqualString("x", ""), false);
});

Deno.test("timingSafe: comparison is over UTF-8 bytes", () => {
  assertEquals(timingSafeEqualString("héllo", "héllo"), true);
  assertEquals(timingSafeEqualString("héllo", "hello"), false);
  // 'é' is two UTF-8 bytes, so these differ in byte length as well.
  assertEquals(timingSafeEqualString("é", "e"), false);
});

Deno.test("isServiceRoleBearer: only the exact bearer is accepted", () => {
  assertEquals(isServiceRoleBearer("Bearer key", "key"), true);
  assertEquals(isServiceRoleBearer("Bearer key ", "key"), false);
  assertEquals(isServiceRoleBearer("Bearer ke", "key"), false);
  assertEquals(isServiceRoleBearer("bearer key", "key"), false);
  assertEquals(isServiceRoleBearer("key", "key"), false);
});

Deno.test("isServiceRoleBearer: an unset or blank key never matches", () => {
  // Without the guard, `Bearer ${undefined ?? ''}` would let the literal
  // header "Bearer " authenticate as the service role.
  assertEquals(isServiceRoleBearer("Bearer ", undefined), false);
  assertEquals(isServiceRoleBearer("Bearer ", ""), false);
  assertEquals(isServiceRoleBearer("Bearer undefined", undefined), false);
  assertEquals(isServiceRoleBearer(null, "key"), false);
});
