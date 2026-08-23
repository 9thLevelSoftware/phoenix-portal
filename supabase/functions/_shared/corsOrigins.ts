/** Hosted project URLs must never treat unset ENVIRONMENT as a localhost CORS license. */
export function isHostedSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "supabase.co" || hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

export function shouldAllowLocalhostOrigins(
  environment: string | undefined,
  supabaseUrl: string | undefined,
): boolean {
  if (environment === "production") return false;
  if (isHostedSupabaseUrl(supabaseUrl)) return false;
  return true;
}

export function buildAllowedOrigins(
  appUrl: string | undefined,
  environment: string | undefined,
  supabaseUrl: string | undefined,
): string[] {
  const origins: string[] = appUrl ? [appUrl] : [];
  if (shouldAllowLocalhostOrigins(environment, supabaseUrl)) {
    origins.push("http://localhost:5173", "http://localhost:3000");
  }
  return origins;
}
