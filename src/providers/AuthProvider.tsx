import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { supabase } from "@/lib/supabase";

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

	useEffect(() => {
		let isActive = true;

		const applySession = (nextSession: Session | null) => {
			if (!isActive) {
				return;
			}

			setSession(nextSession);
			setUser(nextSession?.user ?? null);
			setLoading(false);
		};

		// Get initial session
		void supabase.auth
			.getSession()
			.then(({ data: { session: initialSession } }) => {
				applySession(initialSession);
			})
			.catch(() => {
				applySession(null);
			});

		// Listen for auth state changes
		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((event, newSession) => {
			if (event === "SIGNED_OUT") {
				queryClient.clear();
			}
			applySession(newSession);
		});

		return () => {
			isActive = false;
			subscription.unsubscribe();
		};
	}, [queryClient]);

	const handleSignOut = async () => {
		await supabase.auth.signOut();
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
