import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Recovery } from "@/app/components/Recovery";
import type { RecoveryResult } from "@/lib/recovery";
import { renderWithProviders } from "@/test/test-utils";

const ungatedRecovery: RecoveryResult = {
	score: 72,
	status: "elevated",
	label: "Your recovery capacity appears elevated",
	isGated: false,
	isClamped: false,
	factors: {
		acwr: 1,
		weeklyVolume: 12000,
		chronicVolume: 60000,
		trainingFrequency: 3,
		restDays: 4,
		cyclePosition: null,
	},
};

const recoveryScore = vi.hoisted(() => ({
	recovery: null as RecoveryResult | null,
	wearable: null as
		| {
				id: string;
				provider: string;
				raw_data: unknown;
				synced_at: Date;
		  }[]
		| null,
	isLoading: false,
	isError: false,
	error: null as Error | null,
	daysSinceFirstSession: 40,
	isWearablePending: false,
	isWearableError: false,
}));

vi.mock("@/hooks/useRecoveryScore", () => ({
	useRecoveryScore: () => recoveryScore,
}));

vi.mock("@/hooks/useSubscription", () => ({
	useSubscription: () => ({
		isEntitled: true,
		isFlame: false,
		isInferno: false,
		tier: "EMBER",
		isError: false,
		isLoading: false,
	}),
}));

vi.mock("@/hooks/useOnboarding", () => ({
	useOnboarding: () => ({
		showHints: false,
		onboarding: null,
		dismissHint: { mutate: vi.fn() },
	}),
}));

describe("Recovery wearable section", () => {
	beforeEach(() => {
		recoveryScore.recovery = ungatedRecovery;
		recoveryScore.wearable = null;
		recoveryScore.isLoading = false;
		recoveryScore.isError = false;
		recoveryScore.error = null;
		recoveryScore.daysSinceFirstSession = 40;
		recoveryScore.isWearablePending = false;
		recoveryScore.isWearableError = false;
	});

	it("shows the score while wearable data is still loading", () => {
		recoveryScore.isWearablePending = true;

		renderWithProviders(<Recovery />);

		expect(screen.getByText("72")).toBeInTheDocument();
		expect(
			screen.queryByText("No wearable data connected"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText("Couldn't load wearable data"),
		).not.toBeInTheDocument();
	});

	it("shows a wearable load error instead of the not-connected state", () => {
		recoveryScore.isWearableError = true;

		renderWithProviders(<Recovery />);

		expect(screen.getByText("72")).toBeInTheDocument();
		expect(screen.getByText("Couldn't load wearable data")).toBeInTheDocument();
		expect(
			screen.queryByText("No wearable data connected"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: /connect a wearable/i }),
		).not.toBeInTheDocument();
	});

	it("shows the not-connected state only when the wearable query is empty", () => {
		renderWithProviders(<Recovery />);

		expect(screen.getByText("No wearable data connected")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /connect a wearable/i }),
		).toBeInTheDocument();
	});
});
