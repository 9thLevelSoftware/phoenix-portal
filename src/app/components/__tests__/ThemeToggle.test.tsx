import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { vi } from "vitest";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { ThemeToggle } from "../ThemeToggle";

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

describe("ThemeToggle", () => {
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
	});

	it("renders light, dark, and system options", () => {
		render(
			<ThemeProvider>
				<ThemeToggle />
			</ThemeProvider>,
		);

		expect(
			screen.getByRole("button", { name: /light theme/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /dark theme/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /system theme/i }),
		).toBeInTheDocument();
	});

	it("persists the selected theme", async () => {
		const user = userEvent.setup();
		render(
			<ThemeProvider>
				<ThemeToggle />
			</ThemeProvider>,
		);

		await user.click(screen.getByRole("button", { name: /light theme/i }));

		expect(localStorage.getItem("phoenix-theme")).toBe("light");
	});
});
