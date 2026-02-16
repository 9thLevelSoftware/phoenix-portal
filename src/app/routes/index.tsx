import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { ProtectedRoute } from './ProtectedRoute';
import { AppLayout } from './AppLayout';
import { PageLoading } from '@/app/components/PageLoading';

// Lazy-load all page components for code splitting
const LandingPage = lazy(() => import('@/app/components/LandingPage').then(m => ({ default: m.LandingPage })));
const PrivacyPolicy = lazy(() => import('@/app/components/PrivacyPolicy').then(m => ({ default: m.PrivacyPolicy })));
const Dashboard = lazy(() => import('@/app/components/Dashboard').then(m => ({ default: m.Dashboard })));
const WorkoutHistory = lazy(() => import('@/app/components/WorkoutHistory').then(m => ({ default: m.WorkoutHistory })));
const SessionDetail = lazy(() => import('@/app/components/SessionDetail').then(m => ({ default: m.SessionDetail })));
const PersonalRecords = lazy(() => import('@/app/components/PersonalRecords').then(m => ({ default: m.PersonalRecords })));
const Analytics = lazy(() => import('@/app/components/Analytics').then(m => ({ default: m.Analytics })));
const Challenges = lazy(() => import('@/app/components/Challenges').then(m => ({ default: m.Challenges })));
const Community = lazy(() => import('@/app/components/Community').then(m => ({ default: m.Community })));
const RoutinesEnhanced = lazy(() => import('@/app/components/RoutinesEnhanced').then(m => ({ default: m.RoutinesEnhanced })));
const RoutineBuilder = lazy(() => import('@/app/components/RoutineBuilder').then(m => ({ default: m.RoutineBuilder })));
const TrainingCycles = lazy(() => import('@/app/components/TrainingCycles').then(m => ({ default: m.TrainingCycles })));
const CycleBuilder = lazy(() => import('@/app/components/CycleBuilder').then(m => ({ default: m.CycleBuilder })));
const CelebrationDemo = lazy(() => import('@/app/components/CelebrationDemo').then(m => ({ default: m.CelebrationDemo })));
const Profile = lazy(() => import('@/app/components/Profile').then(m => ({ default: m.Profile })));
const PricingPlans = lazy(() => import('@/app/components/PricingPlans').then(m => ({ default: m.PricingPlans })));

// ---------- Route tree ----------

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/history" element={<WorkoutHistory />} />
            <Route path="/history/:sessionId" element={<SessionDetail />} />
            <Route path="/records" element={<PersonalRecords />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/challenges" element={<Challenges />} />
            <Route path="/community" element={<Community />} />
            <Route path="/routines" element={<RoutinesEnhanced />} />
            <Route path="/routines/new" element={<RoutineBuilder />} />
            <Route path="/routines/:routineId" element={<RoutineBuilder />} />
            <Route path="/cycles" element={<TrainingCycles />} />
            <Route path="/cycles/new" element={<CycleBuilder />} />
            <Route path="/cycles/:cycleId" element={<CycleBuilder />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/pricing" element={<PricingPlans />} />
            <Route path="/celebrations" element={<CelebrationDemo />} />
            {/* Catch-all for authenticated users */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>

        {/* Catch-all for unauthenticated users -- OUTSIDE ProtectedRoute to avoid redirect loop */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
