import {
	Area,
	AreaChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { MobileChartCard } from "@/app/components/analytics/MobileChartCard";
import { ConsistencyWidget } from "@/app/components/charts/ConsistencyWidget";
import { RechartsTooltip } from "@/app/components/charts/shared/RechartsTooltip";
import { TrainingLoadGauge } from "@/app/components/charts/TrainingLoadGauge";
import { type InsightItem, InsightsFeed } from "@/app/components/InsightsFeed";
import { PHOENIX } from "@/lib/colors";

interface ConsistencyData {
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

export interface MobileOverviewTabProps {
	mobileVolumeData: Array<{ date: string; volume: number }>;
	trainingLoad: { rtl: number; zone: string };
	consistencyData: ConsistencyData;
	insightsFeedItems: InsightItem[];
	insightsPending: boolean;
	insightsError?: boolean;
}

export default function MobileOverviewTab({
	mobileVolumeData,
	trainingLoad,
	consistencyData,
	insightsFeedItems,
	insightsPending,
	insightsError = false,
}: MobileOverviewTabProps) {
	return (
		<>
			<MobileChartCard title="VOLUME OVER TIME">
				{mobileVolumeData.length > 0 ? (
					<ResponsiveContainer width="100%" height={200}>
						<AreaChart data={mobileVolumeData}>
							<defs>
								<linearGradient
									id="mobileVolumeGradient"
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
								tickFormatter={(value) => `${value / 1000}k`}
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
								fill="url(#mobileVolumeGradient)"
								animationDuration={800}
								animationEasing="ease-out"
							/>
						</AreaChart>
					</ResponsiveContainer>
				) : (
					<div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
						No volume data for this period
					</div>
				)}
			</MobileChartCard>

			<MobileChartCard title="TRAINING LOAD">
				<TrainingLoadGauge score={trainingLoad.rtl} zone={trainingLoad.zone} />
			</MobileChartCard>

			<MobileChartCard title="CONSISTENCY">
				<ConsistencyWidget {...consistencyData} />
			</MobileChartCard>

			<MobileChartCard title="INSIGHTS">
				<InsightsFeed
					insights={insightsFeedItems}
					loading={insightsPending}
					isError={insightsError}
				/>
			</MobileChartCard>
		</>
	);
}
