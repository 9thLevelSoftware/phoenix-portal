/**
 * Centralized animation presets for Phoenix Portal — Signal aesthetic.
 * Tight, responsive instrument-panel feel. No bounce. No glow.
 * These are plain objects — no runtime dependency on motion/react.
 */

// --- Motion recipes (spread directly into motion.* props) ---

/** Snappy opacity + translate entrance/exit for content and cards. */
export const fadeUp = {
	initial: { opacity: 0, y: 8 },
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0 },
	transition: { duration: 0.18, ease: "easeOut" },
} as const;

/** Variants-shaped opacity + translate entrance for staggered children. */
export const fadeUpVariants = {
	hidden: { opacity: 0, y: 8 },
	visible: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.18, ease: "easeOut" },
	},
} as const;

/** Parent variants for staggered children. Use with `variants={staggerContainer}` and `initial="hidden" animate="visible"`. */
export const staggerContainer = {
	hidden: {},
	visible: {
		transition: { staggerChildren: 0.05 },
	},
} as const;

/** Route transition variant (used by AnimatePresence) */
export const pageTransition = {
	initial: { opacity: 0, y: 6 },
	animate: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.2, ease: "easeOut" },
	},
	exit: {
		opacity: 0,
		y: -6,
		transition: { duration: 0.12, ease: "easeIn" },
	},
} as const;

// --- Hover & tap recipes ---

/** Subtle scale lift for interactive cards and panels. */
export const hover = { scale: 1.02 } as const;

/** Small press feedback for buttons and touch targets. */
export const tap = { scale: 0.97 } as const;
