import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";

type ActivityRow = {
	id: string;
	provider: string;
	status: string | null;
};

const state = vi.hoisted(() => ({
	activity: [] as ActivityRow[],
	active: { pending: 0, processingProvider: null as string | null },
	activityError: null as { message: string } | null,
	activeError: null as { message: string } | null,
}));

vi.mock("@/queries/integrations", () => ({
	syncQueueOptions: (userId: string) => ({
		queryKey: ["integrations", "sync-queue", userId],
		queryFn: async () => {
			if (state.activityError) throw state.activityError;
			return state.activity;
		},
	}),
	syncQueueActiveCountOptions: (userId: string) => ({
		queryKey: ["integrations", "sync-queue", userId, "active"],
		queryFn: async () => {
			if (state.activeError) throw state.activeError;
			return state.active;
		},
	}),
}));

import { SyncStatus } from "@/app/components/integrations/SyncStatus";

function row(id: string, provider: string, status: string): ActivityRow {
	return { id, provider, status };
}

describe("SyncStatus", () => {
	beforeEach(() => {
		state.activity = [];
		state.active = { pending: 0, processingProvider: null };
		state.activityError = null;
		state.activeError = null;
	});

	it("counts pending and processing from the status filter, not the activity list", async () => {
		state.activity = [
			row("1", "strava", "completed"),
			row("2", "hevy", "superseded"),
			row("3", "garmin", "failed"),
		];
		state.active = { pending: 4, processingProvider: "fitbit" };

		renderWithProviders(<SyncStatus userId="user-1" />);

		expect(await screen.findByText("4 sync(s) pending")).toBeInTheDocument();
		expect(screen.getByText("Syncing fitbit...")).toBeInTheDocument();
		expect(screen.queryByText("All synced")).not.toBeInTheDocument();

		const superseded = screen.getByText("superseded");
		expect(superseded).toHaveClass("bg-muted/40", "border-muted");
	});

	it("ignores pending rows that only appear in the activity list", async () => {
		state.activity = [row("1", "strava", "pending")];
		state.active = { pending: 0, processingProvider: null };

		renderWithProviders(<SyncStatus userId="user-1" />);

		expect(await screen.findByText("All synced")).toBeInTheDocument();
		expect(screen.queryByText(/sync\(s\) pending/)).not.toBeInTheDocument();
		expect(screen.getByText("pending")).toBeInTheDocument();
	});

	it("does not report all synced when the active count fails", async () => {
		state.activeError = { message: "unavailable" };

		renderWithProviders(<SyncStatus userId="user-1" />);

		expect(
			await screen.findByText("Couldn't load sync status. Please try again."),
		).toBeInTheDocument();
		expect(screen.queryByText("All synced")).not.toBeInTheDocument();
	});

	it("renders every row from the latest-10 activity query", async () => {
		state.activity = Array.from({ length: 10 }, (_, index) =>
			row(String(index), "strava", index === 0 ? "superseded" : "completed"),
		);

		renderWithProviders(<SyncStatus userId="user-1" />);

		expect(await screen.findByText("Recent Activity")).toBeInTheDocument();
		expect(screen.getAllByText("strava")).toHaveLength(10);
	});
});
