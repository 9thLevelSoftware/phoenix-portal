import { useCallback, useRef } from "react";
import { Slider } from "@/app/components/ui/slider";
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

	// Calculate fatigue region position
	const fatigueStartPercent =
		fatigue.isFatigued &&
		fatigue.fatigueStartRepIndex !== null &&
		repBoundaries.length > 0
			? (repBoundaries[fatigue.fatigueStartRepIndex] / durationMs) * 100
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
				>
					<Slider
						value={[currentTimeMs]}
						min={0}
						max={durationMs}
						step={16} // ~60fps granularity
						onValueChange={handleValueChange}
						className="w-full"
					/>
				</div>
			</div>

			{/* Time labels */}
			<div className="flex justify-between text-xs text-muted-foreground px-1">
				<span>{formatTime(currentTimeMs)}</span>
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
