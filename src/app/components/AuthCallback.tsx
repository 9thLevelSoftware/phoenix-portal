import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { type SocialAuthProvider, supabase } from "@/lib/supabase";
import { PhoenixLogo } from "./PhoenixLogo";

type CallbackParams = {
	error: string | null;
	errorDescription: string | null;
	provider: SocialAuthProvider | null;
};

function getProviderLabel(provider: SocialAuthProvider | null): string {
	if (provider === "apple") {
		return "Apple";
	}

	if (provider === "google") {
		return "Google";
	}

	return "Social";
}

function parseCallbackParams(search: string, hash: string): CallbackParams {
	const searchParams = new URLSearchParams(search);
	const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
	const provider = searchParams.get("provider");

	return {
		error:
			hashParams.get("error") ??
			searchParams.get("error") ??
			hashParams.get("error_code") ??
			searchParams.get("error_code"),
		errorDescription:
			hashParams.get("error_description") ??
			searchParams.get("error_description"),
		provider: provider === "apple" || provider === "google" ? provider : null,
	};
}

export function AuthCallback() {
	const location = useLocation();
	const navigate = useNavigate();
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const callbackParams = useMemo(
		() => parseCallbackParams(location.search, location.hash),
		[location.hash, location.search],
	);

	useEffect(() => {
		if (callbackParams.error || callbackParams.errorDescription) {
			setErrorMessage(
				callbackParams.errorDescription ??
					"Authentication could not be completed. Please try again.",
			);
			return;
		}

		let isActive = true;

		// Listen for a late SIGNED_IN as well as polling, so slow OAuth callback
		// processing doesn't prematurely fail.
		const { data: authListener } = supabase.auth.onAuthStateChange(
			(_event, session) => {
				if (isActive && session?.user) {
					navigate("/dashboard", { replace: true });
				}
			},
		);

		const resolveSession = async () => {
			// Give Supabase up to ~6s (20 attempts) to surface a session before
			// declaring failure; covers slow devices/storage/OAuth processing.
			const MAX_ATTEMPTS = 20;
			try {
				for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
					const {
						data: { session },
						error,
					} = await supabase.auth.getSession();

					if (!isActive) {
						return;
					}

					if (error) {
						setErrorMessage(error.message);
						return;
					}

					if (session?.user) {
						navigate("/dashboard", { replace: true });
						return;
					}

					if (attempt < MAX_ATTEMPTS - 1) {
						await new Promise((resolve) => window.setTimeout(resolve, 300));
					}
				}

				if (isActive) {
					setErrorMessage("Authentication did not complete. Please try again.");
				}
			} catch (_err) {
				if (isActive) {
					setErrorMessage(
						"Authentication could not be completed. Please try again.",
					);
				}
			}
		};

		void resolveSession();

		return () => {
			isActive = false;
			authListener.subscription.unsubscribe();
		};
	}, [callbackParams.error, callbackParams.errorDescription, navigate]);

	const providerLabel = getProviderLabel(callbackParams.provider);

	if (!errorMessage) {
		return (
			<div className="min-h-screen bg-background flex items-center justify-center px-4">
				<Card className="w-full max-w-md p-8 bg-surface-2 border-secondary text-center">
					<div className="flex items-center justify-center gap-2 mb-8">
						<PhoenixLogo size="sm" animated={false} />
						<span className="text-xl text-primary font-semibold">
							Phoenix Portal
						</span>
					</div>

					<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
						<Loader2 className="w-6 h-6 text-primary animate-spin" />
					</div>

					<h1 className="text-2xl font-semibold text-white mb-2">
						Finishing {providerLabel} sign-in
					</h1>
					<p className="text-sm text-muted-foreground">
						Hang on while Phoenix Portal completes your authentication.
					</p>
				</Card>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background flex items-center justify-center px-4">
			<Card className="w-full max-w-md p-8 bg-surface-2 border-secondary text-center">
				<div className="flex items-center justify-center gap-2 mb-8">
					<PhoenixLogo size="sm" animated={false} />
					<span className="text-xl text-primary font-semibold">
						Phoenix Portal
					</span>
				</div>

				<h1 className="text-2xl font-semibold text-white mb-2">
					{providerLabel} sign-in failed
				</h1>
				<p className="text-sm text-red-300 mb-6">{errorMessage}</p>

				<Button
					type="button"
					variant="cta"
					className="w-full"
					onClick={() => navigate("/", { replace: true })}
				>
					Back to sign in
				</Button>
			</Card>
		</div>
	);
}
