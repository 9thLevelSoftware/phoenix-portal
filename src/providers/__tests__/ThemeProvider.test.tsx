import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { ThemeProvider, useTheme } from "@/providers/ThemeProvider";

function ThemeConsumer() {
	const { theme, resolved } = useTheme();
	return (
		<div>
			<span data-testid="theme">{theme}</span>
			<span data-testid="resolved">{resolved}</span>
		</div>
	);
}

function renderTheme(children: ReactNode = <ThemeConsumer />) {
	return render(<ThemeProvider>{children}</ThemeProvider>);
}

function installLocalStorageStub() {
	const values = new Map<string, string>();
	const storage = {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => {
			values.set(key, value);
		}),
		removeItem: vi.fn((key: string) => {
			values.delete(key);
		}),
		clear: vi.fn(() => {
			values.clear();
		}),
	};

	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: storage,
	});
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: storage,
	});
}

describe("ThemeProvider", () => {
	beforeEach(() => {
		installLocalStorageStub();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	it("defaults to dark when localStorage is empty", async () => {
		renderTheme();

		expect(screen.getByTestId("theme")).toHaveTextContent("dark");
		await waitFor(() => {
			expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
		});
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	it("respects the persisted theme value", async () => {
		localStorage.setItem("phoenix-theme", "light");

		renderTheme();

		expect(screen.getByTestId("theme")).toHaveTextContent("light");
		await waitFor(() => {
			expect(document.documentElement.dataset.theme).toBe("light");
		});
	});

	it("resolves system theme through matchMedia", async () => {
		localStorage.setItem("phoenix-theme", "system");
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn().mockImplementation((query: string) => ({
				matches: query === "(prefers-color-scheme: light)",
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			})),
		});

		renderTheme();

		expect(screen.getByTestId("theme")).toHaveTextContent("system");
		await waitFor(() => {
			expect(screen.getByTestId("resolved")).toHaveTextContent("light");
			expect(document.documentElement.dataset.theme).toBe("light");
		});
	});
});
