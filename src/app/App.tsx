import { useState } from 'react';
import { LandingPage } from '@/app/components/LandingPage';
import { Navigation } from '@/app/components/Navigation';
import { Dashboard } from '@/app/components/Dashboard';
import { DashboardMobile } from '@/app/components/DashboardMobile';
import { Analytics } from '@/app/components/Analytics';
import { Challenges } from '@/app/components/Challenges';
import { Community } from '@/app/components/Community';
import { Routines } from '@/app/components/Routines';
import { Profile } from '@/app/components/Profile';
import { PrivacyPolicy } from '@/app/components/PrivacyPolicy';
import { WorkoutHistory } from '@/app/components/WorkoutHistory';
import { SessionDetail } from '@/app/components/SessionDetail';
import { PersonalRecords } from '@/app/components/PersonalRecords';
import { RoutinesEnhanced } from '@/app/components/RoutinesEnhanced';
import { RoutineBuilder } from '@/app/components/RoutineBuilder';
import { TrainingCycles } from '@/app/components/TrainingCycles';
import { CelebrationDemo } from '@/app/components/CelebrationDemo';
import { MobileBottomNav } from '@/app/components/MobileBottomNav';
import { Toaster } from '@/app/components/ui/sonner';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [showRoutineBuilder, setShowRoutineBuilder] = useState(false);
  const [showCycleBuilder, setShowCycleBuilder] = useState(false);
  const [streak, setStreak] = useState(7);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile on mount
  useState(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  });

  const handleGetStarted = () => {
    setIsAuthenticated(true);
    setCurrentPage('dashboard');
  };

  const handleNavigate = (page: string) => {
    setCurrentPage(page);
    setSelectedSessionId(null); // Reset session detail when navigating
    setShowRoutineBuilder(false);
    setShowCycleBuilder(false);
    setSelectedRoutineId(null);
  };

  const handleNavigateToPrivacy = () => {
    setShowPrivacyPolicy(true);
  };

  const handleBackFromPrivacy = () => {
    setShowPrivacyPolicy(false);
  };

  const handleViewSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
  };

  const handleBackFromSession = () => {
    setSelectedSessionId(null);
  };

  const handleCreateRoutine = () => {
    setShowRoutineBuilder(true);
    setSelectedRoutineId(null);
  };

  const handleEditRoutine = (id: string) => {
    setShowRoutineBuilder(true);
    setSelectedRoutineId(id);
  };

  const handleBackFromRoutineBuilder = () => {
    setShowRoutineBuilder(false);
    setSelectedRoutineId(null);
  };

  const handleSaveRoutine = (routine: any) => {
    console.log('Saving routine:', routine);
    setShowRoutineBuilder(false);
    setSelectedRoutineId(null);
  };

  const handleCreateCycle = () => {
    setShowCycleBuilder(true);
  };

  const handleEditCycle = (id: string) => {
    setShowCycleBuilder(true);
  };

  if (showPrivacyPolicy) {
    return (
      <>
        <PrivacyPolicy onBack={handleBackFromPrivacy} />
        <Toaster />
      </>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <LandingPage onGetStarted={handleGetStarted} onNavigateToPrivacy={handleNavigateToPrivacy} />
        <Toaster />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D0D0D]">
      <Navigation currentPage={currentPage} onNavigate={handleNavigate} streak={streak} />
      
      {currentPage === 'dashboard' && <Dashboard />}
      {currentPage === 'history' && selectedSessionId && <SessionDetail sessionId={selectedSessionId} onBack={handleBackFromSession} />}
      {currentPage === 'history' && !selectedSessionId && <WorkoutHistory onViewSession={handleViewSession} />}
      {currentPage === 'records' && <PersonalRecords />}
      {currentPage === 'analytics' && <Analytics />}
      {currentPage === 'challenges' && <Challenges />}
      {currentPage === 'community' && <Community />}
      
      {/* Routines Page */}
      {currentPage === 'routines' && !showRoutineBuilder && (
        <RoutinesEnhanced onCreateRoutine={handleCreateRoutine} onEditRoutine={handleEditRoutine} />
      )}
      {currentPage === 'routines' && showRoutineBuilder && (
        <RoutineBuilder 
          routineId={selectedRoutineId || undefined}
          onBack={handleBackFromRoutineBuilder}
          onSave={handleSaveRoutine}
        />
      )}
      
      {/* Cycles Page */}
      {currentPage === 'cycles' && <TrainingCycles onCreateCycle={handleCreateCycle} onEditCycle={handleEditCycle} />}
      
      {/* Celebration Demo Page (hidden - access via /celebrations) */}
      {currentPage === 'celebrations' && <CelebrationDemo />}
      
      {currentPage === 'profile' && <Profile />}

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        currentPage={currentPage}
        onNavigate={handleNavigate}
        streak={streak}
        notifications={{
          challenges: 3,
          community: 5,
        }}
      />

      <Toaster />
    </div>
  );
}