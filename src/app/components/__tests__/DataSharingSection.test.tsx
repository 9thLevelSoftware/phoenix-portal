import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";

const state = vi.hoisted(() => ({
	endpoints: [] as Record<string, unknown>[],
	deliveries: [] as Record<string, unknown>[],
	subscription: {
		tier: "FLAME",
		isLoading: false,
		isError: false,
		refetch: () => Promise.resolve(),
	},
	invoke: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/hooks/useAuth", () => ({
	useAuth: () => ({ user: { id: "test-user-id" } }),
}));

vi.mock("@/hooks/useSubscription", () => ({
	useSubscription: () => state.subscription,
}));

vi.mock("sonner", () => ({
	toast: {
		success: (...args: unknown[]) => state.toast.success(...args),
		error: (...args: unknown[]) => state.toast.error(...args),
		info: vi.fn(),
	},
}));

// A PostgREST builder double: every filter returns the builder, and awaiting
// it yields the rows of the table it was opened on.
vi.mock("@/lib/supabase", () => {
	const builder = (rows: () => unknown[]) => {
		const chain: Record<string, unknown> = {};
		for (const method of ["select", "eq", "order", "limit"]) {
			chain[method] = () => chain;
		}
		// biome-ignore lint/suspicious/noThenProperty: a PostgREST builder is awaited
		chain.then = (resolve: (value: unknown) => unknown) =>
			Promise.resolve({ data: rows(), error: null }).then(resolve);
		return chain;
	};
	return {
		supabase: {
			from: (table: string) =>
				builder(() =>
					table === "webhook_endpoints" ? state.endpoints : state.deliveries,
				),
			functions: {
				invoke: (...args: unknown[]) => state.invoke(...args),
			},
		},
	};
});

import { DataSharingSection } from "@/app/components/profile/DataSharingSection";

// Obviously fake, and not shaped like a real secret: nothing here verifies it.
const SECRET = "whsec_test-only-not-a-real-secret";

function endpoint(overrides: Record<string, unknown> = {}) {
	return {
		id: "e-1",
		label: "Home server",
		url: "https://hooks.example.com/in",
		scopes: ["workouts", "routines"],
		status: "active",
		disabled_reason: null,
		custom_header_name: null,
		signing_key_hint: "LaSw",
		consecutive_failures: 0,
		last_success_at: null,
		last_failure_at: null,
		created_at: "2026-11-06T12:00:00.000Z",
		updated_at: "2026-11-06T12:00:00.000Z",
		...overrides,
	};
}

function button(name: RegExp | string) {
	return screen.getByRole("button", { name }) as HTMLButtonElement;
}

describe("DataSharingSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.endpoints = [];
		state.deliveries = [];
		state.subscription = {
			tier: "FLAME",
			isLoading: false,
			isError: false,
			refetch: () => Promise.resolve(),
		};
	});

	it("shows a Flame user their endpoint and lets them manage it", async () => {
		state.endpoints = [endpoint({ custom_header_name: "Authorization" })];

		renderWithProviders(<DataSharingSection />);

		expect(await screen.findByText("Home server")).toBeInTheDocument();
		expect(
			screen.getByText("https://hooks.example.com/in"),
		).toBeInTheDocument();
		expect(screen.getByText("Active")).toBeInTheDocument();
		expect(screen.getByText("Workouts")).toBeInTheDocument();
		expect(screen.getByText("Routines")).toBeInTheDocument();
		expect(screen.getByText("LaSw")).toBeInTheDocument();
		expect(screen.getByText("Authorization")).toBeInTheDocument();
		for (const name of [
			/add endpoint/i,
			/send test/i,
			/^edit$/i,
			/replace secret/i,
			/resend all/i,
			/^pause$/i,
			/^delete$/i,
		]) {
			expect(button(name).disabled, String(name)).toBe(false);
		}
		expect(screen.queryByTestId("data-sharing-upgrade")).toBeNull();
	});

	it("lets a user below Flame pause and delete but nothing else", async () => {
		state.subscription = { ...state.subscription, tier: "EMBER" };
		state.endpoints = [endpoint()];

		renderWithProviders(<DataSharingSection />);

		await screen.findByText("Home server");
		expect(screen.getByTestId("data-sharing-upgrade")).toHaveTextContent(
			/part of Flame/,
		);
		expect(screen.getByTestId("data-sharing-upgrade")).toHaveTextContent(
			/pause or delete/,
		);
		expect(button(/^pause$/i).disabled).toBe(false);
		expect(button(/^delete$/i).disabled).toBe(false);
		for (const name of [
			/add endpoint/i,
			/send test/i,
			/^edit$/i,
			/replace secret/i,
			/resend all/i,
		]) {
			expect(button(name).disabled, String(name)).toBe(true);
		}
	});

	it("does not tell a paying user to upgrade when billing is unavailable", async () => {
		state.subscription = { ...state.subscription, tier: "FREE", isError: true };
		state.endpoints = [endpoint()];

		renderWithProviders(<DataSharingSection />);

		await screen.findByText("Home server");
		expect(screen.queryByTestId("data-sharing-upgrade")).toBeNull();
		expect(
			screen.getByText(/billing status is unavailable/i),
		).toBeInTheDocument();
		expect(button(/add endpoint/i).disabled).toBe(true);
		expect(button(/^pause$/i).disabled).toBe(false);
	});

	it("says why an endpoint was switched off and offers to switch it back on", async () => {
		state.endpoints = [
			endpoint({
				status: "disabled",
				disabled_reason: "too_many_failures",
				consecutive_failures: 9,
			}),
		];

		renderWithProviders(<DataSharingSection />);

		expect(await screen.findByText("Switched off")).toBeInTheDocument();
		expect(
			screen.getByText(/switched off after repeated failed deliveries/i),
		).toBeInTheDocument();
		expect(button(/switch on/i).disabled).toBe(false);
		// Nothing to resend to while it is off.
		expect(button(/resend all/i).disabled).toBe(true);
	});

	it("stops offering a new endpoint at the limit", async () => {
		state.endpoints = [
			endpoint({ id: "e-1" }),
			endpoint({ id: "e-2", label: "Second" }),
			endpoint({ id: "e-3", label: "Third" }),
		];

		renderWithProviders(<DataSharingSection />);

		await screen.findByText("Third");
		expect(button(/add endpoint/i).disabled).toBe(true);
		expect(screen.getByText(/maximum of 3 endpoints/i)).toBeInTheDocument();
	});

	it("creates an endpoint from the form and shows the secret once", async () => {
		state.invoke.mockResolvedValue({
			data: { endpoint: endpoint(), signingSecret: SECRET },
			error: null,
		});
		renderWithProviders(<DataSharingSection />);
		await screen.findByText(/no endpoints yet/i);

		// Act: fill in the form and submit.
		fireEvent.click(button(/add endpoint/i));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Home server" },
		});
		fireEvent.change(within(dialog).getByLabelText("Endpoint URL"), {
			target: { value: "https://hooks.example.com/in" },
		});
		fireEvent.click(within(dialog).getByRole("switch", { name: "Workouts" }));
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Add endpoint" }),
		);

		// Assert: one create call, with no user id for the server to trust.
		await waitFor(() => expect(state.invoke).toHaveBeenCalledTimes(1));
		expect(state.invoke).toHaveBeenCalledWith("webhook-endpoints", {
			body: {
				action: "create",
				label: "Home server",
				url: "https://hooks.example.com/in",
				scopes: ["workouts"],
			},
		});
		// The secret is shown...
		expect(await screen.findByTestId("signing-secret")).toHaveTextContent(
			SECRET,
		);
		// ...and gone for good once the dialog is closed.
		fireEvent.click(button(/i have saved it/i));
		await waitFor(() =>
			expect(screen.queryByTestId("signing-secret")).toBeNull(),
		);
		expect(document.body.textContent).not.toContain(SECRET);
	});

	it("does not call the server while the form is invalid", async () => {
		renderWithProviders(<DataSharingSection />);
		await screen.findByText(/no endpoints yet/i);

		fireEvent.click(button(/add endpoint/i));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Home server" },
		});
		fireEvent.change(within(dialog).getByLabelText("Endpoint URL"), {
			target: { value: "http://hooks.example.com/in" },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Add endpoint" }),
		);

		expect(
			await within(dialog).findByText("The URL must start with https://."),
		).toBeInTheDocument();
		expect(
			within(dialog).getByText("Choose at least one kind of data to share."),
		).toBeInTheDocument();
		expect(state.invoke).not.toHaveBeenCalled();
	});

	it("pauses an endpoint with a pause-only request", async () => {
		state.endpoints = [endpoint()];
		state.invoke.mockResolvedValue({
			data: {
				endpoint: endpoint({
					status: "paused",
					disabled_reason: "user_paused",
				}),
			},
			error: null,
		});
		renderWithProviders(<DataSharingSection />);
		await screen.findByText("Home server");

		fireEvent.click(button(/^pause$/i));

		// Exactly these keys: the server lets a pause through without Flame
		// only when nothing else rides along.
		await waitFor(() =>
			expect(state.invoke).toHaveBeenCalledWith("webhook-endpoints", {
				body: { action: "update", endpointId: "e-1", status: "paused" },
			}),
		);
	});

	it("shows the result of a test delivery", async () => {
		state.endpoints = [endpoint()];
		state.invoke.mockResolvedValue({
			data: {
				delivered: false,
				statusCode: 503,
				errorCode: "http_error",
				durationMs: 120,
			},
			error: null,
		});
		renderWithProviders(<DataSharingSection />);
		await screen.findByText("Home server");

		fireEvent.click(button(/send test/i));

		expect(
			await screen.findByText(
				"The receiver answered with an error status (503).",
			),
		).toBeInTheDocument();
		expect(state.invoke).toHaveBeenCalledWith("webhook-endpoints", {
			body: { action: "test", endpointId: "e-1" },
		});
	});

	it("asks before deleting and only then calls the server", async () => {
		state.endpoints = [endpoint()];
		state.invoke.mockResolvedValue({ data: { deleted: true }, error: null });
		renderWithProviders(<DataSharingSection />);
		await screen.findByText("Home server");

		fireEvent.click(button(/^delete$/i));
		const confirm = await screen.findByRole("alertdialog");
		expect(state.invoke).not.toHaveBeenCalled();
		fireEvent.click(
			within(confirm).getByRole("button", { name: "Delete endpoint" }),
		);

		await waitFor(() =>
			expect(state.invoke).toHaveBeenCalledWith("webhook-endpoints", {
				body: { action: "delete", endpointId: "e-1" },
			}),
		);
	});

	it("surfaces the server's reason when a save is refused", async () => {
		const { FunctionsHttpError } = await import("@supabase/supabase-js");
		state.invoke.mockResolvedValue({
			data: null,
			error: new FunctionsHttpError(
				new Response(
					JSON.stringify({
						error: "url_resolves_to_private_address",
						message: "That host resolves to a private or reserved address.",
					}),
					{ status: 400 },
				),
			),
		});
		renderWithProviders(<DataSharingSection />);
		await screen.findByText(/no endpoints yet/i);

		fireEvent.click(button(/add endpoint/i));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Internal" },
		});
		fireEvent.change(within(dialog).getByLabelText("Endpoint URL"), {
			target: { value: "https://internal.example.com/in" },
		});
		fireEvent.click(within(dialog).getByRole("switch", { name: "Workouts" }));
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Add endpoint" }),
		);

		await waitFor(() =>
			expect(state.toast.error).toHaveBeenCalledWith(
				"That host resolves to a private or reserved address.",
			),
		);
		// The form stays open so the URL can be corrected.
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.queryByTestId("signing-secret")).toBeNull();
	});
});
