/**
 * Display labels for personal_records.record_type.
 * The Records tab and the CSV export both read this map, so a type the
 * tab shows is exported under the same label. Keys are the uppercase DB
 * values accepted by the mobile push (PERSONAL_RECORD_TYPES).
 */
export const PERSONAL_RECORD_TYPE_LABELS = {
	MAX_WEIGHT: "Weight PR",
	MAX_VOLUME: "Volume PR",
	"1RM": "1RM PR",
	MAX_REPS: "Reps PR",
	MAX_DURATION: "Duration PR",
	MAX_FORCE: "Force PR",
	MAX_VELOCITY: "Velocity PR",
	FASTEST_TIME: "Fastest Time",
	LONGEST_DISTANCE: "Longest Distance",
} as const;

const labels: Record<string, string> = PERSONAL_RECORD_TYPE_LABELS;

/**
 * Normalize so legacy lowercase values map too. Unknown types keep the
 * original text — the CSV formula-escape path depends on that passthrough.
 */
export function formatPersonalRecordTypeLabel(
	recordType: string | null | undefined,
): string {
	return labels[(recordType ?? "").toUpperCase()] ?? recordType ?? "";
}
