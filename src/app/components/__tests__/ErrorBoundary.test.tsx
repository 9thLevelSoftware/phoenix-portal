import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { PageErrorFallback } from "../ErrorFallback";

// Suppress expected error boundary console.error output
const originalError = console.error;
beforeEach(() => {
	console.error = vi.fn();
});
afterEach(() => {
	console.error = originalError;
});

// ---------- helpers ----------

function BombComponent({ shouldThrow }: { shouldThrow: boolean }) {
	if (shouldThrow) throw new Error("Component exploded");
	return <p>All good</p>;
}

function BoundaryWrapper({ children }: { children: ReactNode }) {
	return (
		<ErrorBoundary FallbackComponent={PageErrorFallback}>
			{children}
		</ErrorBoundary>
	);
}

function RecoverableScenario() {
	const [broken, setBroken] = useState(true);
	return (
		<ErrorBoundary
			FallbackComponent={PageErrorFallback}
			onReset={() => setBroken(false)}
		>
			{broken ? <BombComponent shouldThrow /> : <p>Recovered successfully</p>}
		</ErrorBoundary>
	);
}

// ---------- tests ----------

describe("ErrorBoundary + PageErrorFallback", () => {
	it("catches component render errors and shows fallback", () => {
		renderWithProviders(
			<BoundaryWrapper>
				<BombComponent shouldThrow />
			</BoundaryWrapper>,
		);

		expect(screen.getByText("Something went wrong")).toBeInTheDocument();
		expect(screen.getByText("Component exploded")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /try again/i }),
		).toBeInTheDocument();
	});

	it("renders children normally when no error", () => {
		renderWithProviders(
			<BoundaryWrapper>
				<BombComponent shouldThrow={false} />
			</BoundaryWrapper>,
		);

		expect(screen.getByText("All good")).toBeInTheDocument();
		expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
	});

	it("recovers when Try Again is clicked and error is resolved", async () => {
		const user = userEvent.setup();

		renderWithProviders(<RecoverableScenario />);

		// Should show fallback first
		expect(screen.getByText("Something went wrong")).toBeInTheDocument();

		// Click Try Again
		await user.click(screen.getByRole("button", { name: /try again/i }));

		// Should recover
		expect(screen.getByText("Recovered successfully")).toBeInTheDocument();
		expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
	});

	it("shows 'New version available' for chunk load errors", () => {
		function ChunkErrorComponent() {
			throw new Error(
				"Failed to fetch dynamically imported module: https://phoenix-portal.com/assets/WorkoutHistory-Dwz9vD3g.js",
			);
		}

		// Mock window.location.reload to prevent actual reload
		const reloadMock = vi.fn();
		Object.defineProperty(window, "location", {
			value: { ...window.location, reload: reloadMock },
			writable: true,
		});

		// Set sessionStorage to prevent auto-reload (simulate already reloaded)
		sessionStorage.setItem("phoenix-chunk-reload", String(Date.now()));

		renderWithProviders(
			<BoundaryWrapper>
				<ChunkErrorComponent />
			</BoundaryWrapper>,
		);

		expect(screen.getByText("New version available")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();

		sessionStorage.removeItem("phoenix-chunk-reload");
	});

	it("does not show blank screen on error (always shows actionable UI)", () => {
		renderWithProviders(
			<BoundaryWrapper>
				<BombComponent shouldThrow />
			</BoundaryWrapper>,
		);

		// The fallback always has visible content and an action button
		const heading = screen.getByText("Something went wrong");
		expect(heading).toBeVisible();

		const button = screen.getByRole("button", { name: /try again/i });
		expect(button).toBeVisible();
	});
});
