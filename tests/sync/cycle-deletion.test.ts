import { describe, it, expect } from 'vitest';
import { pushPayloadSchema } from '../../supabase/functions/_shared/pushPayloadSchema';

describe('pushPayloadSchema - deletedCycleIds', () => {
  it('accepts valid deletedCycleIds array', () => {
    const payload = {
      deviceId: 'test-device',
      platform: 'android',
      lastSync: 0,
      deletedCycleIds: ['550e8400-e29b-41d4-a716-446655440000'],
    };
    const result = pushPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCycleIds).toHaveLength(1);
    }
  });

  it('defaults deletedCycleIds to empty array when missing', () => {
    const payload = {
      deviceId: 'test-device',
      platform: 'android',
      lastSync: 0,
    };
    const result = pushPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCycleIds).toEqual([]);
    }
  });

  it('rejects non-UUID strings in deletedCycleIds', () => {
    const payload = {
      deviceId: 'test-device',
      platform: 'android',
      lastSync: 0,
      deletedCycleIds: ['not-a-uuid'],
    };
    const result = pushPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
