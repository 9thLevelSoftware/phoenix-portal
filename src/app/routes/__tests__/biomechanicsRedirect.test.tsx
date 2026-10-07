import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../index";

vi.mock("../ProtectedRoute", () => ({
	ProtectedRoute: () => <Outlet />,
}));

vi.mock("../SubscribedRoute", () => ({
	SubscribedRoute: () => <Outlet />,
}));

vi.mock("../AppLayout", () => ({
	AppLayout: () => <Outlet />,
}));

vi.mock("@/app/components/Analytics", () => ({
	Analytics: function AnalyticsStub() {
		const location = useLocation();
		return (
			<div data-testid="landed">{location.pathname + location.search}</div>
		);
	},
}));

describe("/biomechanics", () => {
	it("redirects to the performance tab", async () => {
		render(
			<MemoryRouter initialEntries={["/biomechanics"]}>
				<AppRoutes />
			</MemoryRouter>,
		);

		expect(await screen.findByTestId("landed")).toHaveTextContent(
			"/analytics?tab=performance",
		);
	});
});
