/**
 * Phoenix Signal color constants for contexts where CSS variables cannot be used:
 * - SVG stroke/fill attributes
 * - Framer Motion animate targets
 * - Canvas drawing operations
 *
 * For all other contexts (Tailwind classes, inline styles), use CSS variables
 * from theme.css instead (e.g., var(--cable-a) or bg-primary).
 */
export const PHOENIX = {
	ember: "#FF6B35",
	flameRed: "#DC2626",
	gold: "#F59E0B",
	forgeGreen: "#10B981",
	black: "#06060a",
	white: "#e0e0e8",
	ashGray: "#6B7280",
	moltenSteel: "#374151",
	lightGray: "#E5E7EB",
	crimson: "#EF4444",
	flameYellow: "#FBBF24",
	mutedForeground: "#888894",
} as const;

/** Cable colors — the bilateral identity of Phoenix */
export const CABLE = {
	a: "#FF6B35",
	b: "#6ba3f7",
	aDim: "rgba(255, 107, 53, 0.15)",
	bDim: "rgba(107, 163, 247, 0.15)",
} as const;

/** Signal status colors */
export const SIGNAL = {
	ok: "#00e676",
	warn: "#ffab00",
	danger: "#ff5252",
} as const;

/** Surface layer colors for programmatic use */
export const SURFACE = {
	base: "#06060a",
	raised: "#0a0a10",
	elevated: "#0e0e14",
	overlay: "rgba(6, 6, 10, 0.95)",
} as const;

/** Semantic colors for data contexts (programmatic use) */
export const SEMANTIC = {
	positive: "#00e676",
	caution: "#ffab00",
	info: "#6ba3f7",
	negative: "#ff5252",
	neutral: "#4a4a56",
} as const;

/** Velocity zone colors */
export const VELOCITY_ZONES = {
	explosive: "#ff5252",
	fast: "#ffab00",
	moderate: "#00e676",
	slow: "#448aff",
	grind: "#7c4dff",
} as const;

/** Chart palette for visx/Recharts programmatic configuration */
export const CHART_PALETTE = [
	PHOENIX.ember,
	CABLE.b,
	PHOENIX.gold,
	SIGNAL.ok,
	"#7c4dff",
] as const;

export type PhoenixColor = (typeof PHOENIX)[keyof typeof PHOENIX];
