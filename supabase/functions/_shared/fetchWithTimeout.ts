const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
	input: RequestInfo | URL,
	init: RequestInit = {},
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() =>
			controller.abort(
				new DOMException(
					`Request timed out after ${timeoutMs}ms`,
					"TimeoutError",
				),
			),
		timeoutMs,
	);
	const callerSignal = init.signal;
	const abortFromCaller = () =>
		controller.abort(
			(callerSignal as AbortSignal & { reason?: unknown }).reason,
		);

	if (callerSignal) {
		if (callerSignal.aborted) {
			abortFromCaller();
		} else {
			callerSignal.addEventListener("abort", abortFromCaller, { once: true });
		}
	}

	try {
		return await fetch(input, {
			...init,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
		callerSignal?.removeEventListener("abort", abortFromCaller);
	}
}
