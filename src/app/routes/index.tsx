import { type ComponentType, lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { NotFound } from "@/app/components/NotFound";
import { PageLoading } from "@/app/components/PageLoading";
import { AppLayout } from "./AppLayout";
import { ProtectedRoute } from "./ProtectedRoute";
import { SubscribedRoute } from "./SubscribedRoute";

/**
 * Wraps a dynamic import so that chunk-load failures (caused by a new deploy
 * invalidating old hashed filenames) trigger a single page reload to fetch the
 * updated index.html and asset manifest.
 */
function lazyWithReload<T extends ComponentType<unknown>>(
	factory: () => Promise<{ default: T }>,
) {
	return lazy(() =>
		factory().catch((error: unknown) => {
			const msg = error instanceof Error ? error.message.toLowerCase() : "";
			const isChunkError =
				msg.includes("failed to fetch dynamically imported module") ||
				msg.includes("loading chunk") ||
				msg.includes("loading css chunk");

			if (isChunkError) {
				const key = "phoenix-chunk-reload";
				const last = sessionStorage.getItem(key);
				const now = Date.now();
				if (!last || now - Number(last) > 30_000) {
					sessionStorage.setItem(key, String(now));
					window.location.reload();
				}
			}
			// Re-throw so the error boundary still catches it if reload didn't fire
			throw error;
		}),
	);
}

// Lazy-load all page components for code splitting
const LandingPage = lazyWithReload(() =>
	import("@/app/components/LandingPage").then((m) => ({
		default: m.LandingPage,
	})),
);
const PrivacyPolicy = lazyWithReload(() =>
	import("@/app/components/PrivacyPolicy").then((m) => ({
		default: m.PrivacyPolicy,
	})),
);
const TermsOfService = lazyWithReload(() =>
	import("@/app/components/TermsOfService").then((m) => ({
		default: m.TermsOfService,
	})),
);
const ResetPassword = lazyWithReload(() =>
	import("@/app/components/ResetPassword").then((m) => ({
		default: m.ResetPassword,
	})),
);
const AuthCallback = lazyWithReload(() =>
	import("@/app/components/AuthCallback").then((m) => ({
		default: m.AuthCallback,
	})),
);
const Dashboard = lazyWithReload(() =>
	import("@/app/components/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const WorkoutHistory = lazyWithReload(() =>
	import("@/app/components/WorkoutHistory").then((m) => ({
		default: m.WorkoutHistory,
	})),
);
const SessionDetail = lazyWithReload(() =>
	import("@/app/components/SessionDetail").then((m) => ({
		default: m.SessionDetail,
	})),
);
const Leaderboard = lazyWithReload(() =>
	import("@/app/components/Leaderboard").then((m) => ({
		default: m.Leaderboard,
	})),
);
const Analytics = lazyWithReload(() =>
	import("@/app/components/Analytics").then((m) => ({ default: m.Analytics })),
);
const Challenges = lazyWithReload(() =>
	import("@/app/components/Challenges").then((m) => ({
		default: m.Challenges,
	})),
);
const Community = lazyWithReload(() =>
	import("@/app/components/Community").then((m) => ({ default: m.Community })),
);
const RoutinesEnhanced = lazyWithReload(() =>
	import("@/app/components/RoutinesEnhanced").then((m) => ({
		default: m.RoutinesEnhanced,
	})),
);
const RoutineBuilder = lazyWithReload(() =>
	import("@/app/components/RoutineBuilder").then((m) => ({
		default: m.RoutineBuilder,
	})),
);
const RoutineDetail = lazyWithReload(() =>
	import("@/app/components/RoutineDetail").then((m) => ({
		default: m.RoutineDetail,
	})),
);
const TrainingCycles = lazyWithReload(() =>
	import("@/app/components/TrainingCycles").then((m) => ({
		default: m.TrainingCycles,
	})),
);
const CycleBuilder = lazyWithReload(() =>
	import("@/app/components/CycleBuilder").then((m) => ({
		default: m.CycleBuilder,
	})),
);
const Profile = lazyWithReload(() =>
	import("@/app/components/Profile").then((m) => ({ default: m.Profile })),
);
const PricingPlans = lazyWithReload(() =>
	import("@/app/components/PricingPlans").then((m) => ({
		default: m.PricingPlans,
	})),
);
const SessionReplay = lazyWithReload(() =>
	import("@/app/components/session-replay/SessionReplay").then((m) => ({
		default: m.SessionReplay,
	})),
);
const Integrations = lazyWithReload(() =>
	import("@/app/components/Integrations").then((m) => ({
		default: m.Integrations,
	})),
);
const ComparisonView = lazyWithReload(() =>
	import("@/app/components/ComparisonView").then((m) => ({
		default: m.ComparisonView,
	})),
);
const Goals = lazyWithReload(() =>
	import("@/app/components/Goals").then((m) => ({ default: m.Goals })),
);
const Recovery = lazyWithReload(() =>
	import("@/app/components/Recovery").then((m) => ({ default: m.Recovery })),
);
const FAQ = lazyWithReload(() =>
	import("@/app/components/FAQ").then((m) => ({ default: m.FAQ })),
);

// ---------- Route tree ----------

export function AppRoutes() {
	return (
		<Suspense fallback={<PageLoading />}>
			<Routes>
				{/* Public routes */}
				<Route path="/" element={<LandingPage />} />
				<Route path="/privacy" element={<PrivacyPolicy />} />
				<Route path="/terms" element={<TermsOfService />} />
				<Route path="/faq" element={<FAQ />} />
				<Route path="/auth/callback" element={<AuthCallback />} />
				<Route path="/auth/reset-password" element={<ResetPassword />} />

				{/* Protected routes */}
				<Route element={<ProtectedRoute />}>
					<Route element={<AppLayout />}>
						{/* Ungated — accessible to all authenticated users */}
						<Route path="/profile" element={<Profile />} />
						<Route path="/pricing" element={<PricingPlans />} />

						{/* EMBER tier — cloud backup, history, dashboard */}
						<Route element={<SubscribedRoute requiredTier="EMBER" />}>
							<Route path="/dashboard" element={<Dashboard />} />
							<Route path="/history" element={<WorkoutHistory />} />
							<Route path="/history/:sessionId" element={<SessionDetail />} />
							<Route path="/goals" element={<Goals />} />
							<Route path="/recovery" element={<Recovery />} />
						</Route>

						{/* FLAME tier — analytics, community, social, integrations */}
						<Route element={<SubscribedRoute requiredTier="FLAME" />}>
							<Route path="/challenges" element={<Challenges />} />
							<Route path="/analytics" element={<Analytics />} />
							<Route path="/community" element={<Community />} />
							<Route path="/leaderboard" element={<Leaderboard />} />
							<Route path="/routines" element={<RoutinesEnhanced />} />
							<Route path="/routines/new" element={<RoutineBuilder />} />
							<Route
								path="/routines/:routineId/view"
								element={<RoutineDetail />}
							/>
							<Route path="/routines/:routineId" element={<RoutineBuilder />} />
							<Route path="/cycles" element={<TrainingCycles />} />
							<Route path="/cycles/new" element={<CycleBuilder />} />
							<Route path="/cycles/:cycleId" element={<CycleBuilder />} />
							<Route path="/compare" element={<ComparisonView />} />
							<Route path="/integrations" element={<Integrations />} />
							<Route
								path="/biomechanics"
								element={<Navigate to="/analytics?tab=biomechanics" replace />}
							/>
						</Route>

						{/* FLAME tier — session replay (INFERNO not yet purchasable) */}
						<Route element={<SubscribedRoute requiredTier="FLAME" />}>
							<Route path="/replay/:sessionId" element={<SessionReplay />} />
						</Route>

						{/* Catch-all for authenticated users */}
						<Route path="*" element={<NotFound />} />
					</Route>
				</Route>

				{/* Catch-all for unauthenticated users -- OUTSIDE ProtectedRoute to avoid redirect loop */}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</Suspense>
	);
}
