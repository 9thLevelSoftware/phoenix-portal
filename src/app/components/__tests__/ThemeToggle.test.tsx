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
	beforeEach(() => {
		installLocalStorageStub();
		localStorage.clear();
	});

	it("renders light, dark, and system options", () => {
		render(
			<ThemeProvider>
				<ThemeToggle />
			</ThemeProvider>,
		);

		expect(screen.getByRole("button", { name: /light theme/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /dark theme/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /system theme/i })).toBeInTheDocument();
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
