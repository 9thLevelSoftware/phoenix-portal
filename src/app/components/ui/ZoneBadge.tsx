import type { MannZoneInfo, SimplifiedZoneInfo } from "@/lib/vbt";
import { cn } from "./utils";

export type ZoneSystem = "mann" | "simplified";

export interface ZoneBadgeProps {
	zone: MannZoneInfo | SimplifiedZoneInfo;
	system: ZoneSystem;
	showLabel?: boolean;
	showDot?: boolean;
	size?: "sm" | "md" | "lg";
	className?: string;
}

const sizeClasses = {
	sm: {
		badge: "text-xs px-2 py-0.5 gap-1",
		dot: "w-1.5 h-1.5",
	},
	md: {
		badge: "text-sm px-2.5 py-1 gap-1.5",
		dot: "w-2 h-2",
	},
	lg: {
		badge: "text-base px-3 py-1.5 gap-2",
		dot: "w-2.5 h-2.5",
	},
};

/**
 * ZoneBadge - Visual indicator showing which velocity zone classification
 * is active and the current zone classification.
 *
 * Used across velocity profile charts and workout detail views.
 *
 * @example
 * // Dr. Mann zone badge
 * <ZoneBadge zone={mannZone} system="mann" />
 *
 * // Simplified zone badge (mobile-matching)
 * <ZoneBadge zone={simplifiedZone} system="simplified" size="sm" />
 */
export function ZoneBadge({
	zone,
	system,
	showLabel = true,
	showDot = true,
	size = "md",
	className,
}: ZoneBadgeProps) {
	const sizes = sizeClasses[size];
	const systemLabel = system === "mann" ? "Dr. Mann VBT" : "Simplified";

	return (
		<div
			className={cn(
				"inline-flex items-center rounded-full border font-medium",
				sizes.badge,
				className,
			)}
			style={{
				backgroundColor: `${zone.color}15`,
				borderColor: `${zone.color}40`,
				color: zone.color,
			}}
			title={`${zone.label} — ${systemLabel} classification`}
		>
			{showDot && (
				<span
					className={cn("rounded-full", sizes.dot)}
					style={{ backgroundColor: zone.color }}
				/>
			)}
			{showLabel ? (
				<span>{zone.label}</span>
			) : (
				// Without a visible label the badge is only a color dot; expose the
				// classification as visually-hidden text for screen-reader users.
				<span className="sr-only">{`${zone.label} — ${systemLabel} classification`}</span>
			)}
		</div>
	);
}

export interface ZoneIndicatorProps {
	system: ZoneSystem;
	className?: string;
}

/**
 * ZoneIndicator - Small badge indicating which zone classification system
 * is currently active. Shows as a subtle pill badge.
 *
 * @example
 * <ZoneIndicator system="mann" />
 * <ZoneIndicator system="simplified" />
 */
export function ZoneIndicator({ system, className }: ZoneIndicatorProps) {
	const isMann = system === "mann";
	const label = isMann ? "Dr. Mann VBT" : "Simplified";
	const description = isMann
		? "Advanced velocity-based training zones"
		: "Mobile-matching simplified zones";

	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
				isMann
					? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
					: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
				className,
			)}
			title={description}
		>
			{label}
		</span>
	);
}
