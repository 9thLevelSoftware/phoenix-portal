import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { MobileBottomNav } from "../MobileBottomNav";

vi.mock("../ThemeToggle", () => ({
	ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<MobileBottomNav />
		</MemoryRouter>,
	);
}

// The sidebar cannot be opened on phones, so every route it links must be
// reachable from the bottom bar or its More drawer.
const EVERY_APP_ROUTE = [
	"/dashboard",
	"/history",
	"/routines",
	"/analytics",
	"/goals",
	"/recovery",
	"/cycles",
	"/community",
	"/challenges",
	"/leaderboard",
	"/profile",
	"/integrations",
	"/pricing",
];

describe("MobileBottomNav", () => {
	it("reaches every app route from the bar or the More drawer", async () => {
		const user = userEvent.setup();
		renderAt("/dashboard");

		// Read the bar first: the modal drawer hides it from the a11y tree.
		const barHrefs = within(screen.getByRole("navigation", { name: "Primary" }))
			.getAllByRole("link")
			.map((link) => link.getAttribute("href"));

		await user.click(screen.getByRole("button", { name: "More" }));
		const drawer = await screen.findByRole("dialog");
		const drawerHrefs = within(drawer)
			.getAllByRole("link")
			.map((link) => link.getAttribute("href"));

		const hrefs = new Set([...barHrefs, ...drawerHrefs].filter(Boolean));

		expect([...hrefs].sort()).toEqual([...EVERY_APP_ROUTE].sort());
		expect(within(drawer).getByTestId("theme-toggle")).toBeInTheDocument();
	});

	it("marks exactly one bar tab current", () => {
		renderAt("/routines/new");

		const current = screen
			.getAllByRole("link")
			.filter((link) => link.getAttribute("aria-current") === "page");
		expect(current).toHaveLength(1);
		expect(current[0]).toHaveTextContent("Routines");
	});
});
