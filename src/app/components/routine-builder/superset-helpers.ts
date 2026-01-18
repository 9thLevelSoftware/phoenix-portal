// Superset Enhancement Module for RoutineBuilder
// Add these interfaces and state to existing RoutineBuilder.tsx

export interface SupersetGroup {
  id: string;
  exerciseIds: string[];
  color: string;
  transitionTime: number; // seconds between exercises in superset
  restAfter: number; // rest after completing all exercises in superset
}

export const SUPERSET_COLORS = [
  { id: 'A', color: '#6366F1', name: 'Indigo' },
  { id: 'B', color: '#EC4899', name: 'Pink' },
  { id: 'C', color: '#10B981', name: 'Green' },
  { id: 'D', color: '#F59E0B', name: 'Amber' },
];

// Add these state variables to RoutineBuilder component:
// const [selectionMode, setSelectionMode] = useState(false);
// const [selectedExerciseIds, setSelectedExerciseIds] = useState<string[]>([]);
// const [supersets, setSupersets] = useState<SupersetGroup[]>([]);

// Superset Helper Functions
export function getNextSupersetColor(existingSupersets: SupersetGroup[]): string {
  const usedColors = existingSupersets.map(s => s.color);
  const availableColor = SUPERSET_COLORS.find(c => !usedColors.includes(c.color));
  return availableColor?.color || SUPERSET_COLORS[0].color;
}

export function isExerciseInSuperset(exerciseId: string, supersets: SupersetGroup[]): SupersetGroup | null {
  return supersets.find(s => s.exerciseIds.includes(exerciseId)) || null;
}

export function createSuperset(
  exerciseIds: string[],
  existingSupersets: SupersetGroup[]
): SupersetGroup {
  return {
    id: `superset-${Date.now()}`,
    exerciseIds,
    color: getNextSupersetColor(existingSupersets),
    transitionTime: 10,
    restAfter: 90,
  };
}

export function ungroupSuperset(
  supersetId: string,
  supersets: SupersetGroup[]
): SupersetGroup[] {
  return supersets.filter(s => s.id !== supersetId);
}

export function addExerciseToSuperset(
  supersetId: string,
  exerciseId: string,
  supersets: SupersetGroup[]
): SupersetGroup[] {
  return supersets.map(s =>
    s.id === supersetId
      ? { ...s, exerciseIds: [...s.exerciseIds, exerciseId] }
      : s
  );
}
