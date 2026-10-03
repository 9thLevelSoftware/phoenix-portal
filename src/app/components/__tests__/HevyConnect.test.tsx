import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HevyConnect } from "@/app/components/integrations/HevyConnect";
import { renderWithProviders } from "@/test/test-utils";

describe("HevyConnect export copy", () => {
	it("describes the weight_lbs column instead of an internal pounds default", () => {
		renderWithProviders(<HevyConnect userId="user-1" />);

		expect(
			screen.getByText(
				/Weights are exported in lbs \(Hevy's weight_lbs column\)/,
			),
		).toBeInTheDocument();
		expect(screen.queryByText(/Hevy's default/)).not.toBeInTheDocument();
		expect(screen.queryByText(/uses lbs internally/)).not.toBeInTheDocument();
	});
});
