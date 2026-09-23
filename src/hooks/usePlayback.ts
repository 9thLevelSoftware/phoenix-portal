import { useAnimationFrame } from "motion/react";
import { useReplayStore } from "@/stores/useReplayStore";

export function usePlayback(maxTimeMs: number) {
	const { isPlaying, currentTimeMs, speed, seek, pause } = useReplayStore();

	useAnimationFrame((_time, delta) => {
		if (!isPlaying) return;

		// delta is in milliseconds, apply speed multiplier
		const deltaMs = delta * speed;
		const newTime = currentTimeMs + deltaMs;

		if (newTime >= maxTimeMs) {
			seek(maxTimeMs);
			pause();
		} else {
			seek(newTime);
		}
	});
}
