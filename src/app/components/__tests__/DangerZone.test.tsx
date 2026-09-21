import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";

type DeletionRequest = {
	id: string;
	user_id: string;
	requested_at: string;
	scheduled_for: string;
	status: string;
	needs_support_reason: string | null;
};

const deletionState = vi.hoisted(() => ({
	request: null as null | {
		id: string;
		user_id: string;
		requested_at: string;
		scheduled_for: string;
		status: string;
		needs_support_reason: string | null;
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
const PAST = new Date("2026-08-19T12:00:00.000Z");

function localeDate(date: Date): string {
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function requestFor(overrides: Partial<DeletionRequest> = {}): DeletionRequest {
	return {
		id: "req-1",
		user_id: "test-user-id",
		requested_at: NOW.toISOString(),
		scheduled_for: PAST.toISOString(),
		status: "pending",
		needs_support_reason: null,
		...overrides,
	};
}

/** The rendered card's text, whitespace-collapsed. */
function cardText(): string {
	return document.body.textContent?.replace(/\s+/g, " ") ?? "";
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
		deletionState.request = requestFor({
			scheduled_for: scheduledFor.toISOString(),
		});

		renderWithProviders(<DangerZone />);

		await waitFor(() =>
			expect(screen.getByText(localeDate(scheduledFor))).toBeTruthy(),
		);
		expect(screen.getByText(/deletion scheduled/i)).toBeTruthy();
	});

	it("after the grace period the copy says the deletion runs automatically, not only on a click", async () => {
		deletionState.request = requestFor();

		renderWithProviders(<DangerZone />);

		await screen.findByText(/account deletion ready/i);
		const text = cardText();
		expect(text).toContain(
			`Your 30-day grace period ended on ${localeDate(PAST)}.`,
		);
		expect(text).toContain(
			"Your account and all personal data are deleted automatically within the hour, and your subscription is cancelled then.",
		);
		expect(text).toContain("Delete Now only runs it immediately");
		// The old copy said the user "can now permanently delete" the account,
		// which stopped being true once the hourly job started doing it.
		expect(text).not.toContain("You can now permanently delete");
		expect(
			screen.getByRole("link", { name: "Billing" }).getAttribute("href"),
		).toBe("/pricing");
		expect(screen.getByRole("button", { name: /delete now/i })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /cancel deletion/i }),
		).toBeTruthy();
	});

	it("a deletion being executed is read-only, never the 'Delete My Account' state", async () => {
		deletionState.request = requestFor({ status: "executing" });

		renderWithProviders(<DangerZone />);

		await screen.findByText(/deletion in progress/i);
		const text = cardText();
		expect(text).toContain("Your account is being deleted right now.");
		expect(text).toContain("This can no longer be cancelled.");
		expect(screen.queryByRole("button", { name: /delete my account/i })).toBe(
			null,
		);
		expect(screen.queryByRole("button", { name: /delete now/i })).toBe(null);
		expect(screen.queryByRole("button", { name: /cancel deletion/i })).toBe(
			null,
		);
	});

	it("a deletion parked for support says what stalled and stays cancellable", async () => {
		deletionState.request = requestFor({
			needs_support_reason: "billing_subscription_not_found",
		});

		renderWithProviders(<DangerZone />);

		await screen.findByText(/deletion needs support/i);
		const text = cardText();
		expect(text).toContain(
			`We could not finish deleting your account on ${localeDate(PAST)}`,
		);
		expect(text).toContain(
			"we could not verify your subscription with our payment provider",
		);
		expect(text).toContain("please contact support to finish it");
		// Never offer a button that is guaranteed to fail.
		expect(screen.queryByRole("button", { name: /delete now/i })).toBe(null);
		expect(
			screen.getByRole("button", { name: /cancel deletion/i }),
		).toBeTruthy();
	});

	it("a request that survived its purge is shown as unfinished, not as deleted", async () => {
		deletionState.request = requestFor({
			needs_support_reason: "request_survived_purge",
		});

		renderWithProviders(<DangerZone />);

		await screen.findByText(/deletion needs support/i);
		expect(cardText()).toContain(
			"the deletion did not finish, so your account and data are still here",
		);
	});
});
