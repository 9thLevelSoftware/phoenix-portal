import { formatVolume, type WeightUnit } from "@/lib/units";

export function formatChallengeValue(
	value: number,
	challengeType: string,
	unit: WeightUnit,
	targetUnit?: string | null,
): string {
	if (challengeType === "volume") {
		return formatVolume(value, unit);
	}
	return `${value.toLocaleString()}${targetUnit ? ` ${targetUnit}` : ""}`;
}
