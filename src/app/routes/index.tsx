import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { NotFound } from "@/app/components/NotFound";
import { PageLoading } from "@/app/components/PageLoading";
import { AppLayout } from "./AppLayout";
import { ProtectedRoute } from "./ProtectedRoute";

// Lazy-load all page components for code splitting
const LandingPage = lazy(() =>
	import("@/app/components/LandingPage").then((m) => ({
		default: m.LandingPage,
	})),
);
const PrivacyPolicy = lazy(() =>
	import("@/app/components/PrivacyPolicy").then((m) => ({
		default: m.PrivacyPolicy,
	})),
);
const TermsOfService = lazy(() =>
	import("@/app/components/TermsOfService").then((m) => ({
		default: m.TermsOfService,
	})),
);
const ResetPassword = lazy(() =>
	import("@/app/components/ResetPassword").then((m) => ({
		default: m.ResetPassword,
	})),
);
const Dashboard = lazy(() =>
	import("@/app/components/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const WorkoutHistory = lazy(() =>
	import("@/app/components/WorkoutHistory").then((m) => ({
		default: m.WorkoutHistory,
	})),
);
const SessionDetail = lazy(() =>
	import("@/app/components/SessionDetail").then((m) => ({
		default: m.SessionDetail,
	})),
);
const PersonalRecords = lazy(() =>
	import("@/app/components/PersonalRecords").then((m) => ({
		default: m.PersonalRecords,
	})),
);
const Analytics = lazy(() =>
	import("@/app/components/Analytics").then((m) => ({ default: m.Analytics })),
);
const Challenges = lazy(() =>
	import("@/app/components/Challenges").then((m) => ({
		default: m.Challenges,
	})),
);
const Community = lazy(() =>
	import("@/app/components/Community").then((m) => ({ default: m.Community })),
);
const RoutinesEnhanced = lazy(() =>
	import("@/app/components/RoutinesEnhanced").then((m) => ({
		default: m.RoutinesEnhanced,
	})),
);
const RoutineBuilder = lazy(() =>
	import("@/app/components/RoutineBuilder").then((m) => ({
		default: m.RoutineBuilder,
	})),
);
const TrainingCycles = lazy(() =>
	import("@/app/components/TrainingCycles").then((m) => ({
		default: m.TrainingCycles,
	})),
);
const CycleBuilder = lazy(() =>
	import("@/app/components/CycleBuilder").then((m) => ({
		default: m.CycleBuilder,
	})),
);
const CelebrationDemo = lazy(() =>
	import("@/app/components/CelebrationDemo").then((m) => ({
		default: m.CelebrationDemo,
	})),
);
const Profile = lazy(() =>
	import("@/app/components/Profile").then((m) => ({ default: m.Profile })),
);
const PricingPlans = lazy(() =>
	import("@/app/components/PricingPlans").then((m) => ({
		default: m.PricingPlans,
	})),
);
const Biomechanics = lazy(() =>
	import("@/app/components/Biomechanics").then((m) => ({
		default: m.Biomechanics,
	})),
);
const SessionReplay = lazy(() =>
	import("@/app/components/session-replay/SessionReplay").then((m) => ({
		default: m.SessionReplay,
	})),
);
const Integrations = lazy(() =>
	import("@/app/components/Integrations").then((m) => ({
		default: m.Integrations,
	})),
);
const ComparisonView = lazy(() =>
	import("@/app/components/ComparisonView").then((m) => ({
		default: m.ComparisonView,
	})),
);
const Goals = lazy(() =>
	import("@/app/components/Goals").then((m) => ({ default: m.Goals })),
);
const Recovery = lazy(() =>
	import("@/app/components/Recovery").then((m) => ({ default: m.Recovery })),
);
const FAQ = lazy(() =>
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
				<Route path="/auth/reset-password" element={<ResetPassword />} />

				{/* Protected routes */}
				<Route element={<ProtectedRoute />}>
					<Route element={<AppLayout />}>
						<Route path="/dashboard" element={<Dashboard />} />
						<Route path="/history" element={<WorkoutHistory />} />
						<Route path="/history/:sessionId" element={<SessionDetail />} />
						<Route path="/replay/:sessionId" element={<SessionReplay />} />
						<Route path="/records" element={<PersonalRecords />} />
						<Route path="/analytics" element={<Analytics />} />
						<Route path="/biomechanics" element={<Biomechanics />} />
						<Route path="/goals" element={<Goals />} />
						<Route path="/recovery" element={<Recovery />} />
						<Route path="/challenges" element={<Challenges />} />
						<Route path="/community" element={<Community />} />
						<Route path="/routines" element={<RoutinesEnhanced />} />
						<Route path="/routines/new" element={<RoutineBuilder />} />
						<Route path="/routines/:routineId" element={<RoutineBuilder />} />
						<Route path="/cycles" element={<TrainingCycles />} />
						<Route path="/cycles/new" element={<CycleBuilder />} />
						<Route path="/cycles/:cycleId" element={<CycleBuilder />} />
						<Route path="/compare" element={<ComparisonView />} />
						<Route path="/integrations" element={<Integrations />} />
						<Route path="/profile" element={<Profile />} />
						<Route path="/pricing" element={<PricingPlans />} />
						<Route path="/celebrations" element={<CelebrationDemo />} />
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
