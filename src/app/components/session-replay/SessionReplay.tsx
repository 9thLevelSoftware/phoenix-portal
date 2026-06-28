import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { DataFreshnessStrip } from "@/app/components/analytics/DataFreshnessStrip";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import { Button } from "@/app/components/ui/button";
import { Skeleton } from "@/app/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { useIsMobile } from "@/app/hooks/useIsMobile";
import { usePlayback } from "@/hooks/usePlayback";
import { useSubscription } from "@/hooks/useSubscription";
import { displayExerciseName } from "@/lib/exercise-display";
import { detectFatigue } from "@/lib/fatigue-detection";
import { buildFreshnessState } from "@/lib/freshness";
import { calculateRepQualityScore } from "@/lib/rep-quality";
import { buildReplayIntelligence } from "@/lib/replay-intelligence";
import { buildReplayPhaseAnalytics } from "@/lib/replay-phase-analytics";
import { replaySessionOptions, replayTelemetryOptions } from "@/queries/replay";
import type { RepSummary, TelemetryPointRow } from "@/schemas/telemetry";
import { useReplayStore } from "@/stores/useReplayStore";
import { FatigueSummary } from "./FatigueSummary";
import { PlaybackControls } from "./PlaybackControls";
import { QualityBadge } from "./QualityBadge";
import { ReplayAnnotationOverlay } from "./ReplayAnnotationOverlay";
import { ReplayCanvas } from "./ReplayCanvas";
import { ReplayIntelligencePanel } from "./ReplayIntelligencePanel";
import { ReplayPhaseAnalyticsPanel } from "./ReplayPhaseAnalyticsPanel";
import { SetNavigation } from "./SetNavigation";
import { TimelineBar } from "./TimelineBar";

/**
 * Session Replay page component.
 * Provides full playback visualization of a workout set with force/velocity charts,
 * rep quality badges, and fatigue detection.
 * Gated behind FLAME+ subscription tier.
 */
export function SessionReplay() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const { isFlame } = useSubscription();

	const {
		currentSetIndex,
		activeChart,
		setActiveChart,
		isPlaying,
		currentTimeMs,
		reset,
	} = useReplayStore();

	// Reset playback state on mount and whenever the session changes, so a set
	// index retained from a previous (longer) session can't index past the
	// current session's sets.
	useEffect(() => {
		reset();
	}, [reset, sessionId]);

	// Fetch session structure
	const sessionQuery = useQuery({
		...replaySessionOptions(sessionId ?? ""),
		enabled: isFlame && !!sessionId,
	});

	// Derive all sets from session exercises
	const allSets = useMemo(() => {
		if (!sessionQuery.data?.exercises) return [];
		return sessionQuery.data.exercises.flatMap((exercise) =>
			(exercise.sets ?? []).map((set) => ({
				setId: set.id,
				exerciseName: displayExerciseName(exercise.exercise_name),
				setNumber: set.set_number,
			})),
		);
	}, [sessionQuery.data]);

	// Get current set info
	const currentSet = allSets[currentSetIndex];

	// Fetch telemetry for current set
	const telemetryQuery = useQuery({
		...replayTelemetryOptions(currentSet?.setId ?? ""),
		enabled: isFlame && !!currentSet?.setId,
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
		const intelligence = buildReplayIntelligence({
			telemetry,
			repSummaries,
			repBoundaries,
		});
		const phaseAnalytics = buildReplayPhaseAnalytics({
			telemetry,
			repSummaries,
			repBoundaries,
		});

		return {
			telemetry,
			repSummaries,
			durationMs,
			repBoundaries,
			fatigue,
			intelligence,
			phaseAnalytics,
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

	const replayFreshness = useMemo(
		() =>
			buildFreshnessState({
				dataUpdatedAt:
					Math.max(sessionQuery.dataUpdatedAt, telemetryQuery.dataUpdatedAt) ||
					null,
				staleAfterMs: 15 * 60 * 1000,
				isFetching: sessionQuery.isFetching || telemetryQuery.isFetching,
				hasError: sessionQuery.error != null || telemetryQuery.error != null,
				partialTelemetry: telemetryData?.intelligence.status === "partial",
			}),
		[
			sessionQuery.dataUpdatedAt,
			sessionQuery.error,
			sessionQuery.isFetching,
			telemetryData?.intelligence.status,
			telemetryQuery.dataUpdatedAt,
			telemetryQuery.error,
			telemetryQuery.isFetching,
		],
	);

	// Responsive canvas dimensions via resize observer
	const canvasContainerRef = useRef<HTMLDivElement>(null);
	const [canvasWidth, setCanvasWidth] = useState(
		isMobile ? window.innerWidth - 32 : 600,
	);
	const canvasHeight = isMobile ? 200 : 300;

	const handleResize = useCallback((entries: ResizeObserverEntry[]) => {
		for (const entry of entries) {
			const w = entry.contentRect.width;
			if (w > 0) setCanvasWidth(w);
		}
	}, []);

	useEffect(() => {
		const el = canvasContainerRef.current;
		if (!el) return;
		// Initialize with actual width
		if (el.clientWidth > 0) setCanvasWidth(el.clientWidth);
		// ResizeObserver may be unavailable in some environments; fall back to
		// window resize so the page doesn't throw on render.
		if (typeof ResizeObserver === "undefined") {
			const onResize = () => {
				if (el.clientWidth > 0) setCanvasWidth(el.clientWidth);
			};
			window.addEventListener("resize", onResize);
			return () => window.removeEventListener("resize", onResize);
		}
		const observer = new ResizeObserver(handleResize);
		observer.observe(el);
		return () => observer.disconnect();
	}, [handleResize]);

	if (!sessionId) {
		return (
			<div className="p-4 text-center">
				<p className="text-muted-foreground">No session ID provided</p>
			</div>
		);
	}

	return (
		<SubscriptionGate requiredTier="FLAME">
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

				<DataFreshnessStrip state={replayFreshness} />

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

						<ReplayIntelligencePanel
							intelligence={telemetryData.intelligence}
							currentRepIndex={currentRepIndex}
						/>

						{/* Chart type toggle */}
						<Tabs
							value={activeChart}
							onValueChange={(v) => setActiveChart(v as "force" | "velocity")}
						>
							<TabsList className="w-full">
								<TabsTrigger value="force">Force</TabsTrigger>
								<TabsTrigger value="velocity">Velocity</TabsTrigger>
							</TabsList>
						</Tabs>

						{/* Canvas container with quality badge */}
						<div className="relative" ref={canvasContainerRef}>
							<ReplayCanvas
								data={telemetryData.telemetry}
								repBoundaries={telemetryData.repBoundaries}
								width={canvasWidth}
								height={canvasHeight}
								intelligence={telemetryData.intelligence}
							/>
							<ReplayAnnotationOverlay
								intelligence={telemetryData.intelligence}
								currentRepIndex={currentRepIndex}
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

						<ReplayPhaseAnalyticsPanel
							analytics={telemetryData.phaseAnalytics}
						/>

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

				{/* Rep-summary fallback for sets that synced summaries before dense telemetry */}
				{telemetryData &&
					telemetryData.telemetry.length === 0 &&
					telemetryData.repSummaries.length > 0 && (
						<div className="space-y-4">
							<FatigueSummary fatigue={telemetryData.fatigue} />
							<ReplayIntelligencePanel
								intelligence={telemetryData.intelligence}
								currentRepIndex={currentRepIndex}
							/>
							<ReplayPhaseAnalyticsPanel
								analytics={telemetryData.phaseAnalytics}
							/>
							<div className="rounded-lg border border-secondary bg-surface-2 p-4 text-sm text-muted-foreground">
								Dense telemetry is not available for this set yet. Showing
								rep-summary intelligence until the next sync completes.
							</div>
							<SetNavigation
								currentSetIndex={currentSetIndex}
								totalSets={allSets.length}
							/>
						</div>
					)}

				{/* Empty state */}
				{telemetryData &&
					telemetryData.telemetry.length === 0 &&
					telemetryData.repSummaries.length === 0 && (
						<div className="p-8 text-center">
							<p className="text-muted-foreground">
								No telemetry data available for this set
							</p>
						</div>
					)}

				{/* Out-of-range state: sets loaded but the selected index is invalid */}
				{!sessionQuery.isLoading &&
					!sessionQuery.error &&
					allSets.length > 0 &&
					!currentSet && (
						<div className="p-8 text-center space-y-3">
							<p className="text-muted-foreground">
								That set is no longer available. Return to the first set to
								continue.
							</p>
							<Button variant="secondary" onClick={() => reset()}>
								Go to first set
							</Button>
						</div>
					)}
			</div>
		</SubscriptionGate>
	);
}

/**
 * Derive approximate rep boundary timestamps from rep summaries.
 *
 * LIMITATION: This is a rough estimation, NOT actual recorded data.
 *
 * The current approach uses cumulative Time Under Tension (TUT) plus a fixed
 * 500 ms inter-rep gap to estimate where each rep starts in the telemetry
 * timeline. This produces inaccurate boundaries because:
 *   1. Real rest periods between reps vary significantly and are not 500 ms.
 *   2. TUT only measures the eccentric+concentric portion -- it excludes
 *      lockout pauses, rack adjustments, and re-gripping time.
 *   3. The telemetry stream may include setup/unrack time before rep 1.
 *
 * A more accurate implementation would detect rep boundaries directly from
 * the raw telemetry data by finding force or velocity zero-crossings, or by
 * consuming explicit rep start/end timestamps if the firmware provides them.
 *
 * The `_telemetry` parameter is accepted but unused; it is kept in the
 * signature so a future implementation can use the raw data without changing
 * the call site.
 */
function deriveRepBoundaries(
	repSummaries: RepSummary[],
	_telemetry: TelemetryPointRow[],
): number[] {
	if (repSummaries.length === 0) return [];

	// Rough estimation: cumulative TUT + fixed 500 ms inter-rep gap
	const boundaries: number[] = [0];
	let cumulativeTime = 0;

	for (let i = 0; i < repSummaries.length - 1; i++) {
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
