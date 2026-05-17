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
  const cmpLen = Math.min(a.length, b.length);
  for (let i = 0; i < cmpLen; i++) {
    mismatch |= a[i]! ^ b[i]!;
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
    const accessToken = await decryptAccessToken(candidate.access_token);
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
