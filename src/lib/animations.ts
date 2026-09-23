/**
 * Centralized animation presets for Phoenix Portal — Signal aesthetic.
 * Tight, responsive instrument-panel feel. No bounce. No glow.
 * These are plain objects — no runtime dependency on motion/react.
 */

// --- Spring presets (Framer Motion transition configs) ---

export const springs = {
	/** Standard interaction — buttons, cards, toggles */
	snappy: { type: "spring", damping: 30, stiffness: 500 } as const,
	/** Content transitions — panels opening, route changes */
	smooth: { type: "spring", damping: 28, stiffness: 250 } as const,
	/** Quick micro-interactions — checkboxes, small state changes */
	quick: { type: "spring", damping: 35, stiffness: 600 } as const,
} as const;

// --- Motion recipes (spread directly into motion.* props) ---

/** Snappy opacity + translate entrance/exit for content and cards. */
export const fadeUp = {
	initial: { opacity: 0, y: 8 },
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0 },
	transition: { duration: 0.18, ease: "easeOut" },
} as const;

/** Simple opacity entrance */
export const fadeIn = {
	hidden: { opacity: 0 },
	visible: { opacity: 1, transition: { duration: 0.2 } },
} as const;

/** Parent recipe for staggered children. */
export const staggerContainer = {
	animate: { transition: { staggerChildren: 0.05 } },
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

// --- Exit presets (mirror entries with ease-in) ---

/** Single element exit: opacity 1→0, y 0→-8 (reverse of fadeUp) */
export const fadeOut = {
	visible: { opacity: 1, y: 0 },
	exit: {
		opacity: 0,
		y: -8,
		transition: { duration: 0.15, ease: [0.7, 0, 0.84, 0] },
	},
} as const;

/** Combined entry/exit for AnimatePresence wrappers */
export const fadeUpDown = {
	hidden: { opacity: 0, y: 8 },
	visible: { opacity: 1, y: 0, transition: springs.smooth },
	exit: {
		opacity: 0,
		y: -8,
		transition: { duration: 0.15, ease: [0.7, 0, 0.84, 0] },
	},
} as const;

// --- Hover & tap recipes ---

/** Subtle scale lift for interactive cards and panels. */
export const hover = { scale: 1.02 } as const;

/** Small press feedback for buttons and touch targets. */
export const tap = { scale: 0.97 } as const;

// --- Breathing animation (scroll indicator) ---

export const breathing = {
	animate: {
		y: [0, 4, 0] as number[],
		opacity: [0.5, 1, 0.5] as number[],
		transition: {
			duration: 2.5,
			repeat: Number.POSITIVE_INFINITY,
			ease: "easeInOut",
		},
	},
} as const;
