/**
 * Phoenix color constants for contexts where CSS variables cannot be used:
 * - SVG stroke/fill attributes
 * - Framer Motion animate targets
 * - Canvas drawing operations
 *
 * For all other contexts (Tailwind classes, inline styles), use CSS variables
 * from theme.css instead (e.g., var(--phoenix-ember) or bg-primary).
 */
export const PHOENIX = {
	ember: "#FF6B35",
	flameRed: "#DC2626",
	gold: "#F59E0B",
	forgeGreen: "#10B981",
	black: "#0D0D0D",
	white: "#FFFFFF",
	ashGray: "#6B7280",
	moltenSteel: "#374151",
	lightGray: "#E5E7EB",
	crimson: "#EF4444",
	flameYellow: "#FBBF24",
	mutedForeground: "#9CA3AF",
} as const;

/** Surface layer colors for programmatic use */
export const SURFACE = {
	base: "#0D0D0D",
	raised: "#141414",
	elevated: "#1A1A1A",
	overlay: "rgba(13, 13, 13, 0.95)",
} as const;

/** Semantic colors for data contexts (programmatic use) */
export const SEMANTIC = {
	positive: "#10B981",
	caution: "#F59E0B",
	info: "#60A5FA",
	negative: "#EF4444",
	neutral: "#6B7280",
} as const;

/** Chart palette for visx/Recharts programmatic configuration */
export const CHART_PALETTE = [
	PHOENIX.ember,
	PHOENIX.flameRed,
	PHOENIX.gold,
	PHOENIX.forgeGreen,
	PHOENIX.ashGray,
] as const;

export type PhoenixColor = (typeof PHOENIX)[keyof typeof PHOENIX];
