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

	// fix(F327): validate semantic bounds, not just JS types, so a malformed
	// RPC/test-double cannot push negative/fractional/non-finite values into API
	// responses and `Retry-After` headers. Callers fail closed on null.
	const { remaining, retry_after_seconds } = candidate;
	if (!Number.isSafeInteger(remaining) || (remaining as number) < 0) {
		return null;
	}
	if (
		retry_after_seconds !== null &&
		(!Number.isSafeInteger(retry_after_seconds) ||
			(retry_after_seconds as number) < 1)
	) {
		return null;
	}

	return {
		allowed: candidate.allowed,
		remaining: remaining as number,
		retry_after_seconds: retry_after_seconds as number | null,
	};
}
