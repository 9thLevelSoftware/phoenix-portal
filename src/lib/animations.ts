/**
 * Centralized animation presets for Phoenix Portal.
 * All Framer Motion animations should import from here.
 * These are plain objects — no runtime dependency on motion/react.
 */

// --- Spring presets (Framer Motion transition configs) ---

export const springs = {
	snappy: { type: "spring", damping: 30, stiffness: 500 } as const,
	smooth: { type: "spring", damping: 25, stiffness: 200 } as const,
	bouncy: { type: "spring", damping: 15, stiffness: 300 } as const,
	gentle: { type: "spring", damping: 20, stiffness: 100 } as const,
} as const;

// --- Variant presets (Framer Motion variants objects) ---

/** Single element entrance: opacity 0→1, y 12→0 */
export const fadeUp = {
	hidden: { opacity: 0, y: 12 },
	visible: { opacity: 1, y: 0, transition: springs.smooth },
} as const;

/** Simple opacity entrance */
export const fadeIn = {
	hidden: { opacity: 0 },
	visible: { opacity: 1, transition: { duration: 0.3 } },
} as const;

/** Parent variant for staggered children */
export const staggerContainer = {
	hidden: { opacity: 0 },
	visible: {
		opacity: 1,
		transition: {
			staggerChildren: 0.06,
			delayChildren: 0.1,
		},
	},
} as const;

/** Route transition variant (used by AnimatePresence) */
export const pageTransition = {
	initial: { opacity: 0, y: 8 },
	animate: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.25, ease: "easeOut" },
	},
	exit: {
		opacity: 0,
		y: -8,
		transition: { duration: 0.15, ease: "easeIn" },
	},
} as const;

// --- Hover & tap presets ---

export const hover = {
	lift: { scale: 1.015, y: -2, transition: springs.snappy },
	glow: { scale: 1.01, transition: springs.smooth },
} as const;

export const tap = {
	press: { scale: 0.97 },
} as const;

// --- Breathing animation (scroll indicator) ---

export const breathing = {
	animate: {
		y: [0, 6, 0] as number[],
		opacity: [0.6, 1, 0.6] as number[],
		transition: {
			duration: 2,
			repeat: Number.POSITIVE_INFINITY,
			ease: "easeInOut",
		},
	},
} as const;
