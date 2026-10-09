import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { ShareContentDialog } from "../ShareContentDialog";

vi.mock("@/mutations/community", () => ({
	useShareContent: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe("ShareContentDialog", () => {
	it("renders the share form when open and does not render a trigger", () => {
		renderWithProviders(
			<ShareContentDialog open onOpenChange={() => undefined} />,
		);

		expect(
			screen.getByRole("heading", { name: "Share to Community" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /^share$/i }),
		).not.toBeInTheDocument();
	});

	it("renders no dialog and no trigger when closed", () => {
		renderWithProviders(
			<ShareContentDialog open={false} onOpenChange={() => undefined} />,
		);

		expect(screen.queryByText("Share to Community")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /^share$/i }),
		).not.toBeInTheDocument();
	});
});
