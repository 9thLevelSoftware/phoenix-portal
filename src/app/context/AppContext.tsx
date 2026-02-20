import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface Routine {
  id: string;
  name: string;
  description: string;
  exercises: number;
  duration: number;
  timesCompleted: number;
  lastUsed: string;
  tags: string[];
  isFavorite: boolean;
}

export interface PR {
  id: string;
  exercise: string;
  muscleGroup: string;
  weight: number;
  reps: number;
  estimatedOneRM: number;
  date: string; // Stored as ISO string
  type: 'Weight PR' | 'Volume PR' | 'Rep PR';
  isNew: boolean;
}

export interface ExercisePRHistory {
  exercise: string;
  muscleGroup: string;
  currentPR: { weight: number; reps: number };
  estimatedOneRM: number;
  lastPRDate: string;
  trend: 'improving' | 'stable' | 'plateau';
  history: Array<{
    date: string;
    weight: number;
    reps: number;
    estimatedOneRM: number;
    mode: string;
  }>;
}

export interface AnalyticsData {
  volumeData: Array<{ date: string; volume: number; workouts: number }>;
  muscleGroupData: Array<{ name: string; value: number; color: string }>;
  exerciseBreakdown: Array<{ exercise: string; sets: number }>;
  strengthProgressData: Array<{ date: string; benchPress: number; squat: number; deadlift: number }>;
  insights: Array<{
    type: 'positive' | 'warning' | 'neutral';
    title: string;
    description: string;
  }>;
}

export interface WorkoutSession {
  id: string;
  name: string;
  date: string; // ISO string
  duration: number;
  volume: number;
  sets: number;
  exercises: number;
  prCount: number;
  routine?: string;
}

interface AppContextType {
  routines: Routine[];
  importedRoutines: Routine[];
  recentPRs: PR[];
  exercisePRs: ExercisePRHistory[];
  workoutSessions: WorkoutSession[];
  analytics: AnalyticsData;
  
  // Actions
  addRoutine: (routine: Routine) => void;
  updateRoutine: (id: string, routine: Partial<Routine>) => void;
  deleteRoutine: (id: string) => void;
  duplicateRoutine: (id: string) => void;
  toggleFavoriteRoutine: (id: string) => void;
  deleteImportedRoutine: (id: string) => void;

  addPR: (pr: PR) => void;
  updatePR: (id: string, updates: Partial<PR>) => void;
  deletePR: (id: string) => void;

  addWorkoutSession: (session: WorkoutSession) => void;
  updateWorkoutSession: (id: string, updates: Partial<WorkoutSession>) => void;
  deleteWorkoutSession: (id: string) => void;
}

const defaultRoutines: Routine[] = [
  {
    id: '1',
    name: 'Push Day A',
    description: 'Chest, shoulders, and triceps focus with progressive overload',
    exercises: 6,
    duration: 60,
    timesCompleted: 24,
    lastUsed: '2 days ago',
    tags: ['Chest', 'Shoulders', 'Arms'],
    isFavorite: true,
  },
  {
    id: '2',
    name: 'Pull Day B',
    description: 'Back and biceps hypertrophy routine',
    exercises: 6,
    duration: 55,
    timesCompleted: 22,
    lastUsed: '3 days ago',
    tags: ['Back', 'Arms'],
    isFavorite: false,
  },
  {
    id: '3',
    name: 'Leg Day',
    description: 'Quad and glute dominant with hamstring work',
    exercises: 7,
    duration: 70,
    timesCompleted: 19,
    lastUsed: '5 days ago',
    tags: ['Legs'],
    isFavorite: true,
  },
];

const defaultImported: Routine[] = [
  {
    id: '4',
    name: 'Community PPL',
    description: 'Popular push/pull/legs split from the community',
    exercises: 8,
    duration: 65,
    timesCompleted: 0,
    lastUsed: 'Never',
    tags: ['Chest', 'Back', 'Legs'],
    isFavorite: false,
  },
];

const defaultRecentPRs: PR[] = [
  {
    id: '1',
    exercise: 'Bench Press',
    muscleGroup: 'Chest',
    weight: 120,
    reps: 5,
    estimatedOneRM: 135,
    date: new Date(new Date().getFullYear(), 0, 18).toISOString(),
    type: 'Weight PR',
    isNew: true,
  },
  {
    id: '2',
    exercise: 'Squat',
    muscleGroup: 'Legs',
    weight: 150,
    reps: 8,
    estimatedOneRM: 187.5,
    date: new Date(new Date().getFullYear(), 0, 17).toISOString(),
    type: 'Volume PR',
    isNew: true,
  },
  {
    id: '3',
    exercise: 'Deadlift',
    muscleGroup: 'Back',
    weight: 180,
    reps: 3,
    estimatedOneRM: 191,
    date: new Date(new Date().getFullYear(), 0, 15).toISOString(),
    type: 'Weight PR',
    isNew: false,
  },
];

const defaultExercisePRs: ExercisePRHistory[] = [
  {
    exercise: 'Bench Press',
    muscleGroup: 'Chest',
    currentPR: { weight: 120, reps: 5 },
    estimatedOneRM: 135,
    lastPRDate: new Date(new Date().getFullYear(), 0, 18).toISOString(),
    trend: 'improving',
    history: [
      { date: new Date(new Date().getFullYear(), 0, 18).toISOString(), weight: 120, reps: 5, estimatedOneRM: 135, mode: 'Eccentric' },
      { date: new Date(new Date().getFullYear(), 0, 4).toISOString(), weight: 115, reps: 5, estimatedOneRM: 129, mode: 'Standard' },
      { date: new Date(new Date().getFullYear() - 1, 11, 20).toISOString(), weight: 110, reps: 5, estimatedOneRM: 124, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Squat',
    muscleGroup: 'Legs',
    currentPR: { weight: 150, reps: 8 },
    estimatedOneRM: 187.5,
    lastPRDate: new Date(new Date().getFullYear(), 0, 17).toISOString(),
    trend: 'improving',
    history: [
      { date: new Date(new Date().getFullYear(), 0, 17).toISOString(), weight: 150, reps: 8, estimatedOneRM: 187.5, mode: 'Chains' },
      { date: new Date(new Date().getFullYear(), 0, 3).toISOString(), weight: 145, reps: 8, estimatedOneRM: 181, mode: 'Standard' },
      { date: new Date(new Date().getFullYear() - 1, 11, 15).toISOString(), weight: 140, reps: 8, estimatedOneRM: 175, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Deadlift',
    muscleGroup: 'Back',
    currentPR: { weight: 180, reps: 3 },
    estimatedOneRM: 191,
    lastPRDate: new Date(new Date().getFullYear(), 0, 15).toISOString(),
    trend: 'stable',
    history: [
      { date: new Date(new Date().getFullYear(), 0, 15).toISOString(), weight: 180, reps: 3, estimatedOneRM: 191, mode: 'Standard' },
      { date: new Date(new Date().getFullYear() - 1, 11, 28).toISOString(), weight: 175, reps: 3, estimatedOneRM: 186, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Overhead Press',
    muscleGroup: 'Shoulders',
    currentPR: { weight: 65, reps: 6 },
    estimatedOneRM: 75,
    lastPRDate: new Date(new Date().getFullYear() - 1, 10, 10).toISOString(),
    trend: 'plateau',
    history: [
      { date: new Date(new Date().getFullYear() - 1, 10, 10).toISOString(), weight: 65, reps: 6, estimatedOneRM: 75, mode: 'Standard' },
      { date: new Date(new Date().getFullYear() - 1, 9, 5).toISOString(), weight: 62.5, reps: 6, estimatedOneRM: 72, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Barbell Row',
    muscleGroup: 'Back',
    currentPR: { weight: 95, reps: 8 },
    estimatedOneRM: 118.75,
    lastPRDate: new Date(new Date().getFullYear(), 0, 12).toISOString(),
    trend: 'improving',
    history: [
      { date: new Date(new Date().getFullYear(), 0, 12).toISOString(), weight: 95, reps: 8, estimatedOneRM: 118.75, mode: 'Standard' },
      { date: new Date(new Date().getFullYear() - 1, 11, 25).toISOString(), weight: 90, reps: 8, estimatedOneRM: 112.5, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Pull-ups',
    muscleGroup: 'Back',
    currentPR: { weight: 20, reps: 10 },
    estimatedOneRM: 26.7,
    lastPRDate: new Date(new Date().getFullYear(), 0, 16).toISOString(),
    trend: 'improving',
    history: [
      { date: new Date(new Date().getFullYear(), 0, 16).toISOString(), weight: 20, reps: 10, estimatedOneRM: 26.7, mode: 'Weighted' },
      { date: new Date(new Date().getFullYear() - 1, 11, 30).toISOString(), weight: 15, reps: 10, estimatedOneRM: 20, mode: 'Weighted' },
    ],
  },
];

const defaultWorkoutSessions: WorkoutSession[] = [
  {
    id: '1',
    name: 'Upper Body Power',
    date: new Date(new Date().getFullYear(), 0, 18).toISOString(),
    duration: 65,
    volume: 4250,
    sets: 16,
    exercises: 5,
    prCount: 2,
    routine: 'Push/Pull/Legs',
  },
  {
    id: '2',
    name: 'Lower Body Strength',
    date: new Date(new Date().getFullYear(), 0, 17).toISOString(),
    duration: 75,
    volume: 5680,
    sets: 18,
    exercises: 6,
    prCount: 1,
    routine: 'Push/Pull/Legs',
  },
  {
    id: '3',
    name: 'Pull Focus',
    date: new Date(new Date().getFullYear(), 0, 16).toISOString(),
    duration: 60,
    volume: 3890,
    sets: 14,
    exercises: 4,
    prCount: 0,
  },
  {
    id: '4',
    name: 'Full Body',
    date: new Date(new Date().getFullYear(), 0, 15).toISOString(),
    duration: 55,
    volume: 3200,
    sets: 12,
    exercises: 6,
    prCount: 1,
  },
  {
    id: '5',
    name: 'Upper Body Hypertrophy',
    date: new Date(new Date().getFullYear(), 0, 14).toISOString(),
    duration: 70,
    volume: 4100,
    sets: 20,
    exercises: 5,
    prCount: 3,
    routine: 'Push/Pull/Legs',
  },
  {
    id: '6',
    name: 'Leg Day',
    date: new Date(new Date().getFullYear(), 0, 12).toISOString(),
    duration: 80,
    volume: 6200,
    sets: 16,
    exercises: 5,
    prCount: 2,
  },
  {
    id: '7',
    name: 'Push Focus',
    date: new Date(new Date().getFullYear(), 0, 11).toISOString(),
    duration: 58,
    volume: 3750,
    sets: 15,
    exercises: 4,
    prCount: 0,
  },
];

const defaultAnalytics: AnalyticsData = {
  volumeData: [
    { date: 'Week 1', volume: 18500, workouts: 4 },
    { date: 'Week 2', volume: 21200, workouts: 5 },
    { date: 'Week 3', volume: 19800, workouts: 4 },
    { date: 'Week 4', volume: 23100, workouts: 6 },
    { date: 'Week 5', volume: 24500, workouts: 5 },
    { date: 'Week 6', volume: 22900, workouts: 5 },
    { date: 'Week 7', volume: 26700, workouts: 6 },
    { date: 'Week 8', volume: 28200, workouts: 6 },
  ],
  muscleGroupData: [
    { name: 'Chest', value: 22, color: '#FF6B35' },
    { name: 'Back', value: 20, color: '#DC2626' },
    { name: 'Legs', value: 18, color: '#F59E0B' },
    { name: 'Shoulders', value: 15, color: '#10B981' },
    { name: 'Arms', value: 15, color: '#6B7280' },
    { name: 'Core', value: 10, color: '#FBBF24' },
  ],
  exerciseBreakdown: [
    { exercise: 'Bench Press', sets: 48 },
    { exercise: 'Squat', sets: 42 },
    { exercise: 'Deadlift', sets: 36 },
    { exercise: 'Rows', sets: 40 },
    { exercise: 'Shoulder Press', sets: 32 },
    { exercise: 'Pull-ups', sets: 28 },
  ],
  strengthProgressData: [
    { date: 'Jan', benchPress: 100, squat: 140, deadlift: 160 },
    { date: 'Feb', benchPress: 105, squat: 145, deadlift: 165 },
    { date: 'Mar', benchPress: 107, squat: 150, deadlift: 170 },
    { date: 'Apr', benchPress: 112, squat: 155, deadlift: 175 },
    { date: 'May', benchPress: 115, squat: 157, deadlift: 178 },
    { date: 'Jun', benchPress: 120, squat: 160, deadlift: 180 },
  ],
  insights: [
    {
      type: 'positive',
      title: 'Volume Trending Up',
      description: 'Your total training volume increased by 12% this month',
    },
    {
      type: 'warning',
      title: 'Push/Pull Imbalance',
      description: 'You\'ve trained chest 40% more than back. Consider balancing.',
    },
    {
      type: 'positive',
      title: 'Consistency Score: 87%',
      description: 'Great work! You\'re maintaining excellent workout frequency.',
    },
    {
      type: 'neutral',
      title: 'Squat Plateau Detected',
      description: 'No PR in squat for 3 weeks. Consider a deload or variation.',
    },
  ],
};


const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [importedRoutines, setImportedRoutines] = useState<Routine[]>([]);
  const [recentPRs, setRecentPRs] = useState<PR[]>([]);
  const [exercisePRs, setExercisePRs] = useState<ExercisePRHistory[]>([]);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData>(defaultAnalytics);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from LocalStorage
  useEffect(() => {
    const loadState = () => {
      try {
        const savedRoutines = localStorage.getItem('phoenix_routines');
        if (savedRoutines) {
          setRoutines(JSON.parse(savedRoutines));
        } else {
          setRoutines(defaultRoutines);
        }

        const savedImported = localStorage.getItem('phoenix_imported_routines');
        if (savedImported) {
          setImportedRoutines(JSON.parse(savedImported));
        } else {
          setImportedRoutines(defaultImported);
        }
        
        const savedRecentPRs = localStorage.getItem('phoenix_recent_prs');
        if (savedRecentPRs) {
          setRecentPRs(JSON.parse(savedRecentPRs));
        } else {
          setRecentPRs(defaultRecentPRs);
        }

        const savedExercisePRs = localStorage.getItem('phoenix_exercise_prs');
        if (savedExercisePRs) {
          setExercisePRs(JSON.parse(savedExercisePRs));
        } else {
          setExercisePRs(defaultExercisePRs);
        }

        const savedWorkoutSessions = localStorage.getItem('phoenix_workout_sessions');
        if (savedWorkoutSessions) {
          setWorkoutSessions(JSON.parse(savedWorkoutSessions));
        } else {
          setWorkoutSessions(defaultWorkoutSessions);
        }

        const savedAnalytics = localStorage.getItem('phoenix_analytics');
        if (savedAnalytics) {
          setAnalytics(JSON.parse(savedAnalytics));
        } else {
          setAnalytics(defaultAnalytics);
        }
      } catch (e) {
        console.error("Failed to load state from localStorage", e);
        setRoutines(defaultRoutines);
        setImportedRoutines(defaultImported);
        setRecentPRs(defaultRecentPRs);
        setExercisePRs(defaultExercisePRs);
        setWorkoutSessions(defaultWorkoutSessions);
        setAnalytics(defaultAnalytics);
      } finally {
        setIsLoaded(true);
      }
    };
    loadState();
  }, []);

  // Save to LocalStorage when state changes
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('phoenix_routines', JSON.stringify(routines));
      localStorage.setItem('phoenix_imported_routines', JSON.stringify(importedRoutines));
      localStorage.setItem('phoenix_recent_prs', JSON.stringify(recentPRs));
      localStorage.setItem('phoenix_exercise_prs', JSON.stringify(exercisePRs));
      localStorage.setItem('phoenix_workout_sessions', JSON.stringify(workoutSessions));
      localStorage.setItem('phoenix_analytics', JSON.stringify(analytics));
    }
  }, [routines, importedRoutines, recentPRs, exercisePRs, workoutSessions, analytics, isLoaded]);

  // Routine Actions
  const addRoutine = (routine: Routine) => {
    setRoutines(prev => [...prev, routine]);
  };

  const updateRoutine = (id: string, updates: Partial<Routine>) => {
    setRoutines(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const deleteRoutine = (id: string) => {
    setRoutines(prev => prev.filter(r => r.id !== id));
  };

  const duplicateRoutine = (id: string) => {
    setRoutines(prev => {
      const routine = prev.find(r => r.id === id);
      if (routine) {
        return [...prev, {
          ...routine,
          id: Date.now().toString(),
          name: `${routine.name} (Copy)`,
          timesCompleted: 0,
          lastUsed: 'Never'
        }];
      }
      return prev;
    });
  };

  const toggleFavoriteRoutine = (id: string) => {
    setRoutines(prev => prev.map(r => r.id === id ? { ...r, isFavorite: !r.isFavorite } : r));
  };

  const deleteImportedRoutine = (id: string) => {
    setImportedRoutines(prev => prev.filter(r => r.id !== id));
  };

  // PR Actions
  const addPR = (pr: PR) => {
    setRecentPRs(prev => [pr, ...prev]);
  };

  const updatePR = (id: string, updates: Partial<PR>) => {
    setRecentPRs(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const deletePR = (id: string) => {
    setRecentPRs(prev => prev.filter(p => p.id !== id));
  };

  // Workout Session Actions
  const addWorkoutSession = (session: WorkoutSession) => {
    setWorkoutSessions(prev => [session, ...prev]);
  };

  const updateWorkoutSession = (id: string, updates: Partial<WorkoutSession>) => {
    setWorkoutSessions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const deleteWorkoutSession = (id: string) => {
    setWorkoutSessions(prev => prev.filter(s => s.id !== id));
  };

  if (!isLoaded) return null;

  return (
    <AppContext.Provider value={{
      routines,
      importedRoutines,
      recentPRs,
      exercisePRs,
      workoutSessions,
      analytics,
      addRoutine,
      updateRoutine,
      deleteRoutine,
      duplicateRoutine,
      toggleFavoriteRoutine,
      deleteImportedRoutine,
      addPR,
      updatePR,
      deletePR,
      addWorkoutSession,
      updateWorkoutSession,
      deleteWorkoutSession,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
