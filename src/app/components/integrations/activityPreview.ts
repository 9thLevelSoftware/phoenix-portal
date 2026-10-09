import type { NormalizedActivity } from "@/lib/integrations/types";

// Shared import-preview labels for the Hevy and Strong CSV cards.

export function getDateRange(activities: NormalizedActivity[]): string {
	if (activities.length === 0) return "";
	const dates = activities.map((a) => new Date(a.started_at).getTime());
	const earliest = new Date(Math.min(...dates));
	const latest = new Date(Math.max(...dates));
	return `${earliest.toLocaleDateString()} - ${latest.toLocaleDateString()}`;
}

export function getTotalDuration(activities: NormalizedActivity[]): string {
	const totalSeconds = activities.reduce(
		(sum, a) => sum + a.duration_seconds,
		0,
	);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}
