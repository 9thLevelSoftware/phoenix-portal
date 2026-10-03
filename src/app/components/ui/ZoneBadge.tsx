import { withAlpha } from "@/lib/theme-tokens";
import type { SimplifiedZoneInfo } from "@/lib/vbt";
import { cn } from "./utils";

export interface ZoneBadgeProps {
	zone: SimplifiedZoneInfo;
	className?: string;
}

/**
 * ZoneBadge - Visual indicator for the simplified velocity zone
 * classification (mobile-matching).
 *
 * @example
 * <ZoneBadge zone={simplifiedZone} />
 */
export function ZoneBadge({ zone, className }: ZoneBadgeProps) {
	return (
		<div
			className={cn(
				"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
				className,
			)}
			style={{
				backgroundColor: withAlpha(zone.color, 0.08),
				borderColor: withAlpha(zone.color, 0.25),
				color: zone.color,
			}}
			title={`${zone.label} — Simplified classification`}
		>
			<span
				className="h-1.5 w-1.5 rounded-full"
				style={{ backgroundColor: zone.color }}
			/>
			<span>{zone.label}</span>
		</div>
	);
}

export interface ZoneIndicatorProps {
	className?: string;
}

/**
 * ZoneIndicator - Small badge for the simplified zone classification.
 * Shows as a subtle pill badge.
 *
 * @example
 * <ZoneIndicator />
 */
// Fixed accent for the simplified zone classification.
// Using inline style (matching the ZoneBadge pattern) keeps this
// colour-coded by data intent rather than by raw Tailwind palette.
const SIMPLIFIED_ACCENT = "var(--accent)"; // Phoenix Gold — mobile-matching zones

export function ZoneIndicator({ className }: ZoneIndicatorProps) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
				className,
			)}
			style={{
				backgroundColor: withAlpha(SIMPLIFIED_ACCENT, 0.1),
				borderColor: withAlpha(SIMPLIFIED_ACCENT, 0.2),
				color: SIMPLIFIED_ACCENT,
			}}
			title="Mobile-matching simplified zones"
		>
			Simplified
		</span>
	);
}
