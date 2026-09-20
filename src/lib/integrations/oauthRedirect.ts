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
