import { assertEquals } from 'jsr:@std/assert@1';
import { readBoundedRequestBody } from './requestBody.ts';

const encoder = new TextEncoder();

Deno.test('bounded body: declared overflow rejects without consuming input', async () => {
  const request = new Request('http://test.local', { method: 'POST', body: 'small', headers: { 'content-length': '101' } });
  assertEquals(await readBoundedRequestBody(request, 100), { kind: 'too_large' });
  assertEquals(request.bodyUsed, false);
});

Deno.test('bounded body: chunked overflow cancels without retaining further chunks', async () => {
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(4)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request('http://test.local', { method: 'POST', body: stream });
  assertEquals(await readBoundedRequestBody(request, 5), { kind: 'too_large' });
  assertEquals(reads, 2);
  assertEquals(cancelled, true);
});

Deno.test('bounded body: counts UTF-8 bytes and ignores underreported or malformed lengths', async () => {
  for (const declaredLength of ['1', 'invalid', '-1']) {
    const request = new Request('http://test.local', { method: 'POST', body: 'ééé', headers: { 'content-length': declaredLength } });
    assertEquals(await readBoundedRequestBody(request, 5), { kind: 'too_large' });
  }
});

Deno.test('bounded body: boundary-sized bytes are preserved for webhook signatures', async () => {
  const bytes = encoder.encode('\uFEFF{"name":"café 🐦"}\n');
  const request = new Request('http://test.local', { method: 'POST', body: bytes });
  assertEquals(await readBoundedRequestBody(request, bytes.length), { kind: 'ok', bytes });
});

Deno.test('bounded body: empty requests remain supported; stream errors are explicit', async () => {
  assertEquals(await readBoundedRequestBody(new Request('http://test.local', { method: 'POST' }), 10), { kind: 'ok', bytes: new Uint8Array() });
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('untrusted input')); } });
  assertEquals(await readBoundedRequestBody(new Request('http://test.local', { method: 'POST', body: stream }), 10), { kind: 'read_failure' });
});
