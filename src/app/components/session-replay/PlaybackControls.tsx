import { Pause, Play } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { useReplayStore } from "@/stores/useReplayStore";

interface PlaybackControlsProps {
	disabled?: boolean;
}

type Speed = 0.25 | 0.5 | 1 | 2 | 4;

const SPEED_OPTIONS: Speed[] = [0.25, 0.5, 1, 2, 4];

/**
 * Play/pause button and speed control for session replay.
 * Uses Zustand store for state management.
 */
export function PlaybackControls({ disabled = false }: PlaybackControlsProps) {
	const { isPlaying, speed, togglePlayPause, setSpeed } = useReplayStore();

	return (
		<div className="flex items-center gap-4">
			{/* Play/Pause button with large touch target */}
			<Button
				variant="default"
				size="icon"
				className="w-12 h-12 rounded-full bg-primary hover:bg-primary/90"
				onClick={togglePlayPause}
				disabled={disabled}
				aria-label={isPlaying ? "Pause" : "Play"}
			>
				{isPlaying ? (
					<Pause className="w-6 h-6" />
				) : (
					<Play className="w-6 h-6 ml-0.5" />
				)}
			</Button>

			{/* Speed control using Tabs for toggle group behavior */}
			<Tabs
				value={String(speed)}
				onValueChange={(v) => setSpeed(Number(v) as Speed)}
				className="flex-shrink-0"
			>
				<TabsList className="h-9">
					{SPEED_OPTIONS.map((s) => (
						<TabsTrigger
							key={s}
							value={String(s)}
							disabled={disabled}
							className="px-2 text-xs min-w-[40px]"
						>
							{s}x
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
		</div>
	);
}
