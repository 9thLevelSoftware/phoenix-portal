export type VbtZone =
	| "absolute-strength"
	| "accelerative-strength"
	| "strength-speed"
	| "speed-strength"
	| "starting-strength";

export interface VbtZoneInfo {
	zone: VbtZone;
	label: string;
	color: string;
	minVelocity: number;
	maxVelocity: number;
	description: string;
}

/**
 * Dr. Bryan Mann's velocity-based training zone thresholds.
 * Colors map to Phoenix theme palette.
 */
export const VBT_ZONES: VbtZoneInfo[] = [
	{
		zone: "absolute-strength",
		label: "Absolute Strength",
		color: "#DC2626",
		minVelocity: 0,
		maxVelocity: 0.5,
		description: "Maximum force production, heavy grinding reps",
	},
	{
		zone: "accelerative-strength",
		label: "Accelerative Strength",
		color: "#FF6B35",
		minVelocity: 0.5,
		maxVelocity: 0.75,
		description: "Heavy with intent to accelerate",
	},
	{
		zone: "strength-speed",
		label: "Strength-Speed",
		color: "#F59E0B",
		minVelocity: 0.75,
		maxVelocity: 1.0,
		description: "Moderate load moved with speed",
	},
	{
		zone: "speed-strength",
		label: "Speed-Strength",
		color: "#10B981",
		minVelocity: 1.0,
		maxVelocity: 1.3,
		description: "Light load, emphasis on velocity",
	},
	{
		zone: "starting-strength",
		label: "Starting Strength",
		color: "#3B82F6",
		minVelocity: 1.3,
		maxVelocity: Infinity,
		description: "Explosive movement from dead stop",
	},
];

/**
 * Classify a mean velocity into its VBT training zone.
 * Falls back to absolute-strength for any edge cases.
 */
export function classifyVbtZone(meanVelocityMps: number): VbtZoneInfo {
	const zone = VBT_ZONES.find(
		(z) => meanVelocityMps >= z.minVelocity && meanVelocityMps < z.maxVelocity,
	);
	return zone ?? VBT_ZONES[0];
}
