export type OAuthRedirectProvider = "strava" | "fitbit" | "garmin";

/**
 * Error raised when `initiate-oauth` refuses to start a connection. `status`
 * is kept so `isTierDenied()` can recognise the 402 the FLAME gate returns
 * (PR 9 review R-5) — before this the raw JSON body was pasted into a toast.
 */
export class OAuthInitiateError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "OAuthInitiateError";
		this.status = status;
	}
}

/**
 * Turn a non-OK `initiate-oauth` response into a readable error. The Edge
 * Functions answer with `{ error, message }`, so prefer `message`, then
 * `error`, and only then a generic fallback.
 */
export async function oauthInitiateError(
	providerLabel: string,
	response: Response,
): Promise<OAuthInitiateError> {
	let body = "";
	try {
		body = await response.text();
	} catch {
		body = "";
	}

	let message = "";
	try {
		const parsed: unknown = JSON.parse(body);
		if (typeof parsed === "object" && parsed !== null) {
			const fields = parsed as { message?: unknown; error?: unknown };
			if (typeof fields.message === "string") message = fields.message;
			else if (typeof fields.error === "string") message = fields.error;
		}
	} catch {
		// Not JSON — fall through to the generic message rather than echoing
		// an HTML error page into a toast.
	}

	if (!message) {
		message = `Could not start the ${providerLabel} connection. Please try again.`;
	}

	return new OAuthInitiateError(message, response.status);
}

/**
 * Providers whose authorization-code grant `complete-oauth` can finish.
 * Garmin is OAuth 1.0a (no `code`), so it is deliberately absent — keep this in
 * step with `COMPLETABLE_PROVIDERS` in supabase/functions/complete-oauth.
 */
export const COMPLETABLE_OAUTH_PROVIDERS = ["strava", "fitbit"] as const;
export type CompletableOAuthProvider =
	(typeof COMPLETABLE_OAUTH_PROVIDERS)[number];

export function isCompletableOAuthProvider(
	value: unknown,
): value is CompletableOAuthProvider {
	return (COMPLETABLE_OAUTH_PROVIDERS as readonly unknown[]).includes(value);
}

/**
 * Error raised when `complete-oauth` refuses to finish a connection. `status`
 * is what `isTierDenied()` reads for the 402 the FLAME gate returns; `code` is
 * the machine-readable slug the Edge Function sends (`state_mismatch`,
 * `already_linked`, …) so the caller can pick a message without parsing prose.
 */
export class OAuthCompletionError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(message: string, status: number, code: string) {
		super(message);
		this.name = "OAuthCompletionError";
		this.status = status;
		this.code = code;
	}
}

/**
 * Finish a provider connection inside the caller's own session (KD-13).
 *
 * The `code` and `state` are sent in the POST body, never in a URL, so they
 * cannot reach browser history, a `Referer` header or an access log. Nothing
 * here logs them, and a failure carries only the server's slug.
 */
export async function completeOAuthConnection(
	accessToken: string,
	params: {
		provider: CompletableOAuthProvider;
		code: string;
		state: string;
	},
): Promise<void> {
	const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
	if (!supabaseUrl) {
		throw new OAuthCompletionError(
			"Supabase is not configured for OAuth.",
			0,
			"not_configured",
		);
	}

	const response = await fetch(`${supabaseUrl}/functions/v1/complete-oauth`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			provider: params.provider,
			code: params.code,
			state: params.state,
		}),
	});

	if (response.ok) return;

	let code = "connection_failed";
	let message = "";
	try {
		const parsed: unknown = JSON.parse(await response.text());
		if (typeof parsed === "object" && parsed !== null) {
			const fields = parsed as { error?: unknown; message?: unknown };
			if (typeof fields.error === "string" && fields.error) code = fields.error;
			if (typeof fields.message === "string") message = fields.message;
		}
	} catch {
		// Not JSON — keep the generic slug rather than surfacing an HTML page.
	}

	throw new OAuthCompletionError(
		message || "Could not finish connecting this account.",
		response.status,
		code,
	);
}

interface OAuthRedirectValidationOptions {
	supabaseUrl?: string;
}

const PROVIDER_RULES: Record<
	Exclude<OAuthRedirectProvider, "garmin">,
	{ hostname: string; pathname: string }
> = {
	strava: {
		hostname: "www.strava.com",
		pathname: "/oauth/authorize",
	},
	fitbit: {
		hostname: "www.fitbit.com",
		pathname: "/oauth2/authorize",
	},
};

function matchesProviderRule(
	parsed: URL,
	provider: Exclude<OAuthRedirectProvider, "garmin">,
): boolean {
	const rule = PROVIDER_RULES[provider];
	return parsed.hostname === rule.hostname && parsed.pathname === rule.pathname;
}

function matchesGarminRule(
	parsed: URL,
	options: OAuthRedirectValidationOptions,
): boolean {
	const supabaseUrl = options.supabaseUrl;
	if (!supabaseUrl) return false;

	let expectedOrigin: string;
	try {
		expectedOrigin = new URL(supabaseUrl).origin;
	} catch {
		return false;
	}

	return (
		parsed.origin === expectedOrigin &&
		parsed.pathname === "/functions/v1/garmin-oauth"
	);
}

function isLocalhostUrl(parsed: URL): boolean {
	return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
}

export function validateOAuthRedirectUrl(
	provider: OAuthRedirectProvider,
	value: unknown,
	options: OAuthRedirectValidationOptions = {},
): string {
	if (typeof value !== "string") {
		throw new Error("OAuth redirect URL missing from server response.");
	}

	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("OAuth redirect URL is invalid.");
	}

	const isAllowedLocalHttp =
		parsed.protocol === "http:" && isLocalhostUrl(parsed);
	if (parsed.protocol !== "https:" && !isAllowedLocalHttp) {
		throw new Error("OAuth redirect URL must use HTTPS.");
	}

	const allowed =
		provider === "garmin"
			? matchesGarminRule(parsed, options)
			: matchesProviderRule(parsed, provider);

	if (!allowed) {
		throw new Error(
			"OAuth redirect URL was not issued for the requested provider.",
		);
	}

	return parsed.toString();
}

export function redirectToValidatedOAuthUrl(
	provider: OAuthRedirectProvider,
	value: unknown,
	options: OAuthRedirectValidationOptions = {},
): void {
	window.location.href = validateOAuthRedirectUrl(provider, value, options);
}
