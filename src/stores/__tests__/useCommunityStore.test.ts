import { beforeEach, describe, expect, it } from "vitest";
import { useCommunityStore } from "../useCommunityStore";

describe("useCommunityStore", () => {
	beforeEach(() => {
		useCommunityStore.setState({
			activeTab: "routines",
			sort: "hot",
			search: "",
			filters: {},
			selectedItemId: null,
			blockedUserIds: new Set<string>(),
		});
	});

	it("has correct initial state", () => {
		const state = useCommunityStore.getState();
		expect(state.activeTab).toBe("routines");
		expect(state.sort).toBe("hot");
		expect(state.search).toBe("");
		expect(state.filters).toEqual({});
		expect(state.selectedItemId).toBeNull();
		expect(state.blockedUserIds.size).toBe(0);
	});

	it("setActiveTab() updates activeTab", () => {
		useCommunityStore.getState().setActiveTab("cycles");
		expect(useCommunityStore.getState().activeTab).toBe("cycles");
	});

	it("setSort() updates sort", () => {
		useCommunityStore.getState().setSort("new");
		expect(useCommunityStore.getState().sort).toBe("new");
	});

	it("setSearch() updates search", () => {
		useCommunityStore.getState().setSearch("bench");
		expect(useCommunityStore.getState().search).toBe("bench");
	});

	it("setFilters() updates filters", () => {
		useCommunityStore.getState().setFilters({ muscleGroup: "chest" });
		expect(useCommunityStore.getState().filters.muscleGroup).toBe("chest");
	});

	it("setSelectedItemId() updates selectedItemId", () => {
		useCommunityStore.getState().setSelectedItemId("item-123");
		expect(useCommunityStore.getState().selectedItemId).toBe("item-123");
	});

	it("setBlockedUserIds() updates blockedUserIds", () => {
		useCommunityStore.getState().setBlockedUserIds(new Set(["u1", "u2"]));
		const ids = useCommunityStore.getState().blockedUserIds;
		expect(ids.has("u1")).toBe(true);
		expect(ids.has("u2")).toBe(true);
		expect(ids.size).toBe(2);
	});

	it("resetAll() returns to initial state", () => {
		// Change everything
		useCommunityStore.getState().setActiveTab("cycles");
		useCommunityStore.getState().setSort("top");
		useCommunityStore.getState().setSearch("squat");
		useCommunityStore
			.getState()
			.setFilters({ muscleGroup: "legs", difficulty: "hard" });
		useCommunityStore.getState().setSelectedItemId("item-456");
		useCommunityStore.getState().setBlockedUserIds(new Set(["u1"]));

		// Reset
		useCommunityStore.getState().resetAll();
		const state = useCommunityStore.getState();
		expect(state.activeTab).toBe("routines");
		expect(state.sort).toBe("hot");
		expect(state.search).toBe("");
		expect(state.filters).toEqual({});
		expect(state.selectedItemId).toBeNull();
		expect(state.blockedUserIds.size).toBe(0);
	});
});
