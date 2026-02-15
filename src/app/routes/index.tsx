import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams, useNavigate } from 'react-router';
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

// ---------- Route wrapper components ----------
// These extract URL params and pass them as props to components that still
// require them. Plan 02-03 will refactor the components to use useParams/useNavigate
// internally, eliminating these wrappers.

function LandingPageRoute() {
  const navigate = useNavigate();
  return <LandingPage onNavigateToPrivacy={() => navigate('/privacy')} />;
}

function PrivacyPolicyRoute() {
  const navigate = useNavigate();
  return <PrivacyPolicy onBack={() => navigate(-1)} />;
}

function WorkoutHistoryRoute() {
  const navigate = useNavigate();
  return <WorkoutHistory onViewSession={(id: string) => navigate(`/history/${id}`)} />;
}

function SessionDetailRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  if (!sessionId) return <Navigate to="/history" replace />;
  return <SessionDetail sessionId={sessionId} onBack={() => navigate('/history')} />;
}

function RoutinesEnhancedRoute() {
  const navigate = useNavigate();
  return (
    <RoutinesEnhanced
      onCreateRoutine={() => navigate('/routines/new')}
      onEditRoutine={(id: string) => navigate(`/routines/${id}`)}
    />
  );
}

function RoutineBuilderRoute() {
  const { routineId } = useParams<{ routineId: string }>();
  const navigate = useNavigate();
  return (
    <RoutineBuilder
      routineId={routineId}
      onBack={() => navigate('/routines')}
      onSave={() => navigate('/routines')}
    />
  );
}

function TrainingCyclesRoute() {
  const navigate = useNavigate();
  return (
    <TrainingCycles
      onCreateCycle={() => navigate('/cycles/new')}
      onEditCycle={(id: string) => navigate(`/cycles/${id}`)}
    />
  );
}

function CycleBuilderRoute() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const navigate = useNavigate();
  return (
    <CycleBuilder
      cycleId={cycleId}
      onBack={() => navigate('/cycles')}
      onSave={() => navigate('/cycles')}
    />
  );
}

// ---------- Route tree ----------

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPageRoute />} />
        <Route path="/privacy" element={<PrivacyPolicyRoute />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/history" element={<WorkoutHistoryRoute />} />
            <Route path="/history/:sessionId" element={<SessionDetailRoute />} />
            <Route path="/records" element={<PersonalRecords />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/challenges" element={<Challenges />} />
            <Route path="/community" element={<Community />} />
            <Route path="/routines" element={<RoutinesEnhancedRoute />} />
            <Route path="/routines/new" element={<RoutineBuilderRoute />} />
            <Route path="/routines/:routineId" element={<RoutineBuilderRoute />} />
            <Route path="/cycles" element={<TrainingCyclesRoute />} />
            <Route path="/cycles/new" element={<CycleBuilderRoute />} />
            <Route path="/cycles/:cycleId" element={<CycleBuilderRoute />} />
            <Route path="/profile" element={<Profile />} />
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
