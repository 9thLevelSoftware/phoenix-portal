export type FreshnessStatus =
	| "live"
	| "refreshing"
	| "stale"
	| "reconnecting"
	| "partial"
	| "unavailable";

export interface FreshnessInput {
	dataUpdatedAt?: number | null;
	nowMs?: number;
	staleAfterMs?: number;
	isFetching: boolean;
	hasError: boolean;
	partialTelemetry?: boolean;
	processingAvailable?: boolean;
}

export interface FreshnessState {
	status: FreshnessStatus;
	label: string;
	description: string;
	flags: string[];
	lastUpdatedLabel: string | null;
}

function formatLastUpdated(
	timestamp: number | null | undefined,
): string | null {
	if (!timestamp) return null;
	return new Date(timestamp).toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
}

export function buildFreshnessState({
	dataUpdatedAt,
	nowMs = Date.now(),
	staleAfterMs = 10 * 60 * 1000,
	isFetching,
	hasError,
	partialTelemetry = false,
	processingAvailable = true,
}: FreshnessInput): FreshnessState {
	const lastUpdatedLabel = formatLastUpdated(dataUpdatedAt);
	const ageMs = dataUpdatedAt ? nowMs - dataUpdatedAt : null;
	const flags: string[] = [];

	if (!processingAvailable) {
		flags.push("Processing unavailable");
	}

	if (partialTelemetry) {
		flags.push("Partial telemetry");
		return {
			status: "partial",
			label: "Partial data",
			description: lastUpdatedLabel
				? `Last updated ${lastUpdatedLabel}. Some telemetry is missing.`
				: "Some telemetry is missing.",
			flags,
			lastUpdatedLabel,
		};
	}

	if (hasError && isFetching) {
		flags.push("Reconnecting");
		return {
			status: "reconnecting",
			label: "Reconnecting",
			description: lastUpdatedLabel
				? `Keeping last update from ${lastUpdatedLabel} visible while reconnecting.`
				: "Reconnecting to refresh the latest data.",
			flags,
			lastUpdatedLabel,
		};
	}

	if (hasError) {
		flags.push("Refresh failed");
		return {
			status: "stale",
			label: "Stale data",
			description: lastUpdatedLabel
				? `Last updated ${lastUpdatedLabel}. Refresh failed.`
				: "Refresh failed before any data was loaded.",
			flags,
			lastUpdatedLabel,
		};
	}

	if (!dataUpdatedAt) {
		return {
			status: "unavailable",
			label: "No data yet",
			description: "Waiting for the first successful sync.",
			flags,
			lastUpdatedLabel: null,
		};
	}

	if (isFetching) {
		flags.push("Refreshing");
		return {
			status: "refreshing",
			label: "Refreshing",
			description: `Last updated ${lastUpdatedLabel}. Pulling the newest sync.`,
			flags,
			lastUpdatedLabel,
		};
	}

	if (ageMs != null && ageMs > staleAfterMs) {
		flags.push("Stale");
		return {
			status: "stale",
			label: "Stale data",
			description: `Last updated ${lastUpdatedLabel}. Waiting for the next sync_complete refresh.`,
			flags,
			lastUpdatedLabel,
		};
	}

	return {
		status: "live",
		label: "Up to date",
		description: `Last updated ${lastUpdatedLabel}.`,
		flags,
		lastUpdatedLabel,
	};
}
