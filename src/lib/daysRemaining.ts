/**
 * Whole days remaining until `end`, clamped at zero.
 *
 * Partial days round up: `Math.ceil(ms / 86_400_000)`. `now` defaults to
 * `Date.now()`. This is elapsed-millisecond math, not a calendar-day count.
 */
export function daysRemaining(
	end: string | number | Date,
	now = Date.now(),
): number {
	const diffMs = new Date(end).getTime() - now;
	return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}
