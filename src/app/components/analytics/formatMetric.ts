/** Format a phase metric, dropping a trailing `.0` so whole numbers stay compact. */
export function formatMetric(value: number, decimals = 1): string {
	return value.toFixed(decimals).replace(/\.0$/, "");
}
