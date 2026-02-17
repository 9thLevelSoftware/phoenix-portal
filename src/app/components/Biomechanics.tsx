import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertCircle,
	Gauge,
	RefreshCw,
	Ruler,
	Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { ConsistencyCalendar } from "@/app/components/ConsistencyCalendar";
import { AsymmetryGauge } from "@/app/components/charts/AsymmetryGauge";
import { ForceCurve } from "@/app/components/charts/ForceCurve";
import { PowerOutput } from "@/app/components/charts/PowerOutput";
import { RomTrend } from "@/app/components/charts/RomTrend";
import { VelocityProfile } from "@/app/components/charts/VelocityProfile";
import { ExerciseProgress } from "@/app/components/ExerciseProgress";
import { MuscleHeatmap } from "@/app/components/MuscleHeatmap";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import { SummaryReport } from "@/app/components/SummaryReport";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Label } from "@/app/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select";
import { Skeleton } from "@/app/components/ui/skeleton";
import { Switch } from "@/app/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";

import { useAuth } from "@/app/hooks/useAuth";
import { PHOENIX } from "@/lib/colors";
import { repSummariesOptions, repTelemetryOptions } from "@/queries/telemetry";
import { sessionDetailOptions, workoutListOptions } from "@/queries/workouts";

// -- Section wrapper --
function Section({
	title,
	icon: Icon,
	children,
	className = "",
}: {
	title: string;
	icon: React.ComponentType<{ className?: string }>;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 16 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.3 }}
			className={className}
		>
			<Card className="p-5 bg-surface-2 border-secondary">
				<h3 className="flex items-center gap-2 text-lg font-medium text-white mb-4">
					<Icon className="w-5 h-5 text-primary" />
					{title}
				</h3>
				{children}
			</Card>
		</motion.div>
	);
}

function ErrorCard({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<Card className="p-6 bg-surface-2 border-secondary flex flex-col items-center gap-3">
			<AlertCircle className="w-8 h-8 text-chart-2" />
			<p className="text-sm text-muted-foreground">{message}</p>
			{onRetry && (
				<Button
					variant="outline"
					size="sm"
					onClick={onRetry}
					className="border-secondary"
				>
					<RefreshCw className="w-4 h-4 mr-1" />
					Retry
				</Button>
			)}
		</Card>
	);
}

function SectionSkeleton() {
	return (
		<Card className="p-5 bg-surface-2 border-secondary">
			<Skeleton className="h-6 w-40 mb-4" />
			<Skeleton className="h-[250px] w-full" />
		</Card>
	);
}

// -- Main page content --
function BiomechanicsContent() {
	const { user } = useAuth();
	const userId = user?.id ?? "";

	// ---- Session/exercise selectors ----
	const [selectedSessionId, setSelectedSessionId] = useState<string>("");
	const [selectedExerciseId, setSelectedExerciseId] = useState<string>("");
	const [selectedSetId, setSelectedSetId] = useState<string>("");

	// Force curve options
	const [normalized, setNormalized] = useState(false);
	const [overlayAll, setOverlayAll] = useState(true);

	// Fetch workout list
	const {
		data: workouts,
		isPending: workoutsLoading,
		error: workoutsError,
		refetch: refetchWorkouts,
	} = useQuery({ ...workoutListOptions(userId), enabled: !!userId });

	// Auto-select first session
	const effectiveSessionId = selectedSessionId || (workouts?.[0]?.id ?? "");
	if (
		effectiveSessionId &&
		!selectedSessionId &&
		workouts &&
		workouts.length > 0
	) {
		setSelectedSessionId(effectiveSessionId);
	}

	// Fetch session detail
	const {
		data: session,
		isPending: sessionLoading,
		error: sessionError,
	} = useQuery({
		...sessionDetailOptions(effectiveSessionId),
		enabled: !!effectiveSessionId,
	});

	// Auto-select first exercise
	const exercises = session?.exercises ?? [];
	const effectiveExerciseId = selectedExerciseId || (exercises[0]?.id ?? "");
	if (effectiveExerciseId && !selectedExerciseId && exercises.length > 0) {
		setSelectedExerciseId(effectiveExerciseId);
	}

	// Get sets for selected exercise
	const selectedExercise = exercises.find((e) => e.id === effectiveExerciseId);
	const sets = selectedExercise?.sets ?? [];

	// Auto-select first set
	const effectiveSetId = selectedSetId || (sets[0]?.id ?? "");
	if (effectiveSetId && !selectedSetId && sets.length > 0) {
		setSelectedSetId(effectiveSetId);
	}

	// ---- Telemetry queries (per selected set) ----
	const { data: telemetry, isPending: telemetryLoading } = useQuery({
		...repTelemetryOptions(effectiveSetId),
		enabled: !!effectiveSetId,
	});

	const { data: repSummaries, isPending: summariesLoading } = useQuery({
		...repSummariesOptions(effectiveSetId),
		enabled: !!effectiveSetId,
	});

	// ---- Derived data ----

	// Group telemetry by rep number for ForceCurve
	const repData = useMemo(() => {
		if (!telemetry || telemetry.length === 0) return [];

		// Group by creating synthetic rep boundaries from force pattern
		// Since telemetry doesn't have rep_number, we pass all as single rep
		// or if repSummaries exist, use rep count to split
		const repCount = repSummaries?.length ?? 1;
		if (repCount <= 1) {
			return [{ repNumber: 1, points: telemetry }];
		}

		// Approximate split: divide points evenly across reps
		const pointsPerRep = Math.ceil(telemetry.length / repCount);
		return Array.from({ length: repCount }, (_, i) => ({
			repNumber: i + 1,
			points: telemetry.slice(i * pointsPerRep, (i + 1) * pointsPerRep),
		}));
	}, [telemetry, repSummaries]);

	// Selected rep for ForceCurve
	const selectedRep = overlayAll ? null : 1;

	// Muscle volumes from session exercises
	const muscleVolumes = useMemo(() => {
		const volumes: Record<string, number> = {};
		for (const ex of exercises) {
			const group = (ex as { muscle_group?: string }).muscle_group ?? "Other";
			const totalVol = ex.sets.reduce(
				(sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0),
				0,
			);
			volumes[group] = (volumes[group] ?? 0) + totalVol;
		}
		return volumes;
	}, [exercises]);

	// Workout dates for consistency calendar
	const workoutDates = useMemo(
		() => (workouts ?? []).map((w) => new Date(w.started_at)),
		[workouts],
	);

	// Asymmetry session average
	const avgAsymmetry = useMemo(() => {
		if (!repSummaries || repSummaries.length === 0) return null;
		const total = repSummaries.reduce(
			(sum, r) => sum + Math.abs(r.asymmetry_pct),
			0,
		);
		return (total / repSummaries.length).toFixed(1);
	}, [repSummaries]);

	// ---- Error states ----
	if (workoutsError) {
		return (
			<ErrorCard
				message="Failed to load workouts"
				onRetry={() => refetchWorkouts()}
			/>
		);
	}

	// ---- Loading state ----
	if (workoutsLoading) {
		return (
			<div className="space-y-6">
				<Skeleton className="h-10 w-64" />
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<SectionSkeleton />
					<SectionSkeleton />
					<SectionSkeleton />
					<SectionSkeleton />
				</div>
			</div>
		);
	}

	if (!workouts || workouts.length === 0) {
		return (
			<div className="text-center py-16">
				<div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
					<Activity className="w-12 h-12 text-primary" />
				</div>
				<h3 className="text-2xl font-semibold text-white mb-2">
					No workout data yet
				</h3>
				<p className="text-muted-foreground max-w-md mx-auto">
					Complete workouts in the mobile app to see your biomechanics data
					here.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Selectors */}
			<div className="flex flex-col sm:flex-row gap-4 flex-wrap">
				{/* Session selector */}
				<Select
					value={selectedSessionId}
					onValueChange={(id) => {
						setSelectedSessionId(id);
						setSelectedExerciseId("");
						setSelectedSetId("");
					}}
				>
					<SelectTrigger className="w-64 bg-surface-2 border-secondary text-white">
						<SelectValue placeholder="Select session" />
					</SelectTrigger>
					<SelectContent>
						{workouts.map((w) => (
							<SelectItem key={w.id} value={w.id}>
								{new Date(w.started_at).toLocaleDateString("en-US", {
									month: "short",
									day: "numeric",
									year: "numeric",
								})}
								{w.name ? ` - ${w.name}` : ""}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{/* Exercise selector */}
				{exercises.length > 0 && (
					<Select
						value={selectedExerciseId}
						onValueChange={(id) => {
							setSelectedExerciseId(id);
							setSelectedSetId("");
						}}
					>
						<SelectTrigger className="w-64 bg-surface-2 border-secondary text-white">
							<SelectValue placeholder="Select exercise" />
						</SelectTrigger>
						<SelectContent>
							{exercises.map((ex) => (
								<SelectItem key={ex.id} value={ex.id}>
									{ex.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}

				{/* Set selector */}
				{sets.length > 0 && (
					<Tabs value={effectiveSetId} onValueChange={setSelectedSetId}>
						<TabsList className="bg-surface-2 border border-secondary">
							{sets.map((s, i) => (
								<TabsTrigger
									key={s.id}
									value={s.id}
									className="data-[state=active]:bg-primary data-[state=active]:text-white text-xs px-3"
								>
									Set {i + 1}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
				)}
			</div>

			{sessionLoading ? (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<SectionSkeleton />
					<SectionSkeleton />
				</div>
			) : sessionError ? (
				<ErrorCard message="Failed to load session details" />
			) : (
				<>
					{/* Section 1: Force Curves (full width) */}
					<Section
						title="Force Curves"
						icon={Activity}
						className="col-span-full"
					>
						<div className="flex items-center gap-6 mb-4 flex-wrap">
							<div className="flex items-center gap-2">
								<Switch
									id="overlay"
									checked={overlayAll}
									onCheckedChange={setOverlayAll}
								/>
								<Label
									htmlFor="overlay"
									className="text-sm text-muted-foreground"
								>
									Overlay All Reps
								</Label>
							</div>
							<div className="flex items-center gap-2">
								<Switch
									id="normalized"
									checked={normalized}
									onCheckedChange={setNormalized}
								/>
								<Label
									htmlFor="normalized"
									className="text-sm text-muted-foreground"
								>
									Normalized Time
								</Label>
							</div>
						</div>
						{telemetryLoading ? (
							<Skeleton className="h-[300px] w-full" />
						) : repData.length > 0 ? (
							<ForceCurve
								repData={repData}
								height={300}
								normalized={normalized}
								selectedRep={selectedRep}
							/>
						) : (
							<div className="text-center py-8 text-muted text-sm">
								No telemetry data for this set
							</div>
						)}
					</Section>

					{/* Section 2: Velocity & Power (2 col) */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<Section title="Velocity Profile" icon={Zap}>
							{summariesLoading ? (
								<Skeleton className="h-[280px] w-full" />
							) : (
								<VelocityProfile repSummaries={repSummaries ?? []} />
							)}
						</Section>

						<Section title="Power Output" icon={Gauge}>
							{summariesLoading ? (
								<Skeleton className="h-[250px] w-full" />
							) : (
								<PowerOutput repSummaries={repSummaries ?? []} />
							)}
						</Section>
					</div>

					{/* Section 3: Asymmetry (full width) */}
					<Section title="Left/Right Asymmetry" icon={Activity}>
						{summariesLoading ? (
							<Skeleton className="h-[300px] w-full" />
						) : (
							<>
								<AsymmetryGauge
									repSummaries={repSummaries ?? []}
									mode="per-rep"
								/>
								{avgAsymmetry !== null && (
									<div className="mt-4 flex justify-center">
										<span
											className="rounded-full px-4 py-1.5 text-sm font-medium"
											style={{
												backgroundColor:
													parseFloat(avgAsymmetry) <= 10
														? "#10B98120"
														: "#DC262620",
												color:
													parseFloat(avgAsymmetry) <= 10
														? PHOENIX.forgeGreen
														: PHOENIX.flameRed,
												border: `1px solid ${parseFloat(avgAsymmetry) <= 10 ? "#10B98140" : "#DC262640"}`,
											}}
										>
											Session Average: {avgAsymmetry}% asymmetry
										</span>
									</div>
								)}
							</>
						)}
					</Section>

					{/* Section 4 & 5: ROM + Muscle Heatmap (2 col) */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<Section title="Range of Motion" icon={Ruler}>
							{summariesLoading ? (
								<Skeleton className="h-[250px] w-full" />
							) : (
								<RomTrend repSummaries={repSummaries ?? []} />
							)}
						</Section>

						<Section title="Body Overview" icon={Activity}>
							<MuscleHeatmap muscleVolumes={muscleVolumes} />
						</Section>
					</div>

					{/* Section 6: Exercise Progress (full width) */}
					<Section
						title="Exercise Progress"
						icon={Activity}
						className="col-span-full"
					>
						<ExerciseProgress
							userId={userId}
							initialExercise={selectedExercise?.name}
						/>
					</Section>

					{/* Section 7: Summary Report (full width) */}
					<Section
						title="Summary Report"
						icon={Activity}
						className="col-span-full"
					>
						<SummaryReport userId={userId} />
					</Section>

					{/* Section 8: Consistency (full width) */}
					<Section
						title="Workout Consistency"
						icon={Activity}
						className="col-span-full"
					>
						<ConsistencyCalendar workoutDates={workoutDates} />
					</Section>
				</>
			)}
		</div>
	);
}

// -- Exported page component with subscription gate --
export function Biomechanics() {
	return (
		<div className="min-h-screen px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
			<div className="mb-8">
				<h1 className="text-3xl font-bold text-white">Biomechanics</h1>
				<p className="text-muted-foreground mt-1">
					Advanced training analytics
				</p>
			</div>

			<SubscriptionGate requiredTier="PHOENIX">
				<BiomechanicsContent />
			</SubscriptionGate>
		</div>
	);
}
