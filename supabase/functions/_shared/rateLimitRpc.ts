export interface RateLimitRpcRow {
	allowed: boolean;
	remaining: number;
	retry_after_seconds: number | null;
}

/**
 * PostgREST returns SETOF/TABLE RPC results as an array of rows, even when the
 * SQL function emits exactly one row. The rate-limit helper expects a single
 * logical row, so normalize both object and single-element-array shapes.
 */
export function normalizeRateLimitRpcResult(
	value: unknown,
): RateLimitRpcRow | null {
	if (Array.isArray(value)) {
		if (value.length !== 1) return null;
		return normalizeRateLimitRpcResult(value[0]);
	}

	if (!value || typeof value !== "object") return null;

	const candidate = value as Record<string, unknown>;
	if (typeof candidate.allowed !== "boolean") return null;
	if (typeof candidate.remaining !== "number") return null;
	if (
		!(
			typeof candidate.retry_after_seconds === "number" ||
			candidate.retry_after_seconds === null
		)
	) {
		return null;
	}

	return {
		allowed: candidate.allowed,
		remaining: candidate.remaining,
		retry_after_seconds: candidate.retry_after_seconds,
	};
}
