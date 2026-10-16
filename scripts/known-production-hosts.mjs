/**
 * Exact hostnames that sync preview tooling and live sync tests refuse.
 * Imported by the preview scripts and tests/sync/setup.ts.
 *
 * `ilzlswmatadlnsuxatcv` is the live production project. `.supabase.in` is
 * its regional hostname beside `.supabase.co`.
 */
export const KNOWN_PRODUCTION_HOSTS = new Set([
	"ilzlswmatadlnsuxatcv.supabase.co",
	"ilzlswmatadlnsuxatcv.supabase.in",
	"api.phoenix-portal.com",
]);
