import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import { Button } from "@/app/components/ui/button";
import { Skeleton } from "@/app/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { useIsMobile } from "@/app/hooks/useIsMobile";
import { usePlayback } from "@/hooks/usePlayback";
import { detectFatigue } from "@/lib/fatigue-detection";
import { calculateRepQualityScore } from "@/lib/rep-quality";
import { replaySessionOptions, replayTelemetryOptions } from "@/queries/replay";
import type { RepSummary, TelemetryPointRow } from "@/schemas/telemetry";
import { useReplayStore } from "@/stores/useReplayStore";
import { FatigueSummary } from "./FatigueSummary";
import { PlaybackControls } from "./PlaybackControls";
import { QualityBadge } from "./QualityBadge";
import { ReplayCanvas } from "./ReplayCanvas";
import { SetNavigation } from "./SetNavigation";
import { TimelineBar } from "./TimelineBar";

/**
 * Session Replay page component.
 * Provides full playback visualization of a workout set with force/velocity charts,
 * rep quality badges, and fatigue detection.
 * Gated behind ELITE subscription tier.
 */
export function SessionReplay() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const navigate = useNavigate();
	const isMobile = useIsMobile();

	const {
		currentSetIndex,
		activeChart,
		setActiveChart,
		isPlaying,
		currentTimeMs,
		reset,
	} = useReplayStore();

	// Reset playback state on mount
	useEffect(() => {
		reset();
	}, [reset]);

	// Fetch session structure
	const sessionQuery = useQuery(replaySessionOptions(sessionId ?? ""));

	// Derive all sets from session exercises
	const allSets = useMemo(() => {
		if (!sessionQuery.data?.exercises) return [];
		return sessionQuery.data.exercises.flatMap((exercise) =>
			(exercise.sets ?? []).map((set) => ({
				setId: set.id,
				exerciseName: exercise.exercise_name,
				setNumber: set.set_number,
			})),
		);
	}, [sessionQuery.data]);

	// Get current set info
	const currentSet = allSets[currentSetIndex];

	// Fetch telemetry for current set
	const telemetryQuery = useQuery({
		...replayTelemetryOptions(currentSet?.setId ?? ""),
		enabled: !!currentSet?.setId,
	});

	// Process telemetry data
	const telemetryData = useMemo(() => {
		if (!telemetryQuery.data) return null;

		const telemetry = telemetryQuery.data.telemetry as TelemetryPointRow[];
		const repSummaries = telemetryQuery.data.repSummaries as RepSummary[];

		// Calculate duration from telemetry
		const durationMs =
			telemetry.length > 0
				? Math.max(...telemetry.map((t) => t.timestamp_ms))
				: 0;

		// Get rep boundaries (start timestamp of each rep)
		// For now, derive from rep summaries or estimate based on TUT
		const repBoundaries = deriveRepBoundaries(repSummaries, telemetry);

		// Detect fatigue
		const fatigue = detectFatigue(repSummaries);

		return {
			telemetry,
			repSummaries,
			durationMs,
			repBoundaries,
			fatigue,
		};
	}, [telemetryQuery.data]);

	// Calculate current rep index from playback time
	const currentRepIndex = useMemo(() => {
		if (!telemetryData?.repBoundaries.length) return 0;
		const boundaries = telemetryData.repBoundaries;
		for (let i = boundaries.length - 1; i >= 0; i--) {
			if (currentTimeMs >= boundaries[i]) return i;
		}
		return 0;
	}, [currentTimeMs, telemetryData?.repBoundaries]);

	// Get current rep quality
	const currentRepQuality = useMemo(() => {
		if (!telemetryData?.repSummaries[currentRepIndex]) return null;
		return calculateRepQualityScore(
			telemetryData.repSummaries[currentRepIndex],
		);
	}, [telemetryData?.repSummaries, currentRepIndex]);

	// Playback hook
	usePlayback(telemetryData?.durationMs ?? 0);

	// Canvas dimensions
	const canvasWidth = isMobile ? window.innerWidth - 32 : 600;
	const canvasHeight = isMobile ? 200 : 300;

	if (!sessionId) {
		return (
			<div className="p-4 text-center">
				<p className="text-muted-foreground">No session ID provided</p>
			</div>
		);
	}

	return (
		<SubscriptionGate requiredTier="ELITE">
			<div className="min-h-screen p-4 space-y-4">
				{/* Header */}
				<div className="flex items-center gap-3">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => navigate(-1)}
						aria-label="Go back"
					>
						<ArrowLeft className="w-5 h-5" />
					</Button>
					<div>
						<h1 className="text-lg font-semibold">Session Replay</h1>
						{currentSet && (
							<p className="text-sm text-muted-foreground">
								{currentSet.exerciseName} - Set {currentSet.setNumber}
							</p>
						)}
					</div>
				</div>

				{/* Loading state */}
				{(sessionQuery.isLoading || telemetryQuery.isLoading) && (
					<div className="space-y-4">
						<Skeleton className="w-full h-[200px] rounded-lg" />
						<Skeleton className="w-full h-6" />
						<Skeleton className="w-32 h-12" />
					</div>
				)}

				{/* Error state */}
				{(sessionQuery.error || telemetryQuery.error) && (
					<div className="p-4 bg-destructive/10 rounded-lg text-destructive">
						<p>Failed to load replay data. Please try again.</p>
					</div>
				)}

				{/* Main content */}
				{telemetryData && telemetryData.telemetry.length > 0 && (
					<>
						{/* Fatigue summary */}
						<FatigueSummary fatigue={telemetryData.fatigue} />

						{/* Chart type toggle */}
						<Tabs
							value={activeChart}
							onValueChange={(v) => setActiveChart(v as "force" | "velocity")}
						>
							<TabsList className="w-full">
								<TabsTrigger value="force" className="flex-1">
									Force
								</TabsTrigger>
								<TabsTrigger value="velocity" className="flex-1">
									Velocity
								</TabsTrigger>
							</TabsList>
						</Tabs>

						{/* Canvas container with quality badge */}
						<div className="relative">
							<ReplayCanvas
								data={telemetryData.telemetry}
								repBoundaries={telemetryData.repBoundaries}
								width={canvasWidth}
								height={canvasHeight}
							/>

							{/* Quality badge - positioned in top right corner */}
							{currentRepQuality && (
								<div className="absolute top-2 right-2">
									<QualityBadge
										qualityResult={currentRepQuality}
										repNumber={currentRepIndex + 1}
									/>
								</div>
							)}

							{/* Paused stats overlay */}
							{!isPlaying && telemetryData.repSummaries[currentRepIndex] && (
								<div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg pointer-events-none">
									<div className="bg-background/90 px-4 py-3 rounded-lg text-center">
										<p className="text-sm text-muted-foreground">
											Rep {currentRepIndex + 1}
										</p>
										<p className="text-lg font-semibold">
											{formatTime(currentTimeMs)}
										</p>
										{currentRepQuality && (
											<p
												className={`text-sm font-medium ${
													currentRepQuality.isLowQuality
														? "text-amber-500"
														: "text-primary"
												}`}
											>
												Quality: {currentRepQuality.score}
											</p>
										)}
									</div>
								</div>
							)}
						</div>

						{/* Timeline */}
						<TimelineBar
							durationMs={telemetryData.durationMs}
							repBoundaries={telemetryData.repBoundaries}
							fatigue={telemetryData.fatigue}
						/>

						{/* Playback controls */}
						<PlaybackControls />

						{/* Set navigation */}
						<SetNavigation
							currentSetIndex={currentSetIndex}
							totalSets={allSets.length}
						/>
					</>
				)}

				{/* Empty state */}
				{telemetryData && telemetryData.telemetry.length === 0 && (
					<div className="p-8 text-center">
						<p className="text-muted-foreground">
							No telemetry data available for this set
						</p>
					</div>
				)}
			</div>
		</SubscriptionGate>
	);
}

/**
 * Derive rep boundaries from rep summaries.
 * Uses cumulative TUT to estimate start times.
 */
function deriveRepBoundaries(
	repSummaries: RepSummary[],
	_telemetry: TelemetryPointRow[],
): number[] {
	if (repSummaries.length === 0) return [];

	// Simple approach: estimate boundaries from cumulative TUT
	// First rep starts at 0
	const boundaries: number[] = [0];
	let cumulativeTime = 0;

	for (let i = 0; i < repSummaries.length - 1; i++) {
		// Add TUT of current rep plus a small gap (500ms rest between reps)
		cumulativeTime += repSummaries[i].tut_ms + 500;
		boundaries.push(cumulativeTime);
	}

	return boundaries;
}

/**
 * Format milliseconds to mm:ss display
 */
function formatTime(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
