import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { useReplayStore } from "@/stores/useReplayStore";

interface SetNavigationProps {
	currentSetIndex: number;
	totalSets: number;
}

/**
 * Prev/next set buttons and view mode toggle for session replay.
 * Uses Zustand store for navigation actions.
 */
export function SetNavigation({
	currentSetIndex,
	totalSets,
}: SetNavigationProps) {
	const { viewMode, setViewMode, nextSet, prevSet, pause, seek } =
		useReplayStore();

	const isFirstSet = currentSetIndex === 0;
	const isLastSet = currentSetIndex >= totalSets - 1;

	// Changing sets pauses playback and resets the playhead, so the new set's
	// timeline/chart don't open at a stale (possibly out-of-range) position.
	const goToPrevSet = () => {
		pause();
		seek(0);
		prevSet();
	};
	const goToNextSet = () => {
		pause();
		seek(0);
		nextSet();
	};

	return (
		<div className="flex items-center justify-between gap-4">
			{/* Set navigation controls */}
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="icon"
					onClick={goToPrevSet}
					disabled={isFirstSet}
					aria-label="Previous set"
				>
					<ChevronLeft className="w-5 h-5" />
				</Button>

				<span className="text-sm text-muted-foreground min-w-[80px] text-center">
					Set {currentSetIndex + 1} of {totalSets}
				</span>

				<Button
					variant="outline"
					size="icon"
					onClick={goToNextSet}
					disabled={isLastSet}
					aria-label="Next set"
				>
					<ChevronRight className="w-5 h-5" />
				</Button>
			</div>

			{/* View mode toggle */}
			<Tabs
				value={viewMode}
				onValueChange={(v) => setViewMode(v as "set" | "session")}
				className="flex-shrink-0"
			>
				<TabsList className="h-8">
					<TabsTrigger value="set" className="px-3 text-xs">
						Set
					</TabsTrigger>
					<TabsTrigger
						value="session"
						className="px-3 text-xs"
						disabled
						title="Session-level replay is coming soon"
					>
						Session
					</TabsTrigger>
				</TabsList>
			</Tabs>
		</div>
	);
}
