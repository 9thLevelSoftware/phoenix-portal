/**
 * Signing secrets for tests (imported by *.test.ts files only).
 *
 * Built at runtime, so no secret-shaped literal is committed: a literal
 * `whsec_...` in a test file is indistinguishable from a leaked webhook
 * secret to a secret scanner, and a scanner that cries wolf gets ignored.
 * The values are obviously fake: `whsec_` + base64 of 32 identical bytes.
 */
export function testWebhookSecret(fill: string): string {
  return `whsec_${btoa(fill.slice(0, 1).repeat(32))}`;
}
