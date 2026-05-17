import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../../supabase/functions/_shared/hmac.ts';
import {
  classifyPaddleEventOrder,
  verifyPaddleCustomDataSignature,
} from '../../supabase/functions/_shared/paddleWebhookSecurity.ts';
import {
  extractGarminProviderUserId,
  resolveGarminWebhookIdentity,
  type GarminIdentityCandidate,
} from '../../supabase/functions/_shared/garminIdentity.ts';

describe('Paddle webhook security helpers', () => {
  it('requires valid signed custom_data for the Paddle user id', async () => {
    const secret = 'paddle-custom-data-secret';
    const userId = 'user-123';
    const cdSig = await hmacSha256Hex(secret, userId);

    await expect(
      verifyPaddleCustomDataSignature(userId, cdSig, secret),
    ).resolves.toBe(true);
    await expect(
      verifyPaddleCustomDataSignature('victim-user', cdSig, secret),
    ).resolves.toBe(false);
    await expect(
      verifyPaddleCustomDataSignature(userId, undefined, secret),
    ).resolves.toBe(false);
  });

  it('rejects stale distinct Paddle events by occurred_at', () => {
    const existing = {
      last_event_id: 'evt_new',
      last_event_occurred_at: '2026-05-17T17:10:00Z',
    };

    expect(
      classifyPaddleEventOrder('evt_new', '2026-05-17T17:00:00Z', existing),
    ).toEqual({ action: 'duplicate' });
    expect(
      classifyPaddleEventOrder('evt_old', '2026-05-17T17:00:00Z', existing),
    ).toEqual({
      action: 'stale',
      occurredAt: '2026-05-17T17:00:00Z',
      lastOccurredAt: '2026-05-17T17:10:00Z',
    });
    expect(
      classifyPaddleEventOrder('evt_same_time', '2026-05-17T17:10:00Z', existing),
    ).toEqual({
      action: 'stale',
      occurredAt: '2026-05-17T17:10:00Z',
      lastOccurredAt: '2026-05-17T17:10:00Z',
    });
    expect(
      classifyPaddleEventOrder('evt_next', '2026-05-17T17:11:00Z', existing),
    ).toEqual({ action: 'accept', occurredAt: '2026-05-17T17:11:00Z' });
  });
});

describe('Garmin webhook identity helpers', () => {
  const candidates: GarminIdentityCandidate[] = [
    {
      user_id: 'attacker-user',
      provider_user_id: 'victim-garmin-id',
      access_token: 'attacker-token',
    },
    {
      user_id: 'victim-user',
      provider_user_id: 'victim-garmin-id',
      access_token: 'victim-token',
    },
  ];

  const decrypt = async (stored: string | null | undefined) => stored;

  it('extracts provider user ids from Garmin OAuth access-token responses', () => {
    expect(
      extractGarminProviderUserId(
        new URLSearchParams('oauth_token=tok&xoauth_garmin_user_id=garmin-123'),
      ),
    ).toBe('garmin-123');
    expect(
      extractGarminProviderUserId(
        new URLSearchParams('oauth_token=tok&user_id=garmin-456'),
      ),
    ).toBe('garmin-456');
  });

  it('does not trust provider_user_id without a matching server-held access token', async () => {
    await expect(
      resolveGarminWebhookIdentity(
        { userId: 'victim-garmin-id', userAccessToken: 'victim-token' },
        [candidates[0]!],
        decrypt,
      ),
    ).resolves.toEqual({ ok: false, reason: 'unbound' });

    await expect(
      resolveGarminWebhookIdentity(
        { userId: 'victim-garmin-id', userAccessToken: 'victim-token' },
        candidates,
        decrypt,
      ),
    ).resolves.toEqual({
      ok: true,
      userId: 'victim-user',
      bindProviderUserId: false,
    });
  });

  it('rejects ambiguous token bindings and safely binds unbound token matches', async () => {
    await expect(
      resolveGarminWebhookIdentity(
        { userId: 'garmin-1', userAccessToken: 'shared-token' },
        [
          { user_id: 'user-1', provider_user_id: null, access_token: 'shared-token' },
          { user_id: 'user-2', provider_user_id: null, access_token: 'shared-token' },
        ],
        decrypt,
      ),
    ).resolves.toEqual({ ok: false, reason: 'ambiguous' });

    await expect(
      resolveGarminWebhookIdentity(
        { userId: 'garmin-1', userAccessToken: 'token-1' },
        [{ user_id: 'user-1', provider_user_id: null, access_token: 'token-1' }],
        decrypt,
      ),
    ).resolves.toEqual({
      ok: true,
      userId: 'user-1',
      bindProviderUserId: true,
    });
  });
});
