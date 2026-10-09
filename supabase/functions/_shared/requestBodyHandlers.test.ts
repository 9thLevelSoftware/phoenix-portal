import { assertEquals } from 'jsr:@std/assert@1';
import { createDeleteAccountHandler } from '../delete-account/index.ts';
import { createGenerateInsightsHandler } from '../generate-insights/index.ts';
import { createGarminWebhookHandler } from '../garmin-webhook/index.ts';
import { createPaddleWebhooksHandler } from '../paddle-webhooks/index.ts';
import { REQUEST_BODY_LIMITS } from './requestBody.ts';
import { hmacSha256Hex } from './hmac.ts';

const SECRET = 'test-signing-secret';
const ENV: Record<string, string> = {
  GARMIN_WEBHOOK_SECRET: SECRET,
  CRON_SECRET: SECRET,
  PADDLE_CUSTOM_DATA_SECRET: SECRET,
  PADDLE_WEBHOOK_SECRET: SECRET,
  PADDLE_EMBER_PRICE_IDS: 'pri_ember',
  PADDLE_FLAME_PRICE_IDS: 'pri_flame',
  PADDLE_INFERNO_PRICE_IDS: 'pri_inferno',
};
const noDatabase = (): never => { throw new Error('Unexpected privileged work before body guard'); };
const handlers = [
  {
    name: 'delete-account', limit: REQUEST_BODY_LIMITS.deleteAccount, header: 'x-cron-secret', value: SECRET,
    handler: createDeleteAccountHandler({ env: (key) => ENV[key], createAdminClient: noDatabase, createAuthClient: noDatabase, purge: noDatabase }),
  },
  {
    name: 'generate-insights', limit: REQUEST_BODY_LIMITS.generateInsights, header: 'x-cron-secret', value: SECRET,
    handler: createGenerateInsightsHandler({ env: (key) => ENV[key], createAdminClient: noDatabase, createUserClient: noDatabase, now: () => new Date() }),
  },
  {
    name: 'garmin-webhook', limit: REQUEST_BODY_LIMITS.garminWebhook, header: 'x-garmin-signature', value: 'a'.repeat(64),
    handler: createGarminWebhookHandler({ env: (key) => ENV[key], createAdminClient: noDatabase }),
  },
  {
    name: 'paddle-webhooks', limit: REQUEST_BODY_LIMITS.paddleWebhook, header: 'Paddle-Signature', value: 'ts=1;h1=' + 'a'.repeat(64),
    handler: createPaddleWebhooksHandler({ env: { get: (key) => ENV[key] }, createAdminClient: noDatabase, now: () => 1000, fetch: noDatabase }),
  },
];

for (const endpoint of handlers) {
  Deno.test(`${endpoint.name}: missing credentials reject without consuming a body`, async () => {
    const request = new Request('http://test.local', { method: 'POST', body: '{malformed' });
    assertEquals((await endpoint.handler(request)).status, 401);
    assertEquals(request.bodyUsed, false);
  });
  Deno.test(`${endpoint.name}: declared overflow rejects before parse, signature or privileged work`, async () => {
    const request = new Request('http://test.local', { method: 'POST', body: 'small', headers: {
      [endpoint.header]: endpoint.value, 'content-length': String(endpoint.limit + 1),
    } });
    assertEquals((await endpoint.handler(request)).status, 413);
    assertEquals(request.bodyUsed, false);
  });
  Deno.test(`${endpoint.name}: streamed overflow rejects before parse, signature or privileged work`, async () => {
    const request = new Request('http://test.local', { method: 'POST', body: new Uint8Array(endpoint.limit + 1), headers: {
      [endpoint.header]: endpoint.value,
    } });
    assertEquals((await endpoint.handler(request)).status, 413);
  });
}

Deno.test('paddle body: boundary-sized signed Unicode payload verifies without reserialization', async () => {
  const raw = JSON.stringify({ event_id: 'evt_test', event_type: 'unhandled', data: { name: 'café 🐦' } });
  const body = raw + ' '.repeat(REQUEST_BODY_LIMITS.paddleWebhook - new TextEncoder().encode(raw).length);
  const signature = await hmacSha256Hex(SECRET, `1:${body}`);
  const response = await handlers[3].handler(new Request('http://test.local', { method: 'POST', body,
    headers: { 'Paddle-Signature': `ts=1;h1=${signature}` } }));
  assertEquals(response.status, 200);
});

Deno.test('webhook body: HMAC covers the original UTF-8 BOM rather than decoded text', async () => {
  const raw = '\uFEFF' + JSON.stringify({ event_id: 'evt_test', event_type: 'unhandled', data: {}, activities: [] });
  for (const name of ['garmin-webhook', 'paddle-webhooks']) {
    const endpoint = handlers.find((item) => item.name === name)!;
    for (const includeBom of [true, false]) {
      const signedBody = includeBom ? raw : raw.slice(1);
      const signature = await hmacSha256Hex(SECRET, name === 'paddle-webhooks' ? `1:${signedBody}` : signedBody);
      const request = new Request('http://test.local', { method: 'POST', body: new TextEncoder().encode(raw),
        headers: { [endpoint.header]: name === 'paddle-webhooks' ? `ts=1;h1=${signature}` : signature } });
      // Valid Garmin requests construct the client before examining activities.
      if (name === 'garmin-webhook' && includeBom) {
        const response = await createGarminWebhookHandler({ env: (key) => ENV[key], createAdminClient: () => ({}) as never })(request);
        assertEquals(response.status, 200);
      } else {
        assertEquals((await endpoint.handler(request)).status, includeBom ? 200 : 401);
      }
    }
  }
});
