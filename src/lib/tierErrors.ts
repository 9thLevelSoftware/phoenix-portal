/**
 * Recognising a server-side tier denial (PR 9 review R-5).
 *
 * Route gates are UX only. A user reaches a FLAME write with a FREE/EMBER
 * server tier whenever the client and the server disagree — the subscription
 * query is cached for 5 minutes, so a plan that lapses or is downgraded while
 * a Flame page is open leaves the UI unlocked. The write then fails as:
 *
 *   - PostgREST 42501 (`new row violates row-level security policy`) for a
 *     direct table INSERT / UPDATE;
 *   - a `FLAME_REQUIRED` P0001 from the `import_shared_*` RPCs;
 *   - HTTP 402 from an Edge Function behind `requireSubscription`.
 *
 * All three mean the same thing to the user, so they map to one message and
 * one action: tell them, and refetch the subscription so the route gate
 * catches up.
 */

export const TIER_DENIED_MESSAGE =
	"This needs Flame — your plan no longer covers it. See plans to continue.";

function statusOf(value: unknown): number | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const status = (value as { status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

/**
 * True when `error` is the server refusing a write because the user's
 * subscription tier is too low.
 */
export function isTierDenied(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;

	const candidate = error as {
		code?: unknown;
		message?: unknown;
		context?: unknown;
	};

	// PostgREST / PostgreSQL: insufficient_privilege from an RLS policy.
	if (candidate.code === "42501") return true;

	// The import RPCs raise `FLAME_REQUIRED`; requireSubscription's 402 body
	// uses `subscription_required`.
	if (typeof candidate.message === "string") {
		if (candidate.message.includes("FLAME_REQUIRED")) return true;
		if (candidate.message.includes("subscription_required")) return true;
	}

	// supabase.functions.invoke rejects with a FunctionsHttpError whose
	// `context` is the raw Response; our own fetch-based OAuth starters throw
	// an Error carrying `status`.
	return statusOf(error) === 402 || statusOf(candidate.context) === 402;
}
