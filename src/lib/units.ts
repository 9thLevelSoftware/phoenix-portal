export const KG_TO_LBS = 2.20462;

export type WeightUnit = "kg" | "lbs";

function safeNumber(value: number | null | undefined): number {
	if (value == null || Number.isNaN(value)) return 0;
	return value;
}

function trimTrailingZeros(value: string): string {
	return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function normalizeWeightUnit(
	unit: string | null | undefined,
): WeightUnit {
	return unit === "lbs" ? "lbs" : "kg";
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

export function weightInputValue(
	valueKg: number | null | undefined,
	unit: WeightUnit,
): string {
	if (valueKg == null || Number.isNaN(valueKg)) return "";
	const converted = convertWeight(valueKg, unit);
	return trimTrailingZeros(converted.toFixed(1));
}

export function weightInputToKg(
	value: string | number | null | undefined,
	unit: WeightUnit,
): number {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim() !== ""
				? Number(value)
				: Number.NaN;
	if (!Number.isFinite(parsed)) return 0;
	return unit === "lbs" ? parsed / KG_TO_LBS : parsed;
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

export function isWeightUnit(unit: unknown): unit is WeightUnit {
	return unit === "kg" || unit === "lbs";
}

export function convertWeightFromUnit(
	value: number | null | undefined,
	fromUnit: string | null | undefined,
	toUnit: WeightUnit,
): number {
	const sourceValue = safeNumber(value);
	if (fromUnit === "lbs") {
		const valueKg = sourceValue / KG_TO_LBS;
		return toUnit === "lbs" ? sourceValue : valueKg;
	}
	return convertWeight(sourceValue, toUnit);
}

export function formatWeightMetric(
	valueKg: number | null | undefined,
	unit: WeightUnit,
): string {
	return formatWeight(valueKg, unit);
}

export function formatVolumeMetric(
	valueKg: number | null | undefined,
	unit: WeightUnit,
): string {
	return formatVolume(valueKg, unit);
}

export function formatLeaderboardValue(
	valueKg: number,
	metric: string,
	unit: WeightUnit,
): string {
	if (metric.toLowerCase().includes("volume")) {
		return formatVolume(valueKg, unit);
	}
	return valueKg.toLocaleString();
}
