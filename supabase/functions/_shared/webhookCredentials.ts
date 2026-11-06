/**
 * Reads and decrypts one endpoint's signing secrets and custom header.
 *
 * The only reader of webhook_endpoint_secrets. Every lookup is scoped by the
 * endpoint id AND its owner's user id, so a caller holding the wrong user id
 * gets nothing (FP-1). Plaintext exists only in the returned object; callers
 * must not log it or put it in a response (FP-5).
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface WebhookCredentials {
  /** Current secret first, then the previous one while its overlap lasts. */
  secrets: string[];
  customHeader: { name: string; value: string } | null;
}

export type WebhookCredentialsResult =
  | { ok: true; credentials: WebhookCredentials }
  | { ok: false; reason: 'not_found' | 'read_failed' | 'decrypt_failed' };

export type SecretDecryptor = (stored: string) => Promise<string | null | undefined>;

export async function loadWebhookCredentials(
  admin: SupabaseClient,
  params: { userId: string; endpointId: string; customHeaderName: string | null; now: Date },
  decrypt: SecretDecryptor,
): Promise<WebhookCredentialsResult> {
  const { data, error } = await admin
    .from('webhook_endpoint_secrets')
    .select('signing_secret_enc, previous_signing_secret_enc, previous_expires_at, custom_header_value_enc')
    .eq('endpoint_id', params.endpointId)
    .eq('user_id', params.userId)
    .maybeSingle();
  if (error) return { ok: false, reason: 'read_failed' };
  if (!data) return { ok: false, reason: 'not_found' };

  const row = data as {
    signing_secret_enc: string;
    previous_signing_secret_enc: string | null;
    previous_expires_at: string | null;
    custom_header_value_enc: string | null;
  };

  try {
    const current = await decrypt(row.signing_secret_enc);
    if (!current) return { ok: false, reason: 'decrypt_failed' };
    const secrets = [current];

    const previousLive = row.previous_signing_secret_enc !== null &&
      row.previous_expires_at !== null &&
      Date.parse(row.previous_expires_at) > params.now.getTime();
    if (previousLive) {
      // The previous secret only smooths a rotation. If it cannot be read,
      // deliveries still go out signed with the current one; failing here
      // would stop every delivery over a secret that is being retired.
      try {
        const previous = await decrypt(row.previous_signing_secret_enc!);
        if (previous) secrets.push(previous);
      } catch {
        // Signed with the current secret only.
      }
    }

    let customHeader: WebhookCredentials['customHeader'] = null;
    if (params.customHeaderName !== null && row.custom_header_value_enc !== null) {
      const value = await decrypt(row.custom_header_value_enc);
      if (!value) return { ok: false, reason: 'decrypt_failed' };
      customHeader = { name: params.customHeaderName, value };
    }
    return { ok: true, credentials: { secrets, customHeader } };
  } catch {
    return { ok: false, reason: 'decrypt_failed' };
  }
}
