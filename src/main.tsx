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
if (getConsentStatus() === "accepted") {
	import("./lib/sentry").then(({ initSentry, sentryErrorHandler }) => {
		initSentry();
		sentryHandler = sentryErrorHandler;
	});
}
const errorProxy = (error: unknown, errorInfo: unknown) => {
	sentryHandler?.(error, errorInfo);
};

const root = createRoot(document.getElementById("root")!, {
	onUncaughtError: errorProxy,
	onCaughtError: errorProxy,
	onRecoverableError: errorProxy,
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
