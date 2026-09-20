import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Card } from "@/app/components/ui/card";
import { useAuth } from "@/app/hooks/useAuth";
import {
	type CompletableOAuthProvider,
	completeOAuthConnection,
	isCompletableOAuthProvider,
	OAuthCompletionError,
} from "@/lib/integrations/oauthRedirect";
import { isTierDenied } from "@/lib/tierErrors";
import { PhoenixLogo } from "./PhoenixLogo";

/**
 * Session-bound OAuth completion landing page (KD-13).
 *
 * Live since PR 48: `strava-oauth` relays the provider's response here instead
 * of exchanging it, so the exchange happens inside the signed-in session that
 * started the flow.
 *
 * A signed-out browser never reaches this component: `ProtectedRoute` sends it
 * to `/` with `replace`, so the `code` and `state` are dropped — not stashed,
 * and not left in history either. That is the deliberate choice (PR 48). The
 * only way to land here signed out is for the session to lapse between pressing
 * Connect and approving on the provider; the user reconnects with one click,
 * the unusable `code` expires on the provider's side, and the state row expires
 * within ten minutes. Preserving the return path would mean writing the `code`
 * and `state` into `sessionStorage` or a login URL to survive the round trip —
 * a strictly worse place for them than nowhere.
 *
 * The page never keeps `code` or `state` in the URL. It reads them once and
 * immediately rewrites the address with `history.replaceState`, so they stay
 * out of browser history, out of any `Referer` this page sends, and out of
 * anything that samples `location.href` (PR 63 already scrubs both names from
 * Sentry events). They then travel in a POST body, never a query string.
 */

/** `<meta name="referrer">` belt-and-braces while the params are still live. */
function applyNoReferrerMeta(): void {
	if (typeof document === "undefined") return;
	if (document.querySelector('meta[name="referrer"]')) return;
	const meta = document.createElement("meta");
	meta.setAttribute("name", "referrer");
	meta.setAttribute("content", "no-referrer");
	document.head.appendChild(meta);
}

interface CapturedParams {
	provider: CompletableOAuthProvider | null;
	code: string | null;
	state: string | null;
	/** A provider-reported failure (e.g. the user pressed Deny). */
	providerError: string | null;
}

/** Reads the OAuth params, then strips them from the address bar. */
function captureAndStripParams(): CapturedParams {
	const params = new URLSearchParams(window.location.search);
	const provider = params.get("provider");
	const captured: CapturedParams = {
		provider: isCompletableOAuthProvider(provider) ? provider : null,
		code: params.get("code"),
		state: params.get("state"),
		providerError: params.get("error"),
	};

	window.history.replaceState(null, "", window.location.pathname);

	return captured;
}

function failureCode(error: unknown): string {
	if (isTierDenied(error)) return "subscription_required";
	if (error instanceof OAuthCompletionError) return error.code;
	return "connection_failed";
}

export function IntegrationsCallback() {
	const navigate = useNavigate();
	const { session } = useAuth();
	const accessToken = session?.access_token ?? "";
	// A ref, not state: React keeps refs across StrictMode's simulated remount,
	// so the single-use state token is posted exactly once.
	const startedRef = useRef(false);

	useEffect(() => {
		if (startedRef.current) return;
		// ProtectedRoute holds this route until auth resolves, but a token can
		// still arrive a tick late. Leave the params in place until it does.
		if (!accessToken) return;
		startedRef.current = true;

		applyNoReferrerMeta();
		const captured = captureAndStripParams();

		const finish = (query: string) => {
			navigate(`/integrations?${query}`, { replace: true });
		};

		if (captured.providerError) {
			finish("error=access_denied");
			return;
		}

		if (!captured.provider || !captured.code || !captured.state) {
			finish("error=missing_params");
			return;
		}

		const provider = captured.provider;
		completeOAuthConnection(accessToken, {
			provider,
			code: captured.code,
			state: captured.state,
		})
			.then(() => {
				// `provider` is one of the two literals, never the raw URL value.
				finish(`connected=${provider}`);
			})
			.catch((error: unknown) => {
				finish(`error=${failureCode(error)}`);
			});
	}, [accessToken, navigate]);

	return (
		<div className="flex min-h-[60vh] items-center justify-center px-4">
			<Card className="w-full max-w-md bg-surface-2 border-secondary p-8 text-center">
				<div className="mb-8 flex items-center justify-center gap-2">
					<PhoenixLogo size="sm" animated={false} />
					<span className="text-xl font-semibold text-primary">
						Phoenix Portal
					</span>
				</div>

				<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
					<Loader2 className="h-6 w-6 animate-spin text-primary" />
				</div>

				<h1 className="mb-2 text-2xl font-semibold text-white">
					Finishing the connection
				</h1>
				<p className="text-sm text-muted-foreground">
					Hang on while Phoenix Portal links your account.
				</p>
			</Card>
		</div>
	);
}
