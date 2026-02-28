import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/providers/AuthProvider";
import { blockedUsersOptions } from "@/queries/community";
import { useCommunityStore } from "@/stores/useCommunityStore";

const STORAGE_KEY = "phoenix-blocked-users";

/**
 * Hook that loads blocked user IDs into Zustand store with localStorage hydration.
 * Prevents flash of blocked content on page load by reading from localStorage first,
 * then syncing with server data via TanStack Query.
 */
export function useBlockedUsers(): { blockedUserIds: Set<string> } {
	const { user } = useAuth();
	const blockedUserIds = useCommunityStore((s) => s.blockedUserIds);
	const setBlockedUserIds = useCommunityStore((s) => s.setBlockedUserIds);

	// Hydrate from localStorage on mount for instant blocking
	useEffect(() => {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				const ids: string[] = JSON.parse(stored);
				if (Array.isArray(ids) && ids.length > 0) {
					setBlockedUserIds(new Set(ids));
				}
			}
		} catch {
			// Ignore malformed localStorage data
		}
	}, [setBlockedUserIds]);

	const { data } = useQuery({
		...blockedUsersOptions(user?.id ?? ""),
		enabled: !!user,
	});

	// Sync server data to Zustand store and localStorage
	useEffect(() => {
		if (data) {
			const newSet = new Set(data);
			setBlockedUserIds(newSet);
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
			} catch {
				// Ignore localStorage write failures
			}
		}
	}, [data, setBlockedUserIds]);

	return { blockedUserIds };
}
