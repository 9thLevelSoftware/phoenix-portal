import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app/App.tsx";
import { initSentry, sentryErrorHandler } from "./lib/sentry";
import { AuthProvider } from "./providers/AuthProvider";
import { QueryProvider } from "./providers/QueryProvider";
import "./styles/index.css";

// Initialize Sentry before React renders
initSentry();

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
	</BrowserRouter>,
);
