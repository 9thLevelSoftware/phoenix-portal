export const KG_TO_LBS = 2.20462;

export type WeightUnit = "kg" | "lbs";

function safeNumber(value: number | null | undefined): number {
	if (value == null || Number.isNaN(value)) return 0;
	return value;
}

export function convertWeight(
	valueKg: number | null | undefined,
	unit: WeightUnit,
): number {
	const value = safeNumber(valueKg);
	return unit === "lbs" ? value * KG_TO_LBS : value;
}

export function formatWeight(
	valueKg: number | null | undefined,
	unit: WeightUnit,
): string {
	const converted = convertWeight(valueKg, unit);
	if (unit === "lbs") {
		return `${converted.toFixed(1)} lbs`;
	}
	return `${Math.round(converted)} kg`;
}

export function toKg(valueLbs: number | null | undefined): number {
	return safeNumber(valueLbs) / KG_TO_LBS;
}

export function formatVolume(
	valueKg: number | null | undefined,
	unit: WeightUnit,
): string {
	const converted = convertWeight(valueKg, unit);
	const absValue = Math.abs(converted);

	if (absValue >= 1_000_000) {
		return `${(converted / 1_000_000).toFixed(1)}M ${unit}`;
	}
	if (absValue >= 1_000) {
		return `${(converted / 1_000).toFixed(1)}K ${unit}`;
	}
	if (unit === "lbs") {
		return `${converted.toFixed(1)} lbs`;
	}
	return `${Math.round(converted)} kg`;
}

export function getUnitLabel(unit: WeightUnit): WeightUnit {
	return unit;
}
