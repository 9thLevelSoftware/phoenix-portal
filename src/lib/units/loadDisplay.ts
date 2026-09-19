import { createElement } from "react";
import { formatWeight, type WeightUnit } from "@/lib/units";

/**
 * Load display adapter (KD-8).
 *
 * The database stores every load per cable, exactly as the phone shows it.
 * The per-cable figure is always the primary number. A total is shown beside
 * it only when the exercise's cable count is known (1 or 2). A NULL cable
 * count means "unknown" (legacy rows): show per-cable only and never assume
 * two cables, so single-cable sessions are never doubled.
 */
export type CableCount = 1 | 2;

export interface LoadDisplay {
	perCableKg: number;
	totalKg: number | null;
}

/** Normalise a raw cable count; anything other than exactly 1 or 2 is unknown. */
export function normalizeCableCount(value: unknown): CableCount | null {
	return value === 1 || value === 2 ? value : null;
}

export function toLoadDisplay(
	perCableKg: number | null | undefined,
	cableCount: number | null | undefined,
): LoadDisplay {
	const perCable =
		perCableKg == null || !Number.isFinite(perCableKg) ? 0 : perCableKg;
	const count = normalizeCableCount(cableCount);
	return {
		perCableKg: perCable,
		totalKg: count == null ? null : perCable * count,
	};
}

/**
 * Format a load as "20 kg per cable · 40 kg total", or "20 kg per cable"
 * when the cable count is unknown.
 */
export function formatLoad(
	perCableKg: number | null | undefined,
	cableCount: number | null | undefined,
	unit: WeightUnit,
): string {
	const { perCableKg: perCable, totalKg } = toLoadDisplay(
		perCableKg,
		cableCount,
	);
	const primary = `${formatWeight(perCable, unit)} per cable`;
	return totalKg == null
		? primary
		: `${primary} · ${formatWeight(totalKg, unit)} total`;
}

/**
 * Unit label for per-cable figures shown without a known cable count
 * (charts, stat cards, records, 1RM): "kg per cable" / "lbs per cable".
 */
export function perCableUnitLabel(unit: WeightUnit): string {
	return `${unit} per cable`;
}

export interface LoadValueProps {
	perCableKg: number | null | undefined;
	cableCount?: number | null;
	unit: WeightUnit;
	className?: string;
}

/** Inline element rendering {@link formatLoad}; use it wherever a load is shown. */
export function LoadValue({
	perCableKg,
	cableCount = null,
	unit,
	className,
}: LoadValueProps) {
	return createElement(
		"span",
		{ className, "data-testid": "load-value" },
		formatLoad(perCableKg, cableCount, unit),
	);
}
