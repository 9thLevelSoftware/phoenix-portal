import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";

const deletionState = vi.hoisted(() => ({
	request: null as null | {
		id: string;
		user_id: string;
		requested_at: string;
		scheduled_for: string;
		status: string;
	},
}));

vi.mock("@/app/hooks/useAuth", () => ({
	useAuth: () => ({ user: { id: "test-user-id" } }),
}));

vi.mock("@/mutations/account", () => {
	const idle = () => ({ mutate: vi.fn(), isPending: false });
	return {
		deletionRequestOptions: (userId: string) => ({
			queryKey: ["deletion-request", userId],
			queryFn: async () => deletionState.request,
		}),
		useRequestDeletion: idle,
		useCancelDeletion: idle,
		useExecuteDeletion: idle,
	};
});

import { DangerZone } from "@/app/components/profile/DangerZone";

const NOW = new Date("2026-09-19T12:00:00.000Z");

function localeDate(date: Date): string {
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

describe("DangerZone deletion copy (KD-11)", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		deletionState.request = null;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("the confirm dialog names the deletion date, when billing stops, and links Billing", async () => {
		renderWithProviders(<DangerZone />);

		fireEvent.click(
			await screen.findByRole("button", { name: /delete my account/i }),
		);

		const date = localeDate(new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000));
		const dialog = await screen.findByRole("alertdialog");
		const text = dialog.textContent?.replace(/\s+/g, " ") ?? "";
		expect(text).toContain(
			`Your account and data will be permanently deleted on ${date} (30 days from now).`,
		);
		expect(text).toContain(
			"Your subscription is cancelled on that date, so no payment is taken after it.",
		);
		expect(text).toContain(
			`A renewal that falls due before ${date} is still charged unless you cancel your plan first in Billing.`,
		);
		const billing = screen.getByRole("link", { name: "Billing" });
		expect(billing.getAttribute("href")).toBe("/pricing");
	});

	it("the pending-deletion banner shows the request's scheduled date", async () => {
		const scheduledFor = new Date("2026-10-19T12:00:00.000Z");
		deletionState.request = {
			id: "req-1",
			user_id: "test-user-id",
			requested_at: NOW.toISOString(),
			scheduled_for: scheduledFor.toISOString(),
			status: "pending",
		};

		renderWithProviders(<DangerZone />);

		await waitFor(() =>
			expect(screen.getByText(localeDate(scheduledFor))).toBeTruthy(),
		);
		expect(screen.getByText(/deletion scheduled/i)).toBeTruthy();
	});
});
