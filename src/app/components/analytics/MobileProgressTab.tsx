import { TrendingUp } from "lucide-react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { MobileChartCard } from "@/app/components/analytics/MobileChartCard";
import { RechartsTooltip } from "@/app/components/charts/shared/RechartsTooltip";
import { PHOENIX } from "@/lib/colors";
import type { WeightUnit } from "@/lib/units";

export interface MobileProgressTabProps {
	unit: WeightUnit;
	mobileStrengthData: Array<{ exercise: string; weight: number }>;
	mobileVolumeData: Array<{ date: string; volume: number }>;
	prCount: number;
	daysSinceLastPR: number | null;
}

export default function MobileProgressTab({
	unit,
	mobileStrengthData,
	mobileVolumeData,
	prCount,
	daysSinceLastPR,
}: MobileProgressTabProps) {
	return (
		<>
			<MobileChartCard title={`TOP LIFTS (1RM - ${unit.toUpperCase()})`}>
				{mobileStrengthData.length > 0 ? (
					<ResponsiveContainer width="100%" height={250}>
						<BarChart data={mobileStrengthData} layout="vertical">
							<XAxis
								type="number"
								stroke={PHOENIX.ashGray}
								tickLine={false}
								axisLine={false}
								tick={{
									fontSize: 11,
									fontFamily: "Inter, sans-serif",
								}}
							/>
							<YAxis
								type="category"
								dataKey="exercise"
								stroke={PHOENIX.ashGray}
								width={70}
								tickLine={false}
								axisLine={false}
								tick={{
									fontSize: 11,
									fontFamily: "Inter, sans-serif",
								}}
							/>
							<Tooltip content={<RechartsTooltip />} />
							<Bar
								dataKey="weight"
								name={`Weight (${unit})`}
								fill={PHOENIX.ember}
								radius={[0, 4, 4, 0]}
								animationDuration={800}
								animationEasing="ease-out"
							/>
						</BarChart>
					</ResponsiveContainer>
				) : (
					<div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
						No strength data yet. Set some PRs!
					</div>
				)}
			</MobileChartCard>

			<MobileChartCard title="VOLUME TREND">
				{mobileVolumeData.length > 0 ? (
					<ResponsiveContainer width="100%" height={250}>
						<AreaChart data={mobileVolumeData}>
							<defs>
								<linearGradient
									id="mobileTrendGradient"
									x1="0"
									y1="0"
									x2="0"
									y2="1"
								>
									<stop
										offset="5%"
										stopColor={PHOENIX.ember}
										stopOpacity={0.3}
									/>
									<stop
										offset="95%"
										stopColor={PHOENIX.ember}
										stopOpacity={0}
									/>
								</linearGradient>
							</defs>
							<XAxis
								dataKey="date"
								stroke={PHOENIX.ashGray}
								tickLine={false}
								axisLine={false}
								tick={{
									fontSize: 11,
									fontFamily: "Inter, sans-serif",
								}}
							/>
							<YAxis
								stroke={PHOENIX.ashGray}
								tickFormatter={(value) =>
									value >= 1000 ? `${value / 1000}k` : `${value}`
								}
								tickLine={false}
								axisLine={false}
								tick={{
									fontSize: 11,
									fontFamily: "Inter, sans-serif",
								}}
							/>
							<Tooltip content={<RechartsTooltip />} />
							<Area
								type="monotone"
								dataKey="volume"
								stroke={PHOENIX.ember}
								strokeWidth={2}
								fill="url(#mobileTrendGradient)"
								animationDuration={800}
								animationEasing="ease-out"
							/>
						</AreaChart>
					</ResponsiveContainer>
				) : (
					<div className="text-center py-12 text-muted-foreground">
						<TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
						<p className="font-medium mb-1">Track your training trends</p>
						<p className="text-xs">
							Complete a few workouts to see your volume and strength trends
							here
						</p>
					</div>
				)}
			</MobileChartCard>

			{/* PR counter */}
			{prCount > 0 && (
				<MobileChartCard title="PERSONAL RECORDS">
					<div className="flex items-center gap-4">
						<div className="flex flex-col items-center justify-center rounded-lg bg-primary/10 px-4 py-3">
							<span className="text-2xl font-bold text-primary">{prCount}</span>
							<span className="text-[10px] text-muted-foreground">
								total PRs
							</span>
						</div>
						{daysSinceLastPR != null && (
							<div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 px-4 py-3">
								<span className="text-2xl font-bold text-white">
									{daysSinceLastPR}
								</span>
								<span className="text-[10px] text-muted-foreground">
									days since last PR
								</span>
							</div>
						)}
					</div>
				</MobileChartCard>
			)}
		</>
	);
}
