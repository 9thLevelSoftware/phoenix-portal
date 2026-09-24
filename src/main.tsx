import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app/App.tsx";
import { CookieConsentBanner } from "./app/components/CookieConsentBanner";
import { getConsentStatus } from "./lib/consent";
import { enableErrorReporting, forwardReactError } from "./lib/errorReporting";
import { AuthProvider } from "./providers/AuthProvider";
import { QueryProvider } from "./providers/QueryProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import "./styles/index.css";

// Sentry is fetched only for users who have consented. Reading consent
// touches localStorage, which can throw in privacy modes / blocked-storage
// contexts: default to not-consented rather than failing to boot.
let initialConsent: string | null = null;
try {
	initialConsent = getConsentStatus();
} catch {
	initialConsent = null;
}
if (initialConsent === "accepted") {
	void enableErrorReporting();
}

// biome-ignore lint/style/noNonNullAssertion: root element always exists in index.html
const root = createRoot(document.getElementById("root")!, {
	onUncaughtError: forwardReactError,
	onCaughtError: forwardReactError,
	onRecoverableError: forwardReactError,
});

root.render(
	<BrowserRouter>
		<QueryProvider>
			<ThemeProvider>
				<AuthProvider>
					<App />
				</AuthProvider>
			</ThemeProvider>
		</QueryProvider>
		<CookieConsentBanner />
	</BrowserRouter>,
);
