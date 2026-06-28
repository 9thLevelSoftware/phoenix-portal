import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app/App.tsx";
import { CookieConsentBanner } from "./app/components/CookieConsentBanner";
import { getConsentStatus } from "./lib/consent";
import { AuthProvider } from "./providers/AuthProvider";
import { QueryProvider } from "./providers/QueryProvider";
import "./styles/index.css";

// Initialize Sentry lazily — only fetched for users who have consented
// Lightweight proxy forwards errors to Sentry only if/when SDK loads
let sentryHandler: ((error: unknown, errorInfo: unknown) => void) | null = null;
// Reading consent touches localStorage, which can throw in privacy modes /
// blocked-storage contexts. Default to not-consented rather than failing to boot.
let initialConsent: string | null = null;
try {
	initialConsent = getConsentStatus();
} catch {
	initialConsent = null;
}
if (initialConsent === "accepted") {
	import("./lib/sentry").then(({ initSentry, sentryErrorHandler }) => {
		initSentry();
		sentryHandler = sentryErrorHandler;
	});
}
const errorProxy = (error: unknown, errorInfo: unknown) => {
	sentryHandler?.(error, errorInfo);
};

// biome-ignore lint/style/noNonNullAssertion: root element always exists in index.html
const root = createRoot(document.getElementById("root")!, {
	onUncaughtError: errorProxy,
	onCaughtError: errorProxy,
	onRecoverableError: errorProxy,
});

root.render(
	<BrowserRouter>
		<QueryProvider>
			<AuthProvider>
				<App />
			</AuthProvider>
		</QueryProvider>
		<CookieConsentBanner />
	</BrowserRouter>,
);
