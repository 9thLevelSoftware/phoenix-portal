import { Info } from "lucide-react";
import { useCallback, useRef } from "react";
import { Slider } from "@/app/components/ui/slider";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip";
import type { FatigueAnalysis } from "@/lib/fatigue-detection";
import { useReplayStore } from "@/stores/useReplayStore";

interface TimelineBarProps {
	durationMs: number;
	repBoundaries: number[]; // Start timestamp for each rep
	fatigue: FatigueAnalysis;
	onScrubStart?: () => void;
	onScrubEnd?: () => void;
}

/**
 * Timeline scrubber with fatigue region highlighting.
 * Displays a slider for seeking with shaded fatigue regions and time labels.
 */
export function TimelineBar({
	durationMs,
	repBoundaries,
	fatigue,
	onScrubStart,
	onScrubEnd,
}: TimelineBarProps) {
	const { currentTimeMs, seek } = useReplayStore();
	const wasPlayingRef = useRef(false);
	const { isPlaying, pause, play } = useReplayStore();

	// Calculate fatigue region position. Require a positive duration and a valid
	// boundary index so zero-duration or mismatched data can't produce
	// Infinity/NaN percentages, then clamp to [0, 100].
	const fatigueBoundary =
		fatigue.isFatigued &&
		fatigue.fatigueStartRepIndex !== null &&
		durationMs > 0 &&
		fatigue.fatigueStartRepIndex >= 0 &&
		fatigue.fatigueStartRepIndex < repBoundaries.length
			? repBoundaries[fatigue.fatigueStartRepIndex]
			: null;
	const fatigueStartPercent =
		fatigueBoundary !== null && Number.isFinite(fatigueBoundary)
			? Math.max(0, Math.min(100, (fatigueBoundary / durationMs) * 100))
			: null;

	const handlePointerDown = useCallback(() => {
		wasPlayingRef.current = isPlaying;
		if (isPlaying) {
			pause();
		}
		onScrubStart?.();
	}, [isPlaying, pause, onScrubStart]);

	const handlePointerUp = useCallback(() => {
		if (wasPlayingRef.current) {
			play();
		}
		onScrubEnd?.();
	}, [play, onScrubEnd]);

	const handleValueChange = useCallback(
		(values: number[]) => {
			seek(values[0]);
		},
		[seek],
	);

	// If the component unmounts mid-scrub (e.g. navigating away during a drag),
	// resume playback that was paused on pointer down so the player isn't left
	// stuck in a paused state.
	useEffect(() => {
		return () => {
			if (wasPlayingRef.current) {
				play();
			}
		};
	}, [play]);

	return (
		<div className="w-full space-y-1">
			{/* Timeline container with fatigue overlay */}
			<div className="relative h-6">
				{/* Fatigue region overlay (behind slider) */}
				{fatigueStartPercent !== null && (
					<div
						className={`absolute top-1/2 -translate-y-1/2 h-4 rounded-r ${
							fatigue.severity === "high" ? "bg-red-500/20" : "bg-amber-500/20"
						}`}
						style={{
							left: `${fatigueStartPercent}%`,
							right: 0,
						}}
					/>
				)}

				{/* Slider on top */}
				<div
					className="relative z-10 h-full flex items-center"
					onPointerDown={handlePointerDown}
					onPointerUp={handlePointerUp}
					onPointerCancel={handlePointerUp}
					onLostPointerCapture={handlePointerUp}
				>
					<Slider
						value={[Math.min(currentTimeMs, Math.max(durationMs, 0))]}
						min={0}
						max={durationMs > 0 ? durationMs : 1}
						step={16} // ~60fps granularity
						onValueChange={handleValueChange}
						disabled={durationMs <= 0}
						className="w-full"
					/>
				</div>
			</div>

			{/* Time labels + estimated-boundary disclosure */}
			<div className="flex justify-between items-center text-xs text-muted-foreground px-1">
				<span>{formatTime(currentTimeMs)}</span>
				{repBoundaries.length > 0 && (
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="flex items-center gap-0.5 cursor-default select-none opacity-40 hover:opacity-70 transition-opacity">
								<Info className="w-3 h-3" />
								<span className="text-[10px]">est.</span>
							</span>
						</TooltipTrigger>
						<TooltipContent side="top">
							Rep boundaries are estimated from timing data, not exact telemetry
							measurements
						</TooltipContent>
					</Tooltip>
				)}
				<span>{formatTime(durationMs)}</span>
			</div>
		</div>
	);
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
