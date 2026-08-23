export interface GarminWebhookIdentity {
  userId?: string;
  userAccessToken?: string;
}

export interface GarminIdentityCandidate {
  user_id: string;
  provider_user_id: string | null;
  access_token: string | null | undefined;
}

export type GarminIdentityResolution =
  | { ok: true; userId: string; bindProviderUserId: boolean }
  | {
      ok: false;
      reason:
        | "missing_identity"
        | "unbound"
        | "ambiguous"
        | "provider_user_id_mismatch";
    };

function timingSafeEqual(aValue: string, bValue: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(aValue);
  const b = encoder.encode(bValue);
  let mismatch = a.length !== b.length ? 1 : 0;
  // Iterate to the longer length, substituting 0 for out-of-range bytes, so that
  // comparison work does not depend on the shorter input's length (avoids leaking
  // candidate token length via timing).
  const cmpLen = Math.max(a.length, b.length);
  for (let i = 0; i < cmpLen; i++) {
    const av = i < a.length ? a[i]! : 0;
    const bv = i < b.length ? b[i]! : 0;
    mismatch |= av ^ bv;
  }
  return mismatch === 0;
}

export function extractGarminProviderUserId(
  responseParams: URLSearchParams,
): string | null {
  return (
    responseParams.get("xoauth_garmin_user_id") ??
    responseParams.get("user_id") ??
    responseParams.get("userId") ??
    responseParams.get("userid")
  );
}

export async function resolveGarminWebhookIdentity(
  activity: GarminWebhookIdentity,
  candidates: GarminIdentityCandidate[],
  decryptAccessToken: (
    stored: string | null | undefined,
  ) => Promise<string | null | undefined>,
): Promise<GarminIdentityResolution> {
  if (!activity.userId || !activity.userAccessToken) {
    return { ok: false, reason: "missing_identity" };
  }

  const matches: GarminIdentityCandidate[] = [];
  for (const candidate of candidates) {
    let accessToken: string | null | undefined;
    try {
      accessToken = await decryptAccessToken(candidate.access_token);
    } catch (decryptError) {
      // A single corrupt/stale token row must not fail identity resolution for
      // every other candidate. Skip this candidate and keep checking the rest.
      console.error(
        `[garminIdentity] failed to decrypt token for candidate user ${candidate.user_id}; skipping:`,
        decryptError,
      );
      continue;
    }
    if (accessToken && timingSafeEqual(accessToken, activity.userAccessToken)) {
      matches.push(candidate);
    }
  }

  if (matches.length === 0) {
    return { ok: false, reason: "unbound" };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous" };
  }

  const match = matches[0]!;
  if (match.provider_user_id && match.provider_user_id !== activity.userId) {
    return { ok: false, reason: "provider_user_id_mismatch" };
  }

  return {
    ok: true,
    userId: match.user_id,
    bindProviderUserId: !match.provider_user_id,
  };
}

const TOKEN_SHAPED_KEY = /token/i;

/** Strip token-shaped keys from objects and arrays before persisting JSONB. */
export function redactTokenShapedJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactTokenShapedJson);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (TOKEN_SHAPED_KEY.test(key)) {
        continue;
      }
      out[key] = redactTokenShapedJson(nested);
    }
    return out;
  }
  return value;
}

/**
 * Strip OAuth tokens from Garmin webhook JSON before it is stored in
 * browser-readable `external_activities.raw_data`.
 */
export function redactGarminRawData(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return redactTokenShapedJson(value) as Record<string, unknown>;
}

/** Persist-path shape used by garmin-webhook upserts. */
export function buildGarminWebhookPersistRow(
  userId: string,
  activity: Record<string, unknown>,
  normalized: Record<string, unknown>,
  syncedAt: string,
): Record<string, unknown> {
  return {
    user_id: userId,
    ...normalized,
    raw_data: redactGarminRawData(activity),
    synced_at: syncedAt,
  };
}
