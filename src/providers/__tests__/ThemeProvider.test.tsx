import { act, render, screen, waitFor } from "@testing-library/react";
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
	let originalMatchMedia: typeof window.matchMedia;
	let originalLocalStorage: Storage;
	let originalLocalStorageDescriptor: PropertyDescriptor | undefined;

	beforeEach(() => {
		originalMatchMedia = window.matchMedia;
		originalLocalStorage = window.localStorage;
		originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"localStorage",
		);
		installLocalStorageStub();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		const colorSchemeMeta = document.createElement("meta");
		colorSchemeMeta.name = "color-scheme";
		colorSchemeMeta.content = "dark light";
		document.head.replaceChildren(colorSchemeMeta);
	});

	afterEach(() => {
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: originalMatchMedia,
		});
		if (originalLocalStorageDescriptor) {
			Object.defineProperty(
				window,
				"localStorage",
				originalLocalStorageDescriptor,
			);
		} else {
			Object.defineProperty(window, "localStorage", {
				configurable: true,
				value: originalLocalStorage,
			});
		}
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: originalLocalStorage,
		});
		document.documentElement.removeAttribute("data-theme");
		document.head.replaceChildren();
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

	it("falls back to dark for an invalid persisted theme", () => {
		localStorage.setItem("phoenix-theme", "neon");

		renderTheme();

		expect(screen.getByTestId("theme")).toHaveTextContent("dark");
	});

	it("updates the DOM when the system theme changes", async () => {
		localStorage.setItem("phoenix-theme", "system");
		let matchesLight = false;
		let changeListener: ((event: MediaQueryListEvent) => void) | undefined;
		const mediaQuery = {
			matches: matchesLight,
			media: "(prefers-color-scheme: light)",
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(
				(_event: string, listener: (event: MediaQueryListEvent) => void) => {
					changeListener = listener;
				},
			),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		};
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn(() => mediaQuery),
		});

		renderTheme();

		await waitFor(() => {
			expect(document.documentElement.dataset.theme).toBe("dark");
		});

		matchesLight = true;
		mediaQuery.matches = matchesLight;
		act(() => {
			changeListener?.({ matches: true } as MediaQueryListEvent);
		});

		await waitFor(() => {
			expect(document.documentElement.dataset.theme).toBe("light");
			expect(
				document
					.querySelector("meta[name='color-scheme']")
					?.getAttribute("content"),
			).toBe("light");
		});
	});
});
