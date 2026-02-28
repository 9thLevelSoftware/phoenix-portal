import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app/App.tsx";
import { CookieConsentBanner } from "./app/components/CookieConsentBanner";
import { getConsentStatus } from "./lib/consent";
import { initSentry, sentryErrorHandler } from "./lib/sentry";
import { AuthProvider } from "./providers/AuthProvider";
import { QueryProvider } from "./providers/QueryProvider";
import "./styles/index.css";

// Initialize Sentry before React renders — only if user has consented
if (getConsentStatus() === "accepted") {
	initSentry();
}

const root = createRoot(document.getElementById("root")!, {
	onUncaughtError: sentryErrorHandler,
	onCaughtError: sentryErrorHandler,
	onRecoverableError: sentryErrorHandler,
});

root.render(
	<BrowserRouter>
		<AuthProvider>
			<QueryProvider>
				<App />
			</QueryProvider>
		</AuthProvider>
		<CookieConsentBanner />
	</BrowserRouter>,
);
