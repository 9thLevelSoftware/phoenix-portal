import { useAnimationFrame } from 'motion/react';
import { useReplayStore } from '@/stores/useReplayStore';

export function usePlayback(maxTimeMs: number) {
  const { isPlaying, currentTimeMs, speed, seek, pause } = useReplayStore();

  useAnimationFrame((time, delta) => {
    if (!isPlaying) return;

    // delta is in seconds, convert to ms and apply speed
    const deltaMs = delta * 1000 * speed;
    const newTime = currentTimeMs + deltaMs;

    if (newTime >= maxTimeMs) {
      seek(maxTimeMs);
      pause();
    } else {
      seek(newTime);
    }
  });
}
