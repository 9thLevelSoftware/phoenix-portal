/** Exact Broadcast topic for mobile-to-portal sync. Duplicated in Vite `src/lib`. */
export function syncBroadcastTopic(userId: string): string {
  return `sync:${userId}`;
}
