import { motion } from "motion/react";
import type { RecoveryResult } from "@/lib/recovery";

const statusColors = {
	elevated: {
		ring: "text-success",
		bg: "from-success/20 to-success/5",
		text: "text-success",
	},
	moderate: {
		ring: "text-accent",
		bg: "from-accent/20 to-accent/5",
		text: "text-accent",
	},
	low: {
		ring: "text-chart-2",
		bg: "from-chart-2/20 to-chart-2/5",
		text: "text-chart-2",
	},
} as const;

interface RecoveryScoreProps {
	result: RecoveryResult;
	size?: "sm" | "lg";
}

export function RecoveryScore({ result, size = "lg" }: RecoveryScoreProps) {
	const colors = statusColors[result.status];
	const isLarge = size === "lg";
	const svgSize = isLarge ? 180 : 80;
	const strokeWidth = isLarge ? 10 : 6;
	const radius = (svgSize - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const progress = result.score / 100;
	const dashOffset = circumference * (1 - progress);

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.9 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ duration: 0.4, ease: "easeOut" }}
			className={`flex ${isLarge ? "flex-col" : "flex-row"} items-center ${isLarge ? "gap-4" : "gap-3"}`}
		>
			{/* Circular gauge */}
			<div className="relative">
				<svg width={svgSize} height={svgSize} className="-rotate-90">
					{/* Background track */}
					<circle
						cx={svgSize / 2}
						cy={svgSize / 2}
						r={radius}
						fill="none"
						stroke="currentColor"
						strokeWidth={strokeWidth}
						className="text-secondary"
					/>
					{/* Progress arc */}
					<motion.circle
						cx={svgSize / 2}
						cy={svgSize / 2}
						r={radius}
						fill="none"
						stroke="currentColor"
						strokeWidth={strokeWidth}
						strokeLinecap="round"
						strokeDasharray={circumference}
						initial={{ strokeDashoffset: circumference }}
						animate={{ strokeDashoffset: dashOffset }}
						transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
						className={colors.ring}
					/>
				</svg>
				{/* Score number in center */}
				<div className="absolute inset-0 flex items-center justify-center rotate-0">
					<motion.span
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.5 }}
						className={`${isLarge ? "text-4xl" : "text-lg"} font-bold text-white`}
					>
						{result.score}
					</motion.span>
				</div>
			</div>

			{/* Label */}
			{isLarge && (
				<motion.p
					initial={{ opacity: 0, y: 10 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.6 }}
					className={`text-center text-sm ${colors.text}`}
				>
					{result.label}
				</motion.p>
			)}
		</motion.div>
	);
}
