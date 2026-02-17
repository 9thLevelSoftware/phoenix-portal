import {
	Activity,
	ArrowLeft,
	Clock,
	Download,
	Dumbbell,
	Share2,
	Target,
	TrendingUp,
	Trophy,
	Zap,
} from "lucide-react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";

interface WorkoutDetailProps {
	onClose: () => void;
}

export function WorkoutDetail({ onClose }: WorkoutDetailProps) {
	// Mock force curve data from Vitruvian
	const forceCurveData = [
		{ time: 0, concentric: 0, eccentric: 0 },
		{ time: 0.5, concentric: 45, eccentric: 0 },
		{ time: 1, concentric: 120, eccentric: 0 },
		{ time: 1.5, concentric: 150, eccentric: 0 },
		{ time: 2, concentric: 140, eccentric: 0 },
		{ time: 2.5, concentric: 100, eccentric: 0 },
		{ time: 3, concentric: 0, eccentric: 80 },
		{ time: 3.5, concentric: 0, eccentric: 110 },
		{ time: 4, concentric: 0, eccentric: 130 },
		{ time: 4.5, concentric: 0, eccentric: 120 },
		{ time: 5, concentric: 0, eccentric: 0 },
	];

	const powerOutputData = [
		{ set: 1, peak: 580, avg: 420 },
		{ set: 2, peak: 570, avg: 410 },
		{ set: 3, peak: 560, avg: 400 },
		{ set: 4, peak: 540, avg: 380 },
		{ set: 5, peak: 520, avg: 360 },
	];

	const exerciseData = [
		{
			name: "Bench Press",
			mode: "Old School",
			sets: [
				{
					set: 1,
					weight: 100,
					reps: 10,
					peakPower: 580,
					avgPower: 420,
					tut: 42,
					quality: 94,
				},
				{
					set: 2,
					weight: 105,
					reps: 8,
					peakPower: 570,
					avgPower: 410,
					tut: 38,
					quality: 92,
				},
				{
					set: 3,
					weight: 110,
					reps: 6,
					peakPower: 560,
					avgPower: 400,
					tut: 34,
					quality: 90,
				},
				{
					set: 4,
					weight: 110,
					reps: 6,
					peakPower: 540,
					avgPower: 380,
					tut: 35,
					quality: 88,
				},
				{
					set: 5,
					weight: 100,
					reps: 8,
					peakPower: 520,
					avgPower: 360,
					tut: 40,
					quality: 86,
				},
			],
			notes: "PR on set 3! Felt strong today.",
			prAchieved: true,
		},
		{
			name: "Incline Bench Press",
			mode: "Pump",
			sets: [
				{
					set: 1,
					weight: 80,
					reps: 12,
					peakPower: 450,
					avgPower: 320,
					tut: 50,
					quality: 91,
				},
				{
					set: 2,
					weight: 80,
					reps: 12,
					peakPower: 440,
					avgPower: 310,
					tut: 51,
					quality: 89,
				},
				{
					set: 3,
					weight: 80,
					reps: 10,
					peakPower: 430,
					avgPower: 300,
					tut: 48,
					quality: 87,
				},
			],
			notes: "Good pump, maintained tension well.",
			prAchieved: false,
		},
	];

	const vitruvianModes = {
		"Old School": "Standard resistance with consistent weight",
		Pump: "Optimized for hypertrophy with constant tension",
		TUT: "Extended time under tension for muscle growth",
		Echo: "Variable resistance that mirrors your force",
		Power: "Maximum power output focus",
	};

	return (
		<div className="min-h-screen bg-background pb-20 md:pb-8">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Header */}
				<div className="mb-8">
					<Button
						variant="ghost"
						onClick={onClose}
						className="text-muted-foreground hover:text-white mb-4"
					>
						<ArrowLeft className="w-4 h-4 mr-2" />
						Back to Workouts
					</Button>

					<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
						<div>
							<h1 className="text-3xl sm:text-4xl mb-2">
								<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
									Push Day A
								</span>
							</h1>
							<p className="text-muted-foreground">January 18, 2026 • 2:34 PM</p>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								className="border-secondary text-white hover:bg-secondary/50"
							>
								<Share2 className="w-4 h-4 mr-2" />
								Share
							</Button>
							<Button
								variant="outline"
								className="border-primary text-primary hover:bg-primary/10"
							>
								<Download className="w-4 h-4 mr-2" />
								Export
							</Button>
						</div>
					</div>
				</div>

				{/* Summary Cards */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
					<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-center gap-2 text-muted-foreground mb-2">
							<Clock className="w-4 h-4" />
							<span className="text-sm">Duration</span>
						</div>
						<div className="text-2xl text-white">58 min</div>
					</Card>
					<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-center gap-2 text-muted-foreground mb-2">
							<Dumbbell className="w-4 h-4" />
							<span className="text-sm">Total Volume</span>
						</div>
						<div className="text-2xl text-primary">5,200 kg</div>
					</Card>
					<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-center gap-2 text-muted-foreground mb-2">
							<Zap className="w-4 h-4" />
							<span className="text-sm">Avg Power</span>
						</div>
						<div className="text-2xl text-white">392 W</div>
					</Card>
					<Card className="p-4 bg-gradient-to-br from-primary/20 to-chart-2/20 border-primary border-2">
						<div className="flex items-center gap-2 text-secondary-foreground mb-2">
							<Trophy className="w-4 h-4" />
							<span className="text-sm">PRs</span>
						</div>
						<div className="text-2xl text-white">2</div>
					</Card>
				</div>

				{/* Vitruvian Sync Info */}
				<Card className="p-4 bg-gradient-to-br from-success/10 to-[#059669]/10 border-success/30 mb-8">
					<div className="flex items-start gap-3">
						<div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center flex-shrink-0">
							<Activity className="w-5 h-5 text-success" />
						</div>
						<div className="flex-1">
							<h3 className="text-white mb-1">
								Synced from Smart Cable Machine
							</h3>
							<p className="text-sm text-secondary-foreground mb-2">
								Workout data automatically synced from your training session via
								Project Phoenix mobile app
							</p>
							<div className="flex items-center gap-4 text-xs text-muted-foreground">
								<span>Device: V-Form Trainer</span>
								<span>•</span>
								<span>Synced: 2 hours ago</span>
								<span>•</span>
								<span>Session ID: PP-2026-0118-001</span>
							</div>
						</div>
					</div>
				</Card>

				{/* Main Content */}
				<Tabs defaultValue="exercises" className="space-y-6">
					<TabsList className="bg-surface-2 border border-secondary p-1">
						<TabsTrigger
							value="exercises"
							className="data-[state=active]:bg-primary"
						>
							Exercises
						</TabsTrigger>
						<TabsTrigger
							value="performance"
							className="data-[state=active]:bg-primary"
						>
							Performance Metrics
						</TabsTrigger>
						<TabsTrigger
							value="analysis"
							className="data-[state=active]:bg-primary"
						>
							Force Analysis
						</TabsTrigger>
					</TabsList>

					{/* Exercises Tab */}
					<TabsContent value="exercises" className="space-y-6">
						{exerciseData.map((exercise, index) => (
							<Card
								key={index}
								className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary"
							>
								<div className="flex items-start justify-between mb-6">
									<div>
										<div className="flex items-center gap-3 mb-2">
											<h3 className="text-2xl text-white">{exercise.name}</h3>
											{exercise.prAchieved && (
												<Badge className="bg-gradient-to-r from-accent to-warning text-background border-0">
													<Trophy className="w-3 h-3 mr-1" />
													NEW PR
												</Badge>
											)}
										</div>
										<div className="flex items-center gap-2">
											<Badge className="bg-gradient-to-r from-primary to-chart-2 text-white border-0">
												{exercise.mode}
											</Badge>
											<span className="text-sm text-muted-foreground">
												{
													vitruvianModes[
														exercise.mode as keyof typeof vitruvianModes
													]
												}
											</span>
										</div>
									</div>
								</div>

								{/* Sets Table */}
								<div className="overflow-x-auto">
									<table className="w-full">
										<thead>
											<tr className="border-b border-secondary">
												<th className="text-left py-3 px-4 text-sm text-muted-foreground">
													Set
												</th>
												<th className="text-left py-3 px-4 text-sm text-muted-foreground">
													Weight
												</th>
												<th className="text-left py-3 px-4 text-sm text-muted-foreground">
													Reps
												</th>
												<th className="text-left py-3 px-4 text-sm text-muted-foreground">
													Peak Power
												</th>
												<th className="text-left py-3 px-4 text-sm text-muted-foreground">
													Avg Power
												</th>
												<th className="text-left py-3 px-4 text-sm text-muted-foreground">
													TUT
												</th>
												<th className="text-left py-3 px-4 text-sm text-muted-foreground">
													Quality
												</th>
											</tr>
										</thead>
										<tbody>
											{exercise.sets.map((set) => (
												<tr
													key={set.set}
													className="border-b border-secondary hover:bg-surface-2 transition-colors"
												>
													<td className="py-3 px-4 text-white">{set.set}</td>
													<td className="py-3 px-4 text-primary font-semibold">
														{set.weight} kg
													</td>
													<td className="py-3 px-4 text-white">{set.reps}</td>
													<td className="py-3 px-4 text-white">
														{set.peakPower} W
													</td>
													<td className="py-3 px-4 text-white">
														{set.avgPower} W
													</td>
													<td className="py-3 px-4 text-white">{set.tut}s</td>
													<td className="py-3 px-4">
														<div className="flex items-center gap-2">
															<div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
																<div
																	className="h-full bg-gradient-to-r from-success to-[#059669]"
																	style={{ width: `${set.quality}%` }}
																/>
															</div>
															<span className="text-sm text-success">
																{set.quality}%
															</span>
														</div>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>

								{/* Notes */}
								{exercise.notes && (
									<div className="mt-4 p-4 bg-background rounded-lg border border-secondary">
										<div className="text-sm text-muted-foreground mb-1">Notes</div>
										<div className="text-white">{exercise.notes}</div>
									</div>
								)}
							</Card>
						))}
					</TabsContent>

					{/* Performance Metrics Tab */}
					<TabsContent value="performance" className="space-y-6">
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<h3 className="text-xl text-white mb-6">Power Output by Set</h3>
							<ResponsiveContainer width="100%" height={300}>
								<LineChart data={powerOutputData}>
									<CartesianGrid strokeDasharray="3 3" stroke="#374151" />
									<XAxis
										dataKey="set"
										stroke="#9CA3AF"
										label={{
											value: "Set",
											position: "insideBottom",
											offset: -5,
										}}
									/>
									<YAxis
										stroke="#9CA3AF"
										label={{
											value: "Power (W)",
											angle: -90,
											position: "insideLeft",
										}}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor: "#1a1a1a",
											border: "1px solid #374151",
											borderRadius: "8px",
											color: "#E5E7EB",
										}}
									/>
									<Legend />
									<Line
										type="monotone"
										dataKey="peak"
										name="Peak Power"
										stroke="#FF6B35"
										strokeWidth={2}
										dot={{ fill: "#FF6B35", r: 5 }}
									/>
									<Line
										type="monotone"
										dataKey="avg"
										name="Average Power"
										stroke="#F59E0B"
										strokeWidth={2}
										dot={{ fill: "#F59E0B", r: 5 }}
									/>
								</LineChart>
							</ResponsiveContainer>
						</Card>

						<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
								<div className="flex items-center gap-2 text-muted-foreground mb-3">
									<Target className="w-5 h-5" />
									<span className="text-sm">Rep Quality Score</span>
								</div>
								<div className="text-3xl text-white mb-2">91%</div>
								<p className="text-sm text-success">
									Excellent form throughout
								</p>
							</Card>
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
								<div className="flex items-center gap-2 text-muted-foreground mb-3">
									<Activity className="w-5 h-5" />
									<span className="text-sm">Total Time Under Tension</span>
								</div>
								<div className="text-3xl text-white mb-2">287s</div>
								<p className="text-sm text-muted-foreground">~4:47 total TUT</p>
							</Card>
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
								<div className="flex items-center gap-2 text-muted-foreground mb-3">
									<TrendingUp className="w-5 h-5" />
									<span className="text-sm">Consistency Rating</span>
								</div>
								<div className="text-3xl text-white mb-2">89%</div>
								<p className="text-sm text-success">
									Maintained good consistency
								</p>
							</Card>
						</div>
					</TabsContent>

					{/* Force Analysis Tab */}
					<TabsContent value="analysis" className="space-y-6">
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<h3 className="text-xl text-white mb-6">
								Force Curve - Sample Rep
							</h3>
							<ResponsiveContainer width="100%" height={400}>
								<AreaChart data={forceCurveData}>
									<defs>
										<linearGradient
											id="concentricGradient"
											x1="0"
											y1="0"
											x2="0"
											y2="1"
										>
											<stop offset="5%" stopColor="#FF6B35" stopOpacity={0.8} />
											<stop
												offset="95%"
												stopColor="#DC2626"
												stopOpacity={0.1}
											/>
										</linearGradient>
										<linearGradient
											id="eccentricGradient"
											x1="0"
											y1="0"
											x2="0"
											y2="1"
										>
											<stop offset="5%" stopColor="#10B981" stopOpacity={0.8} />
											<stop
												offset="95%"
												stopColor="#059669"
												stopOpacity={0.1}
											/>
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke="#374151" />
									<XAxis
										dataKey="time"
										stroke="#9CA3AF"
										label={{
											value: "Time (seconds)",
											position: "insideBottom",
											offset: -5,
										}}
									/>
									<YAxis
										stroke="#9CA3AF"
										label={{
											value: "Force (N)",
											angle: -90,
											position: "insideLeft",
										}}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor: "#1a1a1a",
											border: "1px solid #374151",
											borderRadius: "8px",
											color: "#E5E7EB",
										}}
									/>
									<Legend />
									<Area
										type="monotone"
										dataKey="concentric"
										name="Concentric Phase"
										stroke="#FF6B35"
										strokeWidth={2}
										fill="url(#concentricGradient)"
									/>
									<Area
										type="monotone"
										dataKey="eccentric"
										name="Eccentric Phase"
										stroke="#10B981"
										strokeWidth={2}
										fill="url(#eccentricGradient)"
									/>
								</AreaChart>
							</ResponsiveContainer>
							<div className="mt-4 p-4 bg-background rounded-lg border border-secondary">
								<p className="text-sm text-muted-foreground mb-2">Analysis:</p>
								<ul className="space-y-1 text-sm text-secondary-foreground">
									<li>• Concentric phase: 2.5s with peak force of 150N</li>
									<li>• Eccentric phase: 2.0s with controlled descent</li>
									<li>• Eccentric/Concentric ratio: 0.87 (good control)</li>
								</ul>
							</div>
						</Card>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
