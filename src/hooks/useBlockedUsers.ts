import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { blockedUsersOptions } from "@/queries/community";
import { useCommunityStore } from "@/stores/useCommunityStore";

const STORAGE_KEY_PREFIX = "phoenix-blocked-users";

/** Per-user storage key so one account's blocked list never leaks to another. */
function storageKeyFor(userId: string): string {
	return `${STORAGE_KEY_PREFIX}:${userId}`;
}

export function normalizeBlockedUserIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];

	return [
		...new Set(
			value.filter(
				(id): id is string => typeof id === "string" && id.length > 0,
			),
		),
	];
}

/**
 * Hook that loads blocked user IDs into Zustand store with localStorage hydration.
 * Prevents flash of blocked content on page load by reading from localStorage first,
 * then syncing with server data via TanStack Query.
 */
export function useBlockedUsers(): { blockedUserIds: Set<string> } {
	const { user } = useAuth();
	const userId = user?.id ?? null;
	const blockedUserIds = useCommunityStore((s) => s.blockedUserIds);
	const setBlockedUserIds = useCommunityStore((s) => s.setBlockedUserIds);
	const resetAll = useCommunityStore((s) => s.resetAll);

	// Hydrate from this user's localStorage on mount/account switch for instant
	// blocking. When there's no authenticated user, clear any stale community
	// state so one account's blocked list never applies to another.
	useEffect(() => {
		if (!userId) {
			resetAll();
			return;
		}
		try {
			const stored = localStorage.getItem(storageKeyFor(userId));
			if (stored) {
				const ids = normalizeBlockedUserIds(JSON.parse(stored));
				setBlockedUserIds(new Set(ids));
			} else {
				// No cached data for this user yet — don't inherit a previous user's set.
				setBlockedUserIds(new Set());
			}
		} catch {
			// Ignore malformed localStorage data
			setBlockedUserIds(new Set());
		}
	}, [userId, setBlockedUserIds, resetAll]);

	const { data } = useQuery({
		...blockedUsersOptions(userId ?? ""),
		enabled: !!userId,
	});

	// Sync server data to Zustand store and this user's localStorage
	useEffect(() => {
		if (data && userId) {
			const normalized = normalizeBlockedUserIds(data);
			const newSet = new Set(normalized);
			setBlockedUserIds(newSet);
			try {
				localStorage.setItem(storageKeyFor(userId), JSON.stringify(normalized));
			} catch {
				// Ignore localStorage write failures
			}
		}
	}, [data, userId, setBlockedUserIds]);

	return { blockedUserIds };
}
