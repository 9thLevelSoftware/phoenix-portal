export type OAuthRedirectProvider = "strava" | "fitbit" | "garmin";

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
