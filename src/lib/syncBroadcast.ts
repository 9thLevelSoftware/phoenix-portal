/** Exact Broadcast topic for mobile-to-portal sync. Duplicated in Deno `_shared`. */
export function syncBroadcastTopic(userId: string): string {
	return `sync:${userId}`;
}
