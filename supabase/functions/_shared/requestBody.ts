/** Bound allocation by actual wire bytes, including requests without Content-Length. */
export type BodyReadResult =
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'too_large' }
  | { kind: 'read_failure' };

export async function readBoundedRequestBody(request: Request, limit: number): Promise<BodyReadResult> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && /^[0-9]+$/.test(declaredLength) && Number(declaredLength) > limit) {
    return { kind: 'too_large' };
  }
  if (request.body === null) return { kind: 'ok', bytes: new Uint8Array() };
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return { kind: 'read_failure' };
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        // Do not await an untrusted stream's cancellation promise.
        void reader.cancel().catch(() => {});
        return { kind: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: 'read_failure' };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', bytes };
}

export const REQUEST_BODY_LIMITS = {
  deleteAccount: 4 * 1024,
  generateInsights: 16 * 1024,
  garminWebhook: 1024 * 1024,
  paddleWebhook: 1024 * 1024,
  // Five parity ID lists may each contain 10,000 UUIDs (~1.95 MB total).
  mobileSyncPull: 3 * 1024 * 1024,
} as const;
