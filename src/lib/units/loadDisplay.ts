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

export interface VolumeSessionRow {
	id: string;
	total_volume: number | null;
}
export interface VolumeExerciseRow {
	id: string;
	session_id: string;
	cable_count?: number | null;
}
export interface VolumeSetRow {
	exercise_id: string;
	weight_kg: number | null;
	actual_reps: number | null;
}

/**
 * Total load volume across sessions: each session's stored per-cable
 * total_volume scaled by the cables actually used. The scale is the
 * set-volume-weighted cable count of the session's exercises, where an
 * unknown count counts as 1 (per cable only, never assume 2). A single-cable
 * or unknown session is therefore never doubled.
 */
export function totalLoadVolumeKg(
	sessions: readonly VolumeSessionRow[],
	exercises: readonly VolumeExerciseRow[],
	sets: readonly VolumeSetRow[],
): number {
	const setVolumeByExercise = new Map<string, number>();
	for (const set of sets) {
		const volume = (set.weight_kg ?? 0) * (set.actual_reps ?? 0);
		setVolumeByExercise.set(
			set.exercise_id,
			(setVolumeByExercise.get(set.exercise_id) ?? 0) + volume,
		);
	}
	const exercisesBySession = new Map<string, VolumeExerciseRow[]>();
	for (const exercise of exercises) {
		const list = exercisesBySession.get(exercise.session_id) ?? [];
		list.push(exercise);
		exercisesBySession.set(exercise.session_id, list);
	}

	let total = 0;
	for (const session of sessions) {
		const perCable = session.total_volume ?? 0;
		const sessionExercises = exercisesBySession.get(session.id) ?? [];
		let base = 0;
		let weighted = 0;
		for (const exercise of sessionExercises) {
			const volume = setVolumeByExercise.get(exercise.id) ?? 0;
			base += volume;
			weighted += volume * (normalizeCableCount(exercise.cable_count) ?? 1);
		}
		let factor = 1;
		if (base > 0) {
			factor = weighted / base;
		} else {
			const counts = new Set(
				sessionExercises.map((e) => normalizeCableCount(e.cable_count)),
			);
			const [only] = [...counts];
			if (counts.size === 1 && only != null) factor = only;
		}
		total += perCable * factor;
	}
	return total;
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
