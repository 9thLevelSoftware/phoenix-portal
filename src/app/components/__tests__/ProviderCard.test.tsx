import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderCard } from "@/app/components/integrations/ProviderCard";
import type {
	IntegrationStatus,
	UserIntegration,
} from "@/lib/integrations/types";

function makeIntegration(
	status: IntegrationStatus,
	overrides: Partial<UserIntegration> = {},
): UserIntegration {
	return {
		id: "int-1",
		user_id: "user-1",
		provider: "strava",
		provider_user_id: null,
		connected_at: "2026-07-01T00:00:00Z",
		last_sync_at: "2026-07-20T00:00:00Z",
		status,
		error_message: null,
		...overrides,
	};
}

function renderCard(
	integration: UserIntegration | null,
	props: Partial<React.ComponentProps<typeof ProviderCard>> = {},
) {
	const handlers = {
		onConnect: vi.fn(),
		onDisconnect: vi.fn(),
		onSync: vi.fn(),
	};
	render(
		<ProviderCard
			provider="strava"
			integration={integration}
			{...handlers}
			{...props}
		/>,
	);
	return handlers;
}

describe("ProviderCard — connected", () => {
	it("offers sync and disconnect", () => {
		renderCard(makeIntegration("connected"));

		expect(screen.getByText("Connected")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /sync now/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /disconnect/i }),
		).toBeInTheDocument();
	});
});

describe("ProviderCard — never connected", () => {
	it("offers a plain Connect button", () => {
		renderCard(null);

		expect(
			screen.getByRole("button", { name: /connect strava/i }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /reconnect/i }),
		).not.toBeInTheDocument();
	});
});

describe("ProviderCard — token_expired", () => {
	it("explains the lapse instead of showing a bare Connect button", () => {
		renderCard(makeIntegration("token_expired"));

		expect(screen.getByText("Reconnection needed")).toBeInTheDocument();
		expect(screen.getByText(/authorization has expired/i)).toBeInTheDocument();
	});

	it("offers Reconnect and Disconnect", () => {
		renderCard(makeIntegration("token_expired"));

		expect(
			screen.getByRole("button", { name: /reconnect strava/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /disconnect/i }),
		).toBeInTheDocument();
	});

	it("does not offer Sync Now — syncing cannot succeed without a valid token", () => {
		renderCard(makeIntegration("token_expired"));

		expect(
			screen.queryByRole("button", { name: /sync now/i }),
		).not.toBeInTheDocument();
	});

	it("routes Reconnect through the connect handler", async () => {
		const handlers = renderCard(makeIntegration("token_expired"));

		await userEvent.click(
			screen.getByRole("button", { name: /reconnect strava/i }),
		);

		expect(handlers.onConnect).toHaveBeenCalledOnce();
	});

	it("prefers the provider's own error message when present", () => {
		renderCard(
			makeIntegration("token_expired", {
				error_message: "Token refresh failed",
			}),
		);

		expect(screen.getByText("Token refresh failed")).toBeInTheDocument();
	});
});

describe("ProviderCard — error", () => {
	it("labels the state as a sync error, not a missing connection", () => {
		renderCard(makeIntegration("error"));

		expect(screen.getByText("Sync error")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /reconnect strava/i }),
		).toBeInTheDocument();
	});

	it("surfaces the recorded error message", () => {
		renderCard(
			makeIntegration("error", {
				error_message: "Failed to persist 3 of 12 activities",
			}),
		);

		expect(
			screen.getByText("Failed to persist 3 of 12 activities"),
		).toBeInTheDocument();
	});
});

describe("ProviderCard — comingSoon", () => {
	it("blocks connection when the provider is not yet approved", () => {
		renderCard(null, { comingSoon: true });

		expect(
			screen.getByText(/awaiting developer program approval/i),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /connect strava/i }),
		).toBeDisabled();
	});

	it.each([
		"fitbit",
		"garmin",
	] as const)("offers Disconnect instead of Reconnect when %s is coming soon and the grant has lapsed", async (provider) => {
		const handlers = renderCard(
			makeIntegration("token_expired", { provider }),
			{ provider, comingSoon: true },
		);

		expect(
			screen.queryByRole("button", { name: /reconnect/i }),
		).not.toBeInTheDocument();
		expect(screen.queryByText(/reconnect/i)).not.toBeInTheDocument();
		expect(screen.getByText("Authorization expired")).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: /disconnect/i }));

		expect(handlers.onDisconnect).toHaveBeenCalledOnce();
		expect(handlers.onConnect).not.toHaveBeenCalled();
	});

	it("offers Disconnect instead of Reconnect when a coming-soon provider is in error", () => {
		renderCard(makeIntegration("error", { provider: "garmin" }), {
			provider: "garmin",
			comingSoon: true,
		});

		expect(
			screen.getByRole("button", { name: /disconnect/i }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /reconnect/i }),
		).not.toBeInTheDocument();
		expect(screen.queryByText(/reconnect/i)).not.toBeInTheDocument();
	});
});
