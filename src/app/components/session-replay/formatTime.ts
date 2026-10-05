/**
 * Format milliseconds to mm:ss display.
 * Minutes are not capped at 59; a duration of an hour or more stays in minutes.
 */
export function formatTime(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
