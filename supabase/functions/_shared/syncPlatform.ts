export function normalizeSyncPlatform(value: unknown): string {
	if (typeof value !== "string") return "unknown";

	const normalized = value.trim().toLowerCase();
	if (!normalized) return "unknown";
	if (normalized.includes("android")) return "android";
	if (normalized.includes("ios")) return "ios";

	return normalized;
}

/**
 * Produce a short, bounded-length summary of a raw platform input for
 * diagnostic logs. Never throws, never leaks large payloads.
 *
 * Examples:
 *   describeSyncPlatformInput(undefined)   -> 'type=undefined'
 *   describeSyncPlatformInput(null)        -> 'type=object,null'
 *   describeSyncPlatformInput('')          -> 'type=string,len=0'
 *   describeSyncPlatformInput('   ')       -> 'type=string,len=3,trimmedLen=0'
 *   describeSyncPlatformInput('Android 34') -> 'type=string,len=10,sample="android 34"'
 *   describeSyncPlatformInput(42)          -> 'type=number,value=42'
 */
export function describeSyncPlatformInput(value: unknown): string {
	if (value === null) return "type=object,null";
	const t = typeof value;
	if (t === "string") {
		const s = value as string;
		const trimmed = s.trim();
		if (!s.length) return "type=string,len=0";
		if (!trimmed.length) return `type=string,len=${s.length},trimmedLen=0`;
		// Lowercase + truncate the sample so logs stay small and we don't
		// leak PII if a client ever shoves something weird in this field.
		const sample = trimmed.toLowerCase().slice(0, 40);
		return `type=string,len=${s.length},sample="${sample}"`;
	}
	if (t === "number" || t === "boolean" || t === "bigint") {
		return `type=${t},value=${String(value)}`;
	}
	return `type=${t}`;
}
