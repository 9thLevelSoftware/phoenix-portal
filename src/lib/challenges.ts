import { formatVolume, type WeightUnit } from "@/lib/units";

export function formatChallengeValue(
	value: number,
	challengeType: string,
	unit: WeightUnit,
	targetUnit?: string | null,
): string {
	if (challengeType === "volume") {
		// Volume challenges count total load (per cable x cables used; KD-8).
		return `${formatVolume(value, unit)} total`;
	}
	return `${value.toLocaleString()}${targetUnit ? ` ${targetUnit}` : ""}`;
}
