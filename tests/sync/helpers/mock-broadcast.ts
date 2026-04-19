/**
 * Mock Supabase Broadcast Channel
 *
 * Captures broadcast events emitted by the push Edge Function so tests can
 * assert `sync_complete` is fired with the expected payload shape.
 *
 * The real Edge Function does:
 *   const channel = supabase.channel(`sync:${userId}`);
 *   await channel.send({ type: 'broadcast', event: 'sync_complete', payload });
 *
 * Our mock-edge-functions.ts intercepts the push call before it ever reaches
 * Supabase, so we simulate the broadcast at that boundary: each successful
 * push records a synthetic `sync_complete` event into the capture store.
 */

export interface CapturedBroadcast {
	channel: string;
	event: string;
	payload: Record<string, unknown>;
	/** Wall-clock timestamp in ms when the broadcast was captured. */
	timestamp: number;
}

const capturedBroadcasts: CapturedBroadcast[] = [];

/** If set, broadcasts are emitted via the throwIfSet path (simulates backend failure). */
let broadcastShouldThrow = false;

/**
 * Record a broadcast. Called from mockPushEndpoint on a successful push.
 * If `setBroadcastShouldThrow(true)` was called, this swallows the error
 * silently — matching fire-and-forget behaviour of the real Edge Function.
 */
export function recordBroadcast(channel: string, event: string, payload: Record<string, unknown>): void {
	if (broadcastShouldThrow) {
		// Real Edge Function wraps broadcast in try/catch — error is logged,
		// but the push still returns 200. Capture nothing.
		return;
	}
	capturedBroadcasts.push({
		channel,
		event,
		payload,
		timestamp: Date.now(),
	});
}

/** Get all broadcasts captured since the last reset. */
export function getCapturedBroadcasts(): ReadonlyArray<CapturedBroadcast> {
	return capturedBroadcasts;
}

/** Get broadcasts matching a given event name (default: sync_complete). */
export function getBroadcastsByEvent(event = "sync_complete"): CapturedBroadcast[] {
	return capturedBroadcasts.filter((b) => b.event === event);
}

/** Get broadcasts for a specific channel. */
export function getBroadcastsByChannel(channel: string): CapturedBroadcast[] {
	return capturedBroadcasts.filter((b) => b.channel === channel);
}

/** Reset captured broadcasts (call between tests). */
export function resetBroadcasts(): void {
	capturedBroadcasts.length = 0;
	broadcastShouldThrow = false;
}

/**
 * Inject a broadcast failure: future broadcasts silently fail (matches the
 * real Edge Function's try/catch around channel.send).
 */
export function setBroadcastShouldThrow(shouldThrow: boolean): void {
	broadcastShouldThrow = shouldThrow;
}
