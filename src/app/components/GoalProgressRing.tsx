interface GoalProgressRingProps {
	progress: number;
	size?: number;
	strokeWidth?: number;
	color?: string;
}

export function GoalProgressRing({
	progress,
	size = 80,
	strokeWidth = 6,
	color = "var(--phoenix-ember)",
}: GoalProgressRingProps) {
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const clamped = Math.min(Math.max(progress, 0), 100);
	const offset = circumference - (clamped / 100) * circumference;

	return (
		<svg
			width={size}
			height={size}
			className="transform -rotate-90"
			aria-label={`${Math.round(clamped)}% progress`}
		>
			{/* Background track */}
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="var(--secondary)"
				strokeWidth={strokeWidth}
			/>
			{/* Progress arc */}
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke={color}
				strokeWidth={strokeWidth}
				strokeDasharray={circumference}
				strokeDashoffset={offset}
				strokeLinecap="round"
				className="transition-all duration-700 ease-out"
			/>
			{/* Centered percentage text */}
			<text
				x={size / 2}
				y={size / 2}
				textAnchor="middle"
				dominantBaseline="central"
				className="fill-white text-sm font-semibold transform rotate-90"
				style={{ transformOrigin: "center" }}
			>
				{Math.round(clamped)}%
			</text>
		</svg>
	);
}
