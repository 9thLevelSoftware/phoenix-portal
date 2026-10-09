import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

interface AuthContextType {
	user: User | null;
	session: Session | null;
	loading: boolean;
	signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const [user, setUser] = useState<User | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [loading, setLoading] = useState(true);
	const appliedUserId = useRef<string | null | undefined>(undefined);

	useEffect(() => {
		let isActive = true;
		// Once any auth-state event has fired, it is authoritative. The initial
		// getSession() result must not overwrite a newer SIGNED_IN/SIGNED_OUT state
		// if it resolves afterwards (race between getSession and onAuthStateChange).
		let authEventReceived = false;

		const applySession = (nextSession: Session | null) => {
			if (!isActive) {
				return;
			}

			const nextUser = nextSession?.user ?? null;
			const nextUserId = nextUser?.id ?? null;
			if (appliedUserId.current !== nextUserId) {
				// Cancellation and removal happen before exposing a new principal.
				// This also discards a cache retained across provider remounts.
				void queryClient.cancelQueries();
				queryClient.clear();
				appliedUserId.current = nextUserId;
			}
			setSession(nextSession);
			setUser(nextUser);
			// Bind the persisted profile filter to the current user. If it was
			// rehydrated for a different user (sign-out then a new sign-in in the
			// same browser session), this clears it so the previous user's local
			// profile can't leak into RLS-affecting create/import mutations.
			useProfileFilterStore.getState().setOwnerUser(nextUser?.id ?? null);
			setLoading(false);
		};

		// Get initial session
		void supabase.auth
			.getSession()
			.then(({ data: { session: initialSession } }) => {
				if (authEventReceived) {
					return;
				}
				applySession(initialSession);
			})
			.catch(() => {
				if (authEventReceived) {
					return;
				}
				applySession(null);
			});

		// Listen for auth state changes
		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, newSession) => {
			authEventReceived = true;
			applySession(newSession);
		});

		return () => {
			isActive = false;
			subscription.unsubscribe();
		};
	}, [queryClient]);

	const handleSignOut = async () => {
		const { error } = await supabase.auth.signOut();
		if (error) {
			// Surface the failure to callers; do not clear cached data while the
			// user may still be authenticated to avoid an inconsistent UI state.
			throw error;
		}
		queryClient.clear();
	};

	return (
		<AuthContext.Provider
			value={{ user, session, loading, signOut: handleSignOut }}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth(): AuthContextType {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
