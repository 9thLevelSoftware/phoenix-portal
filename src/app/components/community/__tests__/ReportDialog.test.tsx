import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reportCategoryEnum } from "@/schemas/community";
import { renderWithProviders } from "@/test/test-utils";
import { ReportDialog } from "../ReportDialog";

vi.mock("@/mutations/community", () => ({
	useReportContent: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe("ReportDialog", () => {
	it("offers one radio for each reportCategoryEnum value, in enum order", () => {
		renderWithProviders(
			<ReportDialog
				open
				onOpenChange={() => undefined}
				contentId="11111111-1111-4111-8111-111111111111"
				contentType="routine"
			/>,
		);

		const radios = screen.getAllByRole("radio");
		expect(radios.map((radio) => radio.getAttribute("value"))).toEqual([
			...reportCategoryEnum.options,
		]);
	});
});
