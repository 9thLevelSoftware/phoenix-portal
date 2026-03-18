export interface ConsistencyWidgetProps {
	weeklyData: {
		current: number;
		target: number;
		lastWeek: number;
		twoWeeksAgo: number;
	};
	avgPerWeek: number;
	hitRate: number;
	mostActiveDay: string;
}

interface RingConfig {
	sessions: number;
	target: number;
	color: string;
	radius: number;
	strokeWidth: number;
}

function ProgressRing({
	sessions,
	target,
	color,
	radius,
	strokeWidth,
	cx,
	cy,
}: RingConfig & { cx: number; cy: number }) {
	const circumference = 2 * Math.PI * radius;
	const fill = target > 0 ? Math.min(sessions / target, 1) : 0;
	const dashOffset = circumference - fill * circumference;

	return (
		<g>
			{/* Track */}
			<circle
				cx={cx}
				cy={cy}
				r={radius}
				fill="none"
				stroke="#1F2937"
				strokeWidth={strokeWidth}
			/>
			{/* Progress arc */}
			<circle
				cx={cx}
				cy={cy}
				r={radius}
				fill="none"
				stroke={color}
				strokeWidth={strokeWidth}
				strokeDasharray={circumference}
				strokeDashoffset={dashOffset}
				strokeLinecap="round"
				style={{ transition: "stroke-dashoffset 0.7s ease-out" }}
			/>
		</g>
	);
}

export function ConsistencyWidget({
	weeklyData,
	avgPerWeek,
	hitRate,
	mostActiveDay,
}: ConsistencyWidgetProps) {
	const { current, target, lastWeek, twoWeeksAgo } = weeklyData;

	// SVG layout constants
	const svgSize = 120;
	const cx = svgSize / 2;
	const cy = svgSize / 2;
	const outerRadius = 50;
	const middleRadius = 37;
	const innerRadius = 24;
	const strokeWidth = 8;

	return (
		<div className="flex flex-col gap-4">
			{/* Concentric rings + center text */}
			<div className="flex justify-center">
				<div className="relative">
					<svg
						width={svgSize}
						height={svgSize}
						viewBox={`0 0 ${svgSize} ${svgSize}`}
						style={{ transform: "rotate(-90deg)" }}
						aria-label={`Weekly goal: ${current} of ${target} sessions. Last week: ${lastWeek}. Two weeks ago: ${twoWeeksAgo}.`}
						role="img"
					>
						{/* Outer ring: this week (ember) */}
						<ProgressRing
							sessions={current}
							target={target}
							color="#FF6B35"
							radius={outerRadius}
							strokeWidth={strokeWidth}
							cx={cx}
							cy={cy}
						/>
						{/* Middle ring: last week (gold) */}
						<ProgressRing
							sessions={lastWeek}
							target={target}
							color="#F59E0B"
							radius={middleRadius}
							strokeWidth={strokeWidth}
							cx={cx}
							cy={cy}
						/>
						{/* Inner ring: two weeks ago (green) */}
						<ProgressRing
							sessions={twoWeeksAgo}
							target={target}
							color="#10B981"
							radius={innerRadius}
							strokeWidth={strokeWidth}
							cx={cx}
							cy={cy}
						/>
					</svg>

					{/* Center text overlay (not rotated) */}
					<div
						className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
						aria-hidden="true"
					>
						<span className="text-lg font-bold text-white leading-none">
							{current}/{target}
						</span>
						<span className="text-[10px] text-muted-foreground leading-none mt-0.5">
							this week
						</span>
					</div>
				</div>
			</div>

			{/* Ring legend */}
			<div className="flex justify-center gap-3 text-[10px] text-muted-foreground">
				<span className="flex items-center gap-1">
					<span className="inline-block w-2 h-2 rounded-full bg-[#FF6B35]" />
					This week
				</span>
				<span className="flex items-center gap-1">
					<span className="inline-block w-2 h-2 rounded-full bg-[#F59E0B]" />
					Last week
				</span>
				<span className="flex items-center gap-1">
					<span className="inline-block w-2 h-2 rounded-full bg-[#10B981]" />
					2 weeks ago
				</span>
			</div>

			{/* Stats row */}
			<div className="grid grid-cols-3 gap-2">
				<div className="flex flex-col items-center rounded-lg bg-muted/40 px-2 py-2 text-center">
					<span className="text-base font-bold text-white leading-none">
						{avgPerWeek.toFixed(1)}
					</span>
					<span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
						avg / week
					</span>
				</div>
				<div className="flex flex-col items-center rounded-lg bg-muted/40 px-2 py-2 text-center">
					<span className="text-base font-bold text-[#FF6B35] leading-none">
						{Math.round(hitRate)}%
					</span>
					<span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
						hit rate
					</span>
				</div>
				<div className="flex flex-col items-center rounded-lg bg-muted/40 px-2 py-2 text-center">
					<span className="text-base font-bold text-white leading-none truncate w-full text-center">
						{mostActiveDay}
					</span>
					<span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
						top day
					</span>
				</div>
			</div>
		</div>
	);
}
