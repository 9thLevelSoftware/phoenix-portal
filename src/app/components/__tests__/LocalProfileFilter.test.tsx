import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";
import { renderWithProviders } from "@/test/test-utils";
import { LocalProfileFilter } from "../LocalProfileFilter";

const twoProfiles = [
	{
		id: "default",
		name: "Default",
		color_index: 0,
		device_id: null,
		created_at: "",
		updated_at: "",
	},
	{
		id: "profile-2",
		name: "Training",
		color_index: 1,
		device_id: null,
		created_at: "",
		updated_at: "",
	},
];

// biome-ignore lint/suspicious/noExplicitAny: test mock data
let mockQueryReturn: { data: any; isLoading: boolean } = {
	data: twoProfiles,
	isLoading: false,
};

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual("@tanstack/react-query");
	return {
		...actual,
		useQuery: () => mockQueryReturn,
	};
});

describe("LocalProfileFilter", () => {
	beforeEach(() => {
		useProfileFilterStore.getState().reset();
		mockQueryReturn = { data: twoProfiles, isLoading: false };
	});

	it("renders nothing when loading", () => {
		mockQueryReturn = { data: undefined, isLoading: true };
		const { container } = renderWithProviders(
			<LocalProfileFilter userId="u1" />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders nothing with 1 or fewer profiles", () => {
		mockQueryReturn = { data: [twoProfiles[0]], isLoading: false };
		const { container } = renderWithProviders(
			<LocalProfileFilter userId="u1" />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders nothing with empty profiles array", () => {
		mockQueryReturn = { data: [], isLoading: false };
		const { container } = renderWithProviders(
			<LocalProfileFilter userId="u1" />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders select when 2+ profiles exist", () => {
		renderWithProviders(<LocalProfileFilter userId="u1" />);
		expect(screen.getByRole("combobox")).toBeInTheDocument();
	});

	it("shows Profile label", () => {
		renderWithProviders(<LocalProfileFilter userId="u1" />);
		expect(screen.getByText("Profile")).toBeInTheDocument();
	});
});
