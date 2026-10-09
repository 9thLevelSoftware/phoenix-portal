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
  // Browser Origin is scheme + host + port. APP_URL may include a path or a
  // trailing slash; those never appear on Origin. Strava's redirect base stays
  // the raw APP_URL in strava-oauth and is not derived here.
  const origins: string[] = [];
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        origins.push(url.origin);
      }
    } catch {
      // An unparseable APP_URL cannot match a browser Origin header.
    }
  }
  if (shouldAllowLocalhostOrigins(environment, supabaseUrl)) {
    origins.push("http://localhost:5173");
  }
  return origins;
}
