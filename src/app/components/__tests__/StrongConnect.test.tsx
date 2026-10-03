import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { StrongConnect } from "@/app/components/integrations/StrongConnect";
import { renderWithProviders } from "@/test/test-utils";

describe("StrongConnect weight units", () => {
	it("keeps the export weight toggle and omits the import one", async () => {
		const user = userEvent.setup();
		renderWithProviders(<StrongConnect userId="user-1" />);

		expect(screen.getByText("Weight unit")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "lbs" })).toBeInTheDocument();

		await user.click(screen.getByRole("tab", { name: "Import" }));

		expect(screen.queryByText("Weight unit")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "lbs" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "miles" })).toBeInTheDocument();

		await user.click(screen.getByRole("tab", { name: "Export" }));

		expect(screen.getByText("Weight unit")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "kg" })).toBeInTheDocument();
	});
});
