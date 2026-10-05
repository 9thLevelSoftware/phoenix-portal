/**
 * Shared helpers for the Hevy and Strong CSV importers.
 * Both exports describe one workout as many set rows, so both parsers
 * group those rows and convert mile distances to meters.
 */

/** International mile in meters. */
export const MILES_TO_METERS = 1609.344;

/**
 * Group an array of items by a key function.
 * Keys and items keep first-seen order.
 */
export function groupBy<T>(
	items: T[],
	keyFn: (item: T) => string,
): Record<string, T[]> {
	const groups: Record<string, T[]> = {};
	for (const item of items) {
		const key = keyFn(item);
		if (!groups[key]) {
			groups[key] = [];
		}
		groups[key].push(item);
	}
	return groups;
}
