# Phoenix Portal UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the web portal's purpose as a library/community tool by removing execution controls, adding delete functionality, redesigning the leaderboard, refactoring the workouts tab, and removing broken celebration popups.

**Architecture:** Five independent feature changes executed in order of increasing complexity. Each can be committed separately. Celebration removal is a clean subtraction. Cycle activation removal simplifies existing UI. Delete adds mutations and confirmation dialogs. Workouts redesign restructures layout. Leaderboard is the largest scope requiring new queries and an Edge Function.

**Tech Stack:** React 19, TanStack Query 5, Zustand, shadcn/ui (AlertDialog), Supabase Edge Functions, Zod

---

## File Structure

### Files to Delete
- `src/app/components/CelebrationOverlay.tsx`
- `src/app/components/CelebrationDemo.tsx`
- `src/app/components/GoalCelebration.tsx`
- `src/app/components/celebrations/` (entire directory)
- `src/hooks/useCelebrationTriggers.ts`
- `src/stores/useCelebrationStore.ts`
- `src/stores/__tests__/useCelebrationStore.test.ts`

### Files to Create
- `src/app/components/DeleteConfirmDialog.tsx` — Reusable delete confirmation dialog
- `src/app/components/CalendarWidget.tsx` — Compact month calendar for sidebar
- `src/app/components/WorkoutQuickStats.tsx` — Sidebar stats component
- `src/queries/leaderboard.ts` — Leaderboard data queries
- `src/app/components/Leaderboard.tsx` — New leaderboard page component
- `src/app/components/analytics/RecordsTab.tsx` — Personal records as Analytics tab
- `supabase/functions/compute-rankings/index.ts` — Edge Function for leaderboard

### Files to Modify
- `src/app/routes/AppLayout.tsx` — Remove CelebrationOverlay and useCelebrationTriggers
- `src/app/components/TrainingCycles.tsx` — Remove progress bar, simplify to library view
- `src/app/components/RoutinesEnhanced.tsx` — Add delete to card menu
- `src/mutations/routines.ts` — Add useDeleteRoutine
- `src/mutations/cycles.ts` — Add useDeleteCycle
- `src/app/components/WorkoutHistory.tsx` — Refactor to list-first layout
- `src/app/components/Analytics.tsx` — Add Records tab
- `src/app/components/AppSidebar.tsx` — Update Leaderboard route
- `src/app/components/MobileBottomNav.tsx` — Update Leaderboard route
- `src/app/routes/index.tsx` — Update routes
- `src/queries/keys.ts` — Add leaderboard keys

---

## Task 1: Remove Celebration Popups

**Files:**
- Delete: `src/app/components/CelebrationOverlay.tsx`
- Delete: `src/app/components/CelebrationDemo.tsx`
- Delete: `src/app/components/GoalCelebration.tsx`
- Delete: `src/app/components/celebrations/` (directory)
- Delete: `src/hooks/useCelebrationTriggers.ts`
- Delete: `src/stores/useCelebrationStore.ts`
- Delete: `src/stores/__tests__/useCelebrationStore.test.ts`
- Modify: `src/app/routes/AppLayout.tsx`
- Modify: `src/app/routes/index.tsx`
- Modify: `src/test/setup.ts`

- [ ] **Step 1: Remove CelebrationOverlay from AppLayout**

In `src/app/routes/AppLayout.tsx`, remove the import and usage:

```tsx
// Remove these lines:
// import { CelebrationOverlay } from "@/app/components/CelebrationOverlay";
// import { useCelebrationTriggers } from "@/hooks/useCelebrationTriggers";

// Inside AppLayout function, remove:
// useCelebrationTriggers();

// In the JSX, remove:
// <CelebrationOverlay />
```

- [ ] **Step 2: Remove CelebrationDemo route**

In `src/app/routes/index.tsx`, remove the CelebrationDemo lazy import and route:

```tsx
// Remove:
// const CelebrationDemo = lazyWithReload(() =>
//   import("@/app/components/CelebrationDemo").then((m) => ({
//     default: m.CelebrationDemo,
//   })),
// );

// Remove from routes:
// <Route path="/celebration-demo" element={<CelebrationDemo />} />
```

- [ ] **Step 3: Remove GoalCelebration import from Goals.tsx**

Check `src/app/components/Goals.tsx` for any GoalCelebration usage and remove.

- [ ] **Step 4: Clean up test setup**

In `src/test/setup.ts`, remove any celebration-related mocks if present.

- [ ] **Step 5: Delete celebration files**

```bash
rm -rf src/app/components/celebrations/
rm src/app/components/CelebrationOverlay.tsx
rm src/app/components/CelebrationDemo.tsx
rm src/app/components/GoalCelebration.tsx
rm src/hooks/useCelebrationTriggers.ts
rm src/stores/useCelebrationStore.ts
rm src/stores/__tests__/useCelebrationStore.test.ts
```

- [ ] **Step 6: Run typecheck to verify no broken imports**

```bash
npm run typecheck
```

Expected: No type errors related to celebration imports.

- [ ] **Step 7: Run tests**

```bash
npm test
```

Expected: All tests pass (celebration tests deleted, no other failures).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: remove broken celebration popups

Remove entire celebration system including:
- CelebrationOverlay component
- useCelebrationTriggers hook
- useCelebrationStore Zustand store
- All celebration components (PR, Badge, Streak, etc.)
- CelebrationDemo route

Celebrations will be redesigned properly in a future release.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Remove Cycle Activation UI

**Files:**
- Modify: `src/app/components/TrainingCycles.tsx`

- [ ] **Step 1: Simplify active cycle card**

In `src/app/components/TrainingCycles.tsx`, modify the active cycle section (lines ~146-215) to show read-only status:

```tsx
{/* Active Cycle Card - Read Only */}
{activeCycle && (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
  >
    <Card className="p-6 sm:p-8 bg-gradient-to-br from-primary/10 to-chart-2/10 border-2 border-primary/50 relative overflow-hidden">
      <div className="absolute top-4 right-4">
        <Badge className="bg-primary/80 text-white border-0">
          Active on mobile
        </Badge>
      </div>

      <div className="mb-4">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
          {activeCycle.name}
        </h2>
        <p className="text-sm text-muted-foreground">
          This cycle is currently active on your mobile app
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-4 h-4 text-primary" />
            <span className="font-data">
              {activeCycle.workout_days} workout days/week
            </span>
          </div>
          <div className="flex items-center gap-2">
            <BedDouble className="w-4 h-4 text-muted-foreground" />
            <span>{activeCycle.rest_days} rest days/week</span>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate(`/cycles/${activeCycle.id}`)}
          className="border-primary text-primary hover:bg-primary/10"
        >
          <Eye className="w-4 h-4 mr-2" />
          View Full Cycle
        </Button>
      </div>
    </Card>
  </motion.div>
)}
```

- [ ] **Step 2: Simplify cycle card status badges**

In the cycle grid (lines ~243-252), update badge display:

```tsx
<Badge
  className={
    cycle.status === "active"
      ? "bg-primary/80 text-white border-0"
      : "bg-accent text-white border-0"
  }
>
  {cycle.status === "active" ? "Active on mobile" : "DRAFT"}
</Badge>
```

- [ ] **Step 3: Remove progress bar from non-featured cycle cards**

Remove the progress bar section from cycle cards (lines ~314-322):

```tsx
{/* Remove this entire block: */}
{/* {cycle.status === "active" && (
  <div className="mb-4">
    <Progress
      value={(cycle.current_week / cycle.duration_weeks) * 100}
      className="h-2 bg-background"
    />
  </div>
)} */}
```

- [ ] **Step 4: Remove current_week computation logic**

Remove the current_week computation in allCycles mapping (lines ~43-52) since we no longer display it:

```tsx
const allCycles = cycles ?? [];
const activeCycle = allCycles.find((c) => c.status === "active");
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 6: Run tests**

```bash
npm test -- --grep TrainingCycles
```

Expected: Tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/components/TrainingCycles.tsx
git commit -m "feat: remove cycle activation UI from portal

Portal now shows read-only 'Active on mobile' badge instead of
progress tracking. Cycles are library items - activation happens
only on the mobile app.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Delete Confirmation Dialog

**Files:**
- Create: `src/app/components/DeleteConfirmDialog.tsx`

- [ ] **Step 1: Create the reusable dialog component**

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  itemName: string;
  itemType: "routine" | "cycle";
  isActive?: boolean;
  isDeleting?: boolean;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  itemName,
  itemType,
  isActive = false,
  isDeleting = false,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-red-900/50">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-red-400">{title}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              This will permanently delete{" "}
              <span className="font-medium text-white">"{itemName}"</span> and
              remove it from your mobile app on the next sync.
            </p>
            {isActive && itemType === "cycle" && (
              <p className="text-amber-400">
                This cycle is currently active on your mobile app. It will be
                deactivated.
              </p>
            )}
            <p className="text-muted-foreground">
              Your workout history will be preserved.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/DeleteConfirmDialog.tsx
git commit -m "feat: add reusable delete confirmation dialog

Supports routines and cycles with sync warning and active cycle
deactivation notice.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Delete Routine Mutation

**Files:**
- Modify: `src/mutations/routines.ts`

- [ ] **Step 1: Add useDeleteRoutine mutation**

Add at the end of `src/mutations/routines.ts`:

```tsx
export function useDeleteRoutine() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (routineId: string) => {
      if (!user) throw new Error("Must be logged in to delete routines");

      // Delete routine_exercises first (FK constraint)
      const { error: exError } = await supabase
        .from("routine_exercises")
        .delete()
        .eq("routine_id", routineId);

      if (exError) throw exError;

      // Delete the routine
      const { error: routineError } = await supabase
        .from("routines")
        .delete()
        .eq("id", routineId)
        .eq("user_id", user.id);

      if (routineError) throw routineError;

      return { id: routineId };
    },

    onSuccess: () => {
      toast.success("Routine deleted");
      queryClient.invalidateQueries({ queryKey: queryKeys.routines.all });
    },

    onError: (error: Error) => {
      console.error("[useDeleteRoutine] failed:", error);
      toast.error("Failed to delete routine. Please try again.");
    },
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/mutations/routines.ts
git commit -m "feat: add useDeleteRoutine mutation

Hard deletes routine and its exercises, invalidates query cache.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Delete to Routines UI

**Files:**
- Modify: `src/app/components/RoutinesEnhanced.tsx`

- [ ] **Step 1: Add imports and state**

At the top of the file, add:

```tsx
import { Trash2 } from "lucide-react";
import { DeleteConfirmDialog } from "@/app/components/DeleteConfirmDialog";
import { useDeleteRoutine } from "@/mutations/routines";
```

Inside `RoutinesEnhanced`, add state:

```tsx
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [routineToDelete, setRoutineToDelete] = useState<{
  id: string;
  name: string;
} | null>(null);
const deleteRoutineMutation = useDeleteRoutine();
```

- [ ] **Step 2: Add delete handler**

```tsx
const handleDeleteClick = (routine: { id: string; name: string }) => {
  setRoutineToDelete(routine);
  setDeleteDialogOpen(true);
};

const handleConfirmDelete = () => {
  if (routineToDelete) {
    deleteRoutineMutation.mutate(routineToDelete.id, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        setRoutineToDelete(null);
      },
    });
  }
};
```

- [ ] **Step 3: Update RoutineGrid props**

Add `onDelete` prop to RoutineGrid:

```tsx
<RoutineGrid
  routines={allRoutines}
  onEdit={(id: string) => navigate(`/routines/${id}`)}
  onView={(id: string) => navigate(`/routines/${id}/view`)}
  onToggleFavorite={handleToggleFavorite}
  isFavorite={isFavorite}
  onShare={() => setShareDialogOpen(true)}
  onDelete={handleDeleteClick}
/>
```

- [ ] **Step 4: Update RoutineGrid component**

Add `onDelete` to props interface and dropdown:

```tsx
function RoutineGrid({
  routines,
  onEdit,
  onView,
  onToggleFavorite,
  isFavorite,
  onShare,
  onDelete,
}: {
  routines: Routine[];
  onEdit: (id: string) => void;
  onView: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  isFavorite: (routine: Routine) => boolean;
  onShare: () => void;
  onDelete: (routine: { id: string; name: string }) => void;
}) {
```

In the dropdown menu, add delete option:

```tsx
<DropdownMenuItem
  className="text-red-400 hover:bg-red-900/20 cursor-pointer"
  onClick={() => onDelete({ id: routine.id, name: routine.name })}
>
  <Trash2 className="w-4 h-4 mr-2" />
  Delete
</DropdownMenuItem>
```

- [ ] **Step 5: Add dialog to JSX**

Before the closing `</div>` of the main component, add:

```tsx
{routineToDelete && (
  <DeleteConfirmDialog
    open={deleteDialogOpen}
    onOpenChange={setDeleteDialogOpen}
    title={`Delete "${routineToDelete.name}"?`}
    itemName={routineToDelete.name}
    itemType="routine"
    isDeleting={deleteRoutineMutation.isPending}
    onConfirm={handleConfirmDelete}
  />
)}
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 7: Run tests**

```bash
npm test -- --grep Routines
```

Expected: Tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/components/RoutinesEnhanced.tsx
git commit -m "feat: add delete button to routine cards

Delete option in kebab menu with confirmation dialog warning about
mobile sync impact.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Delete Cycle Mutation

**Files:**
- Modify: `src/mutations/cycles.ts`

- [ ] **Step 1: Add useDeleteCycle mutation**

Add at the end of `src/mutations/cycles.ts`:

```tsx
export function useDeleteCycle() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (cycleId: string) => {
      if (!user) throw new Error("Must be logged in to delete cycles");

      // Delete cycle_days first (FK constraint)
      const { error: daysError } = await supabase
        .from("cycle_days")
        .delete()
        .eq("cycle_id", cycleId);

      if (daysError) throw daysError;

      // Delete the cycle
      const { error: cycleError } = await supabase
        .from("training_cycles")
        .delete()
        .eq("id", cycleId)
        .eq("user_id", user.id);

      if (cycleError) throw cycleError;

      return { id: cycleId };
    },

    onSuccess: () => {
      toast.success("Training cycle deleted");
      queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all });
    },

    onError: (error: Error) => {
      console.error("[useDeleteCycle] failed:", error);
      toast.error("Failed to delete training cycle. Please try again.");
    },
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/mutations/cycles.ts
git commit -m "feat: add useDeleteCycle mutation

Hard deletes cycle and its days, invalidates query cache.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add Delete to Cycles UI

**Files:**
- Modify: `src/app/components/TrainingCycles.tsx`

- [ ] **Step 1: Add imports and state**

Add imports:

```tsx
import { Trash2 } from "lucide-react";
import { DeleteConfirmDialog } from "@/app/components/DeleteConfirmDialog";
import { useDeleteCycle } from "@/mutations/cycles";
```

Inside `TrainingCycles`, add state:

```tsx
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [cycleToDelete, setCycleToDelete] = useState<{
  id: string;
  name: string;
  isActive: boolean;
} | null>(null);
const deleteCycleMutation = useDeleteCycle();
```

- [ ] **Step 2: Add delete handlers**

```tsx
const handleDeleteClick = (cycle: {
  id: string;
  name: string;
  status: string;
}) => {
  setCycleToDelete({
    id: cycle.id,
    name: cycle.name,
    isActive: cycle.status === "active",
  });
  setDeleteDialogOpen(true);
};

const handleConfirmDelete = () => {
  if (cycleToDelete) {
    deleteCycleMutation.mutate(cycleToDelete.id, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        setCycleToDelete(null);
      },
    });
  }
};
```

- [ ] **Step 3: Add delete to dropdown menu**

In the cycle card dropdown (around line 260-275), add:

```tsx
<DropdownMenuItem
  className="text-red-400 hover:bg-red-900/20 cursor-pointer"
  onClick={() =>
    handleDeleteClick({
      id: cycle.id,
      name: cycle.name,
      status: cycle.status,
    })
  }
>
  <Trash2 className="w-4 h-4 mr-2" />
  Delete
</DropdownMenuItem>
```

- [ ] **Step 4: Add dialog to JSX**

Before the closing ShareContentDialog, add:

```tsx
{cycleToDelete && (
  <DeleteConfirmDialog
    open={deleteDialogOpen}
    onOpenChange={setDeleteDialogOpen}
    title={`Delete "${cycleToDelete.name}"?`}
    itemName={cycleToDelete.name}
    itemType="cycle"
    isActive={cycleToDelete.isActive}
    isDeleting={deleteCycleMutation.isPending}
    onConfirm={handleConfirmDelete}
  />
)}
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 6: Run tests**

```bash
npm test -- --grep Cycles
```

Expected: Tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/components/TrainingCycles.tsx
git commit -m "feat: add delete button to cycle cards

Delete option in kebab menu with confirmation dialog. Shows
additional warning if cycle is active on mobile.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Create CalendarWidget Component

**Files:**
- Create: `src/app/components/CalendarWidget.tsx`

- [ ] **Step 1: Create compact calendar component**

```tsx
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";

interface CalendarWidgetProps {
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
  workoutDates: Set<string>;
  selectedDate: Date | null;
  onDateSelect: (date: Date) => void;
  isDateLocked?: (date: Date) => boolean;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function CalendarWidget({
  currentMonth,
  onMonthChange,
  workoutDates,
  selectedDate,
  onDateSelect,
  isDateLocked,
}: CalendarWidgetProps) {
  const { daysInMonth, startingDayOfWeek, year, month } = useMemo(() => {
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    return {
      daysInMonth: lastDay.getDate(),
      startingDayOfWeek: firstDay.getDay(),
      year: y,
      month: m,
    };
  }, [currentMonth]);

  const navigateMonth = (direction: "prev" | "next") => {
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() + (direction === "prev" ? -1 : 1));
    onMonthChange(newDate);
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      today.getFullYear() === year &&
      today.getMonth() === month &&
      today.getDate() === day
    );
  };

  const hasWorkout = (day: number) => {
    const key = `${year}-${month}-${day}`;
    return workoutDates.has(key);
  };

  const isSelected = (day: number) => {
    if (!selectedDate) return false;
    return (
      selectedDate.getFullYear() === year &&
      selectedDate.getMonth() === month &&
      selectedDate.getDate() === day
    );
  };

  const monthLabel = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="bg-surface-2 rounded-lg border border-secondary p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigateMonth("prev")}
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-white">{monthLabel}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigateMonth("next")}
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAYS.map((day) => (
          <div
            key={day}
            className="text-center text-xs text-muted-foreground font-medium"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells for days before month start */}
        {Array.from({ length: startingDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="h-8" />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const date = new Date(year, month, day);
          const locked = isDateLocked?.(date) ?? false;
          const workout = hasWorkout(day);
          const selected = isSelected(day);
          const today = isToday(day);

          return (
            <button
              key={day}
              onClick={() => !locked && onDateSelect(date)}
              disabled={locked}
              className={cn(
                "h-8 w-full rounded text-xs font-medium transition-colors relative",
                "hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-primary",
                selected && "bg-primary text-white",
                today && !selected && "ring-1 ring-primary/50",
                locked && "opacity-40 cursor-not-allowed"
              )}
            >
              {day}
              {workout && (
                <span
                  className={cn(
                    "absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full",
                    selected ? "bg-white" : "bg-primary"
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/CalendarWidget.tsx
git commit -m "feat: add compact CalendarWidget component

Compact month view with workout indicators, date selection,
and locked date support.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Create WorkoutQuickStats Component

**Files:**
- Create: `src/app/components/WorkoutQuickStats.tsx`

- [ ] **Step 1: Create quick stats component**

```tsx
import { Flame, TrendingUp, Dumbbell } from "lucide-react";
import { formatVolume, type WeightUnit } from "@/lib/units";

interface WorkoutQuickStatsProps {
  weeklyWorkoutCount: number;
  currentStreak: number;
  monthlyVolume: number;
  unit: WeightUnit;
}

export function WorkoutQuickStats({
  weeklyWorkoutCount,
  currentStreak,
  monthlyVolume,
  unit,
}: WorkoutQuickStatsProps) {
  return (
    <div className="bg-surface-2 rounded-lg border border-secondary p-4 space-y-4">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
        Quick Stats
      </h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Dumbbell className="h-4 w-4" />
            <span>This week</span>
          </div>
          <span className="text-sm font-medium text-white font-data">
            {weeklyWorkoutCount} workout{weeklyWorkoutCount !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Flame className="h-4 w-4 text-primary" />
            <span>Streak</span>
          </div>
          <span className="text-sm font-medium text-white font-data">
            {currentStreak} day{currentStreak !== 1 ? "s" : ""}
            {currentStreak >= 7 && " 🔥"}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span>Monthly volume</span>
          </div>
          <span className="text-sm font-medium text-white font-data">
            {formatVolume(monthlyVolume, unit)}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/WorkoutQuickStats.tsx
git commit -m "feat: add WorkoutQuickStats sidebar component

Shows weekly workout count, current streak, and monthly volume.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Refactor WorkoutHistory to List-First Layout

**Files:**
- Modify: `src/app/components/WorkoutHistory.tsx`

- [ ] **Step 1: Add imports for new components**

```tsx
import { CalendarWidget } from "@/app/components/CalendarWidget";
import { WorkoutQuickStats } from "@/app/components/WorkoutQuickStats";
```

- [ ] **Step 2: Compute stats for sidebar**

Add after the `filteredWorkouts` useMemo:

```tsx
const workoutDates = useMemo(() => {
  const dates = new Set<string>();
  for (const w of allWorkouts) {
    const key = `${w.started_at.getFullYear()}-${w.started_at.getMonth()}-${w.started_at.getDate()}`;
    dates.add(key);
  }
  return dates;
}, [allWorkouts]);

const weeklyWorkoutCount = useMemo(() => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return allWorkouts.filter((w) => w.started_at >= weekAgo).length;
}, [allWorkouts]);

const monthlyVolume = useMemo(() => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return allWorkouts
    .filter((w) => w.started_at >= monthStart)
    .reduce((sum, w) => sum + w.total_volume, 0);
}, [allWorkouts]);
```

- [ ] **Step 3: Replace the main layout**

Replace the main return JSX (keeping loading/empty states) with a two-column layout:

```tsx
return (
  <div className="min-h-screen pb-24 md:pb-8">
    {/* Header */}
    <div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
        >
          <div>
            <h1 className="text-display-2 mb-2 text-white">Workouts</h1>
            <p className="text-muted-foreground">Your training history</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Date range filter */}
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="bg-surface-2 border border-secondary rounded-md px-3 py-2 text-sm text-white"
            >
              <option>Last 7 days</option>
              <option>Last 30 days</option>
              <option>Last 90 days</option>
              <option>Last 6 months</option>
              <option>All Time</option>
            </select>

            {/* Compare mode toggle */}
            {!compareMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompareMode(true)}
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Compare
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={exitCompareMode}
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            )}
          </div>
        </motion.div>
      </div>
    </div>

    {/* Content */}
    <PageShell>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main content - workout list */}
        <div className="flex-1 min-w-0">
          {compareMode && selectedForCompare.length > 0 && (
            <div className="mb-4 p-4 bg-surface-2 rounded-lg border border-secondary flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {selectedForCompare.length} of 2 selected
              </span>
              <Button
                size="sm"
                disabled={selectedForCompare.length !== 2}
                onClick={handleCompareSelected}
              >
                Compare Selected
              </Button>
            </div>
          )}

          <div className="space-y-4">
            {filteredWorkouts.map((workout, index) => (
              <WorkoutCard
                key={workout.id}
                workout={workout}
                index={index}
                unit={unit}
                isLocked={isEntryLocked(workout.started_at)}
                compareMode={compareMode}
                isSelected={selectedForCompare.includes(workout.id)}
                onToggleSelect={() => toggleCompareSelection(workout.id)}
                onClick={() => navigate(`/history/${workout.id}`)}
              />
            ))}

            {hasMore && (
              <Button
                variant="outline"
                className="w-full"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Sidebar - calendar and stats */}
        <div className="lg:w-80 space-y-4 lg:sticky lg:top-32 lg:self-start">
          <CalendarWidget
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            workoutDates={workoutDates}
            selectedDate={selectedDay}
            onDateSelect={(date) => {
              setSelectedDay(date);
              // TODO: Filter list to show workouts from this date
            }}
            isDateLocked={isCalendarMonthLocked}
          />

          <WorkoutQuickStats
            weeklyWorkoutCount={weeklyWorkoutCount}
            currentStreak={streak?.current ?? 0}
            monthlyVolume={monthlyVolume}
            unit={unit}
          />
        </div>
      </div>
    </PageShell>
  </div>
);
```

- [ ] **Step 4: Add WorkoutCard subcomponent**

Add a focused card component for the list view:

```tsx
function WorkoutCard({
  workout,
  index,
  unit,
  isLocked,
  compareMode,
  isSelected,
  onToggleSelect,
  onClick,
}: {
  workout: WorkoutSession;
  index: number;
  unit: WeightUnit;
  isLocked: boolean;
  compareMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  const dateStr = workout.started_at.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const durationMin = Math.round(workout.duration_seconds / 60);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
    >
      <Card
        className={cn(
          "p-4 bg-surface-2 border-secondary transition-all cursor-pointer",
          "hover:border-primary/50",
          isLocked && "opacity-60",
          isSelected && "border-primary ring-1 ring-primary"
        )}
        onClick={compareMode ? onToggleSelect : onClick}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm text-muted-foreground">{dateStr}</span>
              {workout.routine_name && (
                <Badge variant="outline" className="text-xs">
                  {workout.routine_name}
                </Badge>
              )}
              {isLocked && <Lock className="w-4 h-4 text-muted-foreground" />}
            </div>

            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>{durationMin} min</span>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Dumbbell className="w-4 h-4" />
                <span className="font-data">
                  {formatVolume(workout.total_volume, unit)}
                </span>
              </div>
              {workout.pr_count > 0 && (
                <div className="flex items-center gap-1 text-primary">
                  <Award className="w-4 h-4" />
                  <span>{workout.pr_count} PR{workout.pr_count > 1 ? "s" : ""}</span>
                </div>
              )}
            </div>
          </div>

          {compareMode && (
            <div
              className={cn(
                "w-6 h-6 rounded-full border-2 flex items-center justify-center",
                isSelected
                  ? "border-primary bg-primary"
                  : "border-secondary"
              )}
            >
              {isSelected && <Check className="w-4 h-4 text-white" />}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
```

- [ ] **Step 5: Import useStreak hook**

```tsx
import { useStreak } from "@/hooks/useStreak";
```

Inside component:

```tsx
const { data: streak } = useStreak();
```

- [ ] **Step 6: Add missing imports**

```tsx
import { cn } from "@/app/components/ui/utils";
import type { WeightUnit } from "@/lib/units";
```

- [ ] **Step 7: Remove old calendar view code**

Remove the `viewMode` state and toggle button, and the old full-page calendar render logic.

- [ ] **Step 8: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 9: Run tests**

```bash
npm test -- --grep WorkoutHistory
```

Expected: Tests pass (may need updates).

- [ ] **Step 10: Commit**

```bash
git add src/app/components/WorkoutHistory.tsx
git commit -m "feat: refactor WorkoutHistory to list-first layout

Replace full-page calendar with:
- Workout list as primary view
- Compact CalendarWidget in sidebar
- WorkoutQuickStats showing weekly/monthly stats

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Add Leaderboard Query Keys

**Files:**
- Modify: `src/queries/keys.ts`

- [ ] **Step 1: Add leaderboard keys**

Add after the `benchmarks` section:

```tsx
leaderboard: {
  all: ["leaderboard"] as const,
  global: () => [...queryKeys.leaderboard.all, "global"] as const,
  weekly: (week: string) =>
    [...queryKeys.leaderboard.all, "weekly", week] as const,
  userRank: (userId: string) =>
    [...queryKeys.leaderboard.all, "user", userId] as const,
},
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/queries/keys.ts
git commit -m "feat: add leaderboard query keys

Keys for global rankings, weekly competitions, and user rank.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Create Leaderboard Queries

**Files:**
- Create: `src/queries/leaderboard.ts`

- [ ] **Step 1: Create leaderboard query hooks**

```tsx
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rank: number;
  value: number;
  percentile: number;
}

export interface UserRanking {
  metric: string;
  rank: number;
  value: number;
  percentile: number;
  totalUsers: number;
}

export interface GlobalLeaderboard {
  totalVolume: LeaderboardEntry[];
  workoutCount: LeaderboardEntry[];
  longestStreak: LeaderboardEntry[];
  currentStreak: LeaderboardEntry[];
  prCount: LeaderboardEntry[];
  exerciseMastery: LeaderboardEntry[];
}

export interface WeeklyCompetition {
  id: string;
  metric: string;
  metricLabel: string;
  startDate: string;
  endDate: string;
  entries: LeaderboardEntry[];
  isSpecialEvent: boolean;
  eventName?: string;
}

export const globalLeaderboardOptions = () =>
  queryOptions({
    queryKey: queryKeys.leaderboard.global(),
    queryFn: async (): Promise<GlobalLeaderboard> => {
      const { data, error } = await supabase.functions.invoke(
        "compute-rankings",
        {
          body: { type: "global" },
        }
      );

      if (error) throw error;
      return data as GlobalLeaderboard;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

export const weeklyCompetitionOptions = (weekStart?: string) =>
  queryOptions({
    queryKey: queryKeys.leaderboard.weekly(
      weekStart ?? getCurrentWeekStart()
    ),
    queryFn: async (): Promise<WeeklyCompetition> => {
      const { data, error } = await supabase.functions.invoke(
        "compute-rankings",
        {
          body: { type: "weekly", weekStart },
        }
      );

      if (error) throw error;
      return data as WeeklyCompetition;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

export const userRankingOptions = (userId: string) =>
  queryOptions({
    queryKey: queryKeys.leaderboard.userRank(userId),
    queryFn: async (): Promise<UserRanking[]> => {
      const { data, error } = await supabase.functions.invoke(
        "compute-rankings",
        {
          body: { type: "user", userId },
        }
      );

      if (error) throw error;
      return data as UserRanking[];
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!userId,
  });

function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split("T")[0];
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/queries/leaderboard.ts
git commit -m "feat: add leaderboard query hooks

Queries for global rankings, weekly competitions, and user rank.
Calls compute-rankings Edge Function.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 13: Create Leaderboard Page Component

**Files:**
- Create: `src/app/components/Leaderboard.tsx`

- [ ] **Step 1: Create leaderboard component**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Award, Crown, Medal, Shield, TrendingUp, Trophy } from "lucide-react";
import { motion } from "motion/react";
import { PageShell } from "@/app/components/PageShell";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/components/ui/tabs";
import { useAuth } from "@/app/hooks/useAuth";
import {
  globalLeaderboardOptions,
  weeklyCompetitionOptions,
  userRankingOptions,
  type LeaderboardEntry,
} from "@/queries/leaderboard";

const METRIC_ICONS: Record<string, React.ElementType> = {
  totalVolume: TrendingUp,
  workoutCount: Award,
  longestStreak: Medal,
  currentStreak: Crown,
  prCount: Trophy,
  exerciseMastery: Shield,
};

const METRIC_LABELS: Record<string, string> = {
  totalVolume: "Total Volume",
  workoutCount: "Workout Count",
  longestStreak: "Longest Streak",
  currentStreak: "Current Streak",
  prCount: "PR Count",
  exerciseMastery: "Exercise Mastery",
};

export function Leaderboard() {
  const { user } = useAuth();
  const { data: globalData, isPending: globalLoading } = useQuery(
    globalLeaderboardOptions()
  );
  const { data: weeklyData, isPending: weeklyLoading } = useQuery(
    weeklyCompetitionOptions()
  );
  const { data: userRanks, isPending: userLoading } = useQuery(
    userRankingOptions(user?.id ?? "")
  );

  const isLoading = globalLoading || weeklyLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen pb-24 md:pb-8">
        <div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <Skeleton className="h-10 w-48 mb-2" />
            <Skeleton className="h-5 w-64" />
          </div>
        </div>
        <PageShell>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        </PageShell>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      {/* Header */}
      <div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h1 className="text-display-2 mb-2 text-white">Leaderboard</h1>
            <p className="text-muted-foreground">
              Compete with the Phoenix community
            </p>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <PageShell>
        <Tabs defaultValue="global" className="w-full">
          <TabsList variant="panel" className="mb-6">
            <TabsTrigger value="global">All-Time Rankings</TabsTrigger>
            <TabsTrigger value="weekly">Weekly Challenge</TabsTrigger>
            <TabsTrigger value="my-rank">My Rankings</TabsTrigger>
          </TabsList>

          <TabsContent value="global">
            {globalData && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.entries(globalData).map(([metric, entries]) => (
                  <RankingCard
                    key={metric}
                    metric={metric}
                    label={METRIC_LABELS[metric] || metric}
                    icon={METRIC_ICONS[metric] || Trophy}
                    entries={entries}
                    currentUserId={user?.id}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="weekly">
            {weeklyData && (
              <WeeklyChallenge
                competition={weeklyData}
                currentUserId={user?.id}
              />
            )}
          </TabsContent>

          <TabsContent value="my-rank">
            {userRanks && <MyRankings rankings={userRanks} />}
          </TabsContent>
        </Tabs>
      </PageShell>
    </div>
  );
}

function RankingCard({
  metric,
  label,
  icon: Icon,
  entries,
  currentUserId,
}: {
  metric: string;
  label: string;
  icon: React.ElementType;
  entries: LeaderboardEntry[];
  currentUserId?: string;
}) {
  const top3 = entries.slice(0, 3);
  const userEntry = entries.find((e) => e.userId === currentUserId);

  return (
    <Card className="p-6 bg-surface-2 border-secondary">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-white">{label}</h3>
      </div>

      <div className="space-y-3">
        {top3.map((entry, i) => (
          <div
            key={entry.userId}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span
                className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                  i === 0
                    ? "bg-yellow-500 text-black"
                    : i === 1
                      ? "bg-gray-400 text-black"
                      : "bg-amber-700 text-white"
                }`}
              >
                {i + 1}
              </span>
              <span className="text-sm text-white truncate max-w-[120px]">
                {entry.displayName}
              </span>
            </div>
            <span className="text-sm font-data text-muted-foreground">
              {entry.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {userEntry && userEntry.rank > 3 && (
        <div className="mt-4 pt-4 border-t border-secondary">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Badge className="bg-primary/20 text-primary border-0">
                #{userEntry.rank}
              </Badge>
              <span className="text-muted-foreground">Your rank</span>
            </div>
            <span className="text-muted-foreground">
              Top {userEntry.percentile.toFixed(0)}%
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function WeeklyChallenge({
  competition,
  currentUserId,
}: {
  competition: {
    metric: string;
    metricLabel: string;
    startDate: string;
    endDate: string;
    entries: LeaderboardEntry[];
    isSpecialEvent: boolean;
    eventName?: string;
  };
  currentUserId?: string;
}) {
  const userEntry = competition.entries.find(
    (e) => e.userId === currentUserId
  );

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-gradient-to-br from-primary/10 to-chart-2/10 border-primary/50">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">
              {competition.isSpecialEvent
                ? competition.eventName
                : `Weekly ${competition.metricLabel} Challenge`}
            </h2>
            <p className="text-sm text-muted-foreground">
              {new Date(competition.startDate).toLocaleDateString()} -{" "}
              {new Date(competition.endDate).toLocaleDateString()}
            </p>
          </div>
          {userEntry && (
            <Badge className="bg-primary text-white">
              #{userEntry.rank}
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          {competition.entries.slice(0, 10).map((entry, i) => (
            <div
              key={entry.userId}
              className={`flex items-center justify-between p-2 rounded ${
                entry.userId === currentUserId ? "bg-primary/20" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 text-center text-sm font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <span className="text-sm text-white">{entry.displayName}</span>
              </div>
              <span className="text-sm font-data text-muted-foreground">
                {entry.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function MyRankings({
  rankings,
}: {
  rankings: Array<{
    metric: string;
    rank: number;
    value: number;
    percentile: number;
    totalUsers: number;
  }>;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {rankings.map((ranking) => (
        <Card key={ranking.metric} className="p-6 bg-surface-2 border-secondary">
          <h3 className="text-lg font-semibold text-white mb-4">
            {METRIC_LABELS[ranking.metric] || ranking.metric}
          </h3>
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-4xl font-bold text-primary font-data">
                #{ranking.rank}
              </span>
              <span className="text-sm text-muted-foreground">
                of {ranking.totalUsers.toLocaleString()} users
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Your value</span>
              <span className="font-data text-white">
                {ranking.value.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Percentile</span>
              <Badge className="bg-primary/20 text-primary border-0">
                Top {ranking.percentile.toFixed(0)}%
              </Badge>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/Leaderboard.tsx
git commit -m "feat: add Leaderboard page component

Displays global rankings, weekly challenges, and user's own rankings
with tabs for navigation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 14: Create RecordsTab for Analytics

**Files:**
- Create: `src/app/components/analytics/RecordsTab.tsx`

- [ ] **Step 1: Create records tab component**

Extract the records display logic from PersonalRecords.tsx into a tab component:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Award, Calendar, ChevronRight, Trophy } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import { convertWeight, type WeightUnit } from "@/lib/units";
import { profileOptions } from "@/queries/profile";
import { personalRecordsOptions } from "@/queries/records";
import type { PersonalRecord } from "@/schemas/transforms";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

interface RecordsTabProps {
  unit: WeightUnit;
}

export default function RecordsTab({ unit }: RecordsTabProps) {
  const { user } = useAuth();
  const { activeProfileId } = useProfileFilterStore();
  const { data: records, isPending } = useQuery(
    personalRecordsOptions(user?.id ?? "", activeProfileId)
  );
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grouped" | "timeline">("grouped");

  // Group records by exercise
  const groupedRecords = useMemo(() => {
    if (!records) return new Map<string, PersonalRecord[]>();
    const groups = new Map<string, PersonalRecord[]>();
    for (const record of records) {
      const existing = groups.get(record.exercise_name) ?? [];
      existing.push(record);
      groups.set(record.exercise_name, existing);
    }
    return groups;
  }, [records]);

  // Timeline view: all records sorted by date
  const timelineRecords = useMemo(() => {
    if (!records) return [];
    return [...records].sort(
      (a, b) => b.achieved_at.getTime() - a.achieved_at.getTime()
    );
  }, [records]);

  if (isPending) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div className="text-center py-12">
        <Trophy className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">
          No personal records yet. Keep training!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* View toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={viewMode === "grouped" ? "default" : "outline"}
          size="sm"
          onClick={() => setViewMode("grouped")}
        >
          By Exercise
        </Button>
        <Button
          variant={viewMode === "timeline" ? "default" : "outline"}
          size="sm"
          onClick={() => setViewMode("timeline")}
        >
          <Calendar className="w-4 h-4 mr-2" />
          Timeline
        </Button>
      </div>

      {viewMode === "grouped" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from(groupedRecords.entries()).map(([exercise, recs]) => {
            const bestRecord = recs.reduce((best, r) =>
              r.value > best.value ? r : best
            );
            const displayValue = convertWeight(bestRecord.value, "kg", unit);

            return (
              <Card
                key={exercise}
                className="p-4 bg-surface-2 border-secondary hover:border-primary/50 cursor-pointer transition-all"
                onClick={() =>
                  setSelectedExercise(
                    selectedExercise === exercise ? null : exercise
                  )
                }
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-white">{exercise}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-2xl font-bold text-primary font-data">
                        {displayValue.toFixed(1)} {unit}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {recs.length} PR{recs.length > 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </div>
                  <ChevronRight
                    className={`w-5 h-5 text-muted-foreground transition-transform ${
                      selectedExercise === exercise ? "rotate-90" : ""
                    }`}
                  />
                </div>

                {selectedExercise === exercise && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    className="mt-4 pt-4 border-t border-secondary space-y-2"
                  >
                    {recs.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-muted-foreground">
                          {r.achieved_at.toLocaleDateString()}
                        </span>
                        <span className="font-data text-white">
                          {convertWeight(r.value, "kg", unit).toFixed(1)} {unit}
                        </span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {timelineRecords.map((record, i) => {
            const displayValue = convertWeight(record.value, "kg", unit);
            return (
              <motion.div
                key={record.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <Card className="p-4 bg-surface-2 border-secondary">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-white">
                        {record.exercise_name}
                      </h3>
                      <span className="text-sm text-muted-foreground">
                        {record.achieved_at.toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xl font-bold text-primary font-data">
                        {displayValue.toFixed(1)} {unit}
                      </span>
                      <Badge className="ml-2" variant="outline">
                        {record.record_type}
                      </Badge>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/analytics/RecordsTab.tsx
git commit -m "feat: add RecordsTab component for Analytics

Personal records display with grouped and timeline views,
relocated from standalone PersonalRecords page.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 15: Update Analytics to Include Records Tab

**Files:**
- Modify: `src/app/components/Analytics.tsx`

- [ ] **Step 1: Add RecordsTab lazy import**

```tsx
const RecordsTab = lazy(
  () => import("@/app/components/analytics/RecordsTab")
);
const MobileRecordsTab = lazy(
  () => import("@/app/components/analytics/RecordsTab")
);
```

- [ ] **Step 2: Add Records tab to TabsList**

In both desktop and mobile TabsList, add:

```tsx
<TabsTrigger value="records">Records</TabsTrigger>
```

- [ ] **Step 3: Add Records TabsContent**

Add after the Performance tab content:

```tsx
<TabsContent value="records">
  <Suspense fallback={<AnalyticsTabSkeleton />}>
    <RecordsTab unit={unit} />
  </Suspense>
</TabsContent>
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/Analytics.tsx
git commit -m "feat: add Records tab to Analytics

Personal records now accessible as a tab within Analytics,
completing the relocation from standalone Leaderboard page.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 16: Update Routes and Navigation

**Files:**
- Modify: `src/app/routes/index.tsx`
- Modify: `src/app/components/AppSidebar.tsx`
- Modify: `src/app/components/MobileBottomNav.tsx`

- [ ] **Step 1: Update routes**

In `src/app/routes/index.tsx`:

Add Leaderboard lazy import:

```tsx
const Leaderboard = lazyWithReload(() =>
  import("@/app/components/Leaderboard").then((m) => ({
    default: m.Leaderboard,
  })),
);
```

Replace the PersonalRecords route:

```tsx
// Change from:
// <Route path="/records" element={<PersonalRecords />} />
// To:
<Route path="/leaderboard" element={<Leaderboard />} />
```

- [ ] **Step 2: Update AppSidebar**

In `src/app/components/AppSidebar.tsx`, update the Social group:

```tsx
{
  title: "Social",
  items: [
    { path: "/community", label: "Community", icon: Users },
    { path: "/challenges", label: "Challenges", icon: Trophy },
    { path: "/leaderboard", label: "Leaderboard", icon: Award },
  ],
},
```

- [ ] **Step 3: Update MobileBottomNav**

In `src/app/components/MobileBottomNav.tsx`, update:

```tsx
{
  title: "Social",
  items: [
    { path: "/challenges", label: "Challenges", icon: Trophy },
    { path: "/leaderboard", label: "Leaderboard", icon: Award },
  ],
},
```

- [ ] **Step 4: Delete PersonalRecords component**

```bash
rm src/app/components/PersonalRecords.tsx
rm src/app/components/__tests__/PersonalRecords.test.tsx
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: update routes for new Leaderboard

- Replace /records route with /leaderboard
- Update sidebar and mobile nav
- Remove standalone PersonalRecords (now in Analytics)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 17: Create Compute Rankings Edge Function

**Files:**
- Create: `supabase/functions/compute-rankings/index.ts`

- [ ] **Step 1: Create Edge Function with full implementation**

```typescript
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

// =============================================================================
// Types
// =============================================================================

interface RankingRequest {
  type: 'global' | 'weekly' | 'user';
  userId?: string;
  weekStart?: string;
}

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rank: number;
  value: number;
  percentile: number;
}

interface UserRanking {
  metric: string;
  rank: number;
  value: number;
  percentile: number;
  totalUsers: number;
}

interface GlobalLeaderboard {
  totalVolume: LeaderboardEntry[];
  workoutCount: LeaderboardEntry[];
  longestStreak: LeaderboardEntry[];
  currentStreak: LeaderboardEntry[];
  prCount: LeaderboardEntry[];
  exerciseMastery: LeaderboardEntry[];
}

interface WeeklyCompetition {
  id: string;
  metric: string;
  metricLabel: string;
  startDate: string;
  endDate: string;
  entries: LeaderboardEntry[];
  isSpecialEvent: boolean;
  eventName?: string;
}

// Weekly metric rotation (cycles through based on week number)
const WEEKLY_METRICS = [
  { metric: 'volume', label: 'Total Volume' },
  { metric: 'workouts', label: 'Workout Count' },
  { metric: 'prs', label: 'PRs Set' },
  { metric: 'streak', label: 'Consistency' },
];

// =============================================================================
// Helper Functions
// =============================================================================

function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - startOfYear.getTime();
  return Math.ceil((diff / (7 * 24 * 60 * 60 * 1000)) + 1);
}

function getWeekBounds(weekStart?: string): { start: Date; end: Date } {
  let start: Date;
  if (weekStart) {
    start = new Date(weekStart);
  } else {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    start = new Date(now.getFullYear(), now.getMonth(), diff);
  }
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
}

function computePercentile(rank: number, total: number): number {
  if (total === 0) return 0;
  return Math.round(((total - rank + 1) / total) * 100);
}

function toEntries(
  rows: Array<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    value: number;
  }>,
  limit = 50
): LeaderboardEntry[] {
  const total = rows.length;
  return rows.slice(0, limit).map((row, i) => ({
    userId: row.user_id,
    displayName: row.display_name || 'Anonymous',
    avatarUrl: row.avatar_url,
    rank: i + 1,
    value: row.value,
    percentile: computePercentile(i + 1, total),
  }));
}

// =============================================================================
// Global Rankings Queries
// =============================================================================

async function getGlobalRankings(
  supabase: ReturnType<typeof createClient>
): Promise<GlobalLeaderboard> {
  // Query gamification_stats joined with profiles for opted-in users
  // Using raw SQL for efficient ranking queries
  
  // Total Volume ranking
  const { data: volumeData } = await supabase
    .from('gamification_stats')
    .select(`
      user_id,
      total_volume_kg,
      profiles!inner(display_name, avatar_url, leaderboard_participation)
    `)
    .eq('profiles.leaderboard_participation', true)
    .order('total_volume_kg', { ascending: false })
    .limit(100);

  const totalVolume = toEntries(
    (volumeData ?? []).map((r) => ({
      user_id: r.user_id,
      display_name: r.profiles?.display_name ?? null,
      avatar_url: r.profiles?.avatar_url ?? null,
      value: r.total_volume_kg,
    }))
  );

  // Workout Count ranking
  const { data: workoutData } = await supabase
    .from('gamification_stats')
    .select(`
      user_id,
      total_workouts,
      profiles!inner(display_name, avatar_url, leaderboard_participation)
    `)
    .eq('profiles.leaderboard_participation', true)
    .order('total_workouts', { ascending: false })
    .limit(100);

  const workoutCount = toEntries(
    (workoutData ?? []).map((r) => ({
      user_id: r.user_id,
      display_name: r.profiles?.display_name ?? null,
      avatar_url: r.profiles?.avatar_url ?? null,
      value: r.total_workouts,
    }))
  );

  // Longest Streak ranking
  const { data: longestStreakData } = await supabase
    .from('gamification_stats')
    .select(`
      user_id,
      longest_streak,
      profiles!inner(display_name, avatar_url, leaderboard_participation)
    `)
    .eq('profiles.leaderboard_participation', true)
    .order('longest_streak', { ascending: false })
    .limit(100);

  const longestStreak = toEntries(
    (longestStreakData ?? []).map((r) => ({
      user_id: r.user_id,
      display_name: r.profiles?.display_name ?? null,
      avatar_url: r.profiles?.avatar_url ?? null,
      value: r.longest_streak,
    }))
  );

  // Current Streak ranking
  const { data: currentStreakData } = await supabase
    .from('gamification_stats')
    .select(`
      user_id,
      current_streak,
      profiles!inner(display_name, avatar_url, leaderboard_participation)
    `)
    .eq('profiles.leaderboard_participation', true)
    .order('current_streak', { ascending: false })
    .limit(100);

  const currentStreak = toEntries(
    (currentStreakData ?? []).map((r) => ({
      user_id: r.user_id,
      display_name: r.profiles?.display_name ?? null,
      avatar_url: r.profiles?.avatar_url ?? null,
      value: r.current_streak,
    }))
  );

  // PR Count ranking - count from personal_records table
  const { data: prCountData } = await supabase.rpc('get_pr_count_rankings', {
    result_limit: 100,
  });

  const prCount = toEntries(
    (prCountData ?? []).map((r: { user_id: string; display_name: string | null; avatar_url: string | null; pr_count: number }) => ({
      user_id: r.user_id,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      value: r.pr_count,
    }))
  );

  // Exercise Mastery - count exercises with 10+ sessions
  const { data: masteryData } = await supabase.rpc('get_exercise_mastery_rankings', {
    result_limit: 100,
  });

  const exerciseMastery = toEntries(
    (masteryData ?? []).map((r: { user_id: string; display_name: string | null; avatar_url: string | null; mastery_count: number }) => ({
      user_id: r.user_id,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      value: r.mastery_count,
    }))
  );

  return {
    totalVolume,
    workoutCount,
    longestStreak,
    currentStreak,
    prCount,
    exerciseMastery,
  };
}

// =============================================================================
// Weekly Competition Query
// =============================================================================

async function getWeeklyCompetition(
  supabase: ReturnType<typeof createClient>,
  weekStart?: string
): Promise<WeeklyCompetition> {
  const { start, end } = getWeekBounds(weekStart);
  const weekNum = getWeekNumber(start);
  const metricConfig = WEEKLY_METRICS[weekNum % WEEKLY_METRICS.length];

  // Check for special event override
  const { data: specialEvent } = await supabase
    .from('leaderboard_events')
    .select('*')
    .lte('start_date', end.toISOString())
    .gte('end_date', start.toISOString())
    .eq('is_active', true)
    .single();

  const isSpecialEvent = !!specialEvent;
  const metric = specialEvent?.metric ?? metricConfig.metric;
  const metricLabel = specialEvent?.name ?? metricConfig.label;

  let entries: LeaderboardEntry[] = [];

  // Query based on metric type
  if (metric === 'volume') {
    const { data } = await supabase
      .from('workout_sessions')
      .select(`
        user_id,
        total_volume,
        profiles!inner(display_name, avatar_url, leaderboard_participation)
      `)
      .eq('profiles.leaderboard_participation', true)
      .gte('started_at', start.toISOString())
      .lte('started_at', end.toISOString());

    // Aggregate by user
    const byUser = new Map<string, { volume: number; display_name: string | null; avatar_url: string | null }>();
    for (const row of data ?? []) {
      const existing = byUser.get(row.user_id);
      if (existing) {
        existing.volume += row.total_volume;
      } else {
        byUser.set(row.user_id, {
          volume: row.total_volume,
          display_name: row.profiles?.display_name ?? null,
          avatar_url: row.profiles?.avatar_url ?? null,
        });
      }
    }

    const sorted = Array.from(byUser.entries())
      .map(([userId, data]) => ({
        user_id: userId,
        display_name: data.display_name,
        avatar_url: data.avatar_url,
        value: data.volume,
      }))
      .sort((a, b) => b.value - a.value);

    entries = toEntries(sorted);
  } else if (metric === 'workouts') {
    const { data } = await supabase
      .from('workout_sessions')
      .select(`
        user_id,
        profiles!inner(display_name, avatar_url, leaderboard_participation)
      `)
      .eq('profiles.leaderboard_participation', true)
      .gte('started_at', start.toISOString())
      .lte('started_at', end.toISOString());

    // Count by user
    const byUser = new Map<string, { count: number; display_name: string | null; avatar_url: string | null }>();
    for (const row of data ?? []) {
      const existing = byUser.get(row.user_id);
      if (existing) {
        existing.count += 1;
      } else {
        byUser.set(row.user_id, {
          count: 1,
          display_name: row.profiles?.display_name ?? null,
          avatar_url: row.profiles?.avatar_url ?? null,
        });
      }
    }

    const sorted = Array.from(byUser.entries())
      .map(([userId, data]) => ({
        user_id: userId,
        display_name: data.display_name,
        avatar_url: data.avatar_url,
        value: data.count,
      }))
      .sort((a, b) => b.value - a.value);

    entries = toEntries(sorted);
  } else if (metric === 'prs') {
    const { data } = await supabase
      .from('personal_records')
      .select(`
        user_id,
        profiles!inner(display_name, avatar_url, leaderboard_participation)
      `)
      .eq('profiles.leaderboard_participation', true)
      .gte('achieved_at', start.toISOString())
      .lte('achieved_at', end.toISOString());

    // Count by user
    const byUser = new Map<string, { count: number; display_name: string | null; avatar_url: string | null }>();
    for (const row of data ?? []) {
      const existing = byUser.get(row.user_id);
      if (existing) {
        existing.count += 1;
      } else {
        byUser.set(row.user_id, {
          count: 1,
          display_name: row.profiles?.display_name ?? null,
          avatar_url: row.profiles?.avatar_url ?? null,
        });
      }
    }

    const sorted = Array.from(byUser.entries())
      .map(([userId, data]) => ({
        user_id: userId,
        display_name: data.display_name,
        avatar_url: data.avatar_url,
        value: data.count,
      }))
      .sort((a, b) => b.value - a.value);

    entries = toEntries(sorted);
  }

  return {
    id: `week-${start.toISOString().split('T')[0]}`,
    metric,
    metricLabel,
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
    entries,
    isSpecialEvent,
    eventName: specialEvent?.name,
  };
}

// =============================================================================
// User Rankings Query
// =============================================================================

async function getUserRankings(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<UserRanking[]> {
  const rankings: UserRanking[] = [];

  // Get user's stats
  const { data: userStats } = await supabase
    .from('gamification_stats')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!userStats) {
    return rankings;
  }

  // Get total users who participate in leaderboard
  const { count: totalUsers } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('leaderboard_participation', true);

  const total = totalUsers ?? 0;

  // Total Volume rank
  const { count: volumeRank } = await supabase
    .from('gamification_stats')
    .select('*', { count: 'exact', head: true })
    .gt('total_volume_kg', userStats.total_volume_kg);

  rankings.push({
    metric: 'totalVolume',
    rank: (volumeRank ?? 0) + 1,
    value: userStats.total_volume_kg,
    percentile: computePercentile((volumeRank ?? 0) + 1, total),
    totalUsers: total,
  });

  // Workout Count rank
  const { count: workoutRank } = await supabase
    .from('gamification_stats')
    .select('*', { count: 'exact', head: true })
    .gt('total_workouts', userStats.total_workouts);

  rankings.push({
    metric: 'workoutCount',
    rank: (workoutRank ?? 0) + 1,
    value: userStats.total_workouts,
    percentile: computePercentile((workoutRank ?? 0) + 1, total),
    totalUsers: total,
  });

  // Longest Streak rank
  const { count: longestStreakRank } = await supabase
    .from('gamification_stats')
    .select('*', { count: 'exact', head: true })
    .gt('longest_streak', userStats.longest_streak);

  rankings.push({
    metric: 'longestStreak',
    rank: (longestStreakRank ?? 0) + 1,
    value: userStats.longest_streak,
    percentile: computePercentile((longestStreakRank ?? 0) + 1, total),
    totalUsers: total,
  });

  // Current Streak rank
  const { count: currentStreakRank } = await supabase
    .from('gamification_stats')
    .select('*', { count: 'exact', head: true })
    .gt('current_streak', userStats.current_streak);

  rankings.push({
    metric: 'currentStreak',
    rank: (currentStreakRank ?? 0) + 1,
    value: userStats.current_streak,
    percentile: computePercentile((currentStreakRank ?? 0) + 1, total),
    totalUsers: total,
  });

  // PR Count rank
  const { count: userPrCount } = await supabase
    .from('personal_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { data: prRankData } = await supabase.rpc('get_user_pr_rank', {
    target_user_id: userId,
  });

  rankings.push({
    metric: 'prCount',
    rank: prRankData?.rank ?? 0,
    value: userPrCount ?? 0,
    percentile: computePercentile(prRankData?.rank ?? 0, total),
    totalUsers: total,
  });

  return rankings;
}

// =============================================================================
// Main Handler
// =============================================================================

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { type, userId, weekStart } = (await req.json()) as RankingRequest;

    if (type === 'global') {
      const data = await getGlobalRankings(supabase);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'weekly') {
      const data = await getWeeklyCompetition(supabase, weekStart);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'user' && userId) {
      const data = await getUserRankings(supabase, userId);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid request type' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[compute-rankings] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
```

- [ ] **Step 2: Create database functions for complex queries**

Create SQL migration for helper functions:

```sql
-- migrations/20260412_leaderboard_functions.sql

-- Get PR count rankings with profile info
CREATE OR REPLACE FUNCTION get_pr_count_rankings(result_limit int DEFAULT 100)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  pr_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pr.user_id,
    p.display_name,
    p.avatar_url,
    COUNT(pr.id) as pr_count
  FROM personal_records pr
  JOIN profiles p ON pr.user_id = p.id
  WHERE p.leaderboard_participation = true
  GROUP BY pr.user_id, p.display_name, p.avatar_url
  ORDER BY pr_count DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get exercise mastery rankings (exercises with 10+ sessions)
CREATE OR REPLACE FUNCTION get_exercise_mastery_rankings(result_limit int DEFAULT 100)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  mastery_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ex.user_id,
    p.display_name,
    p.avatar_url,
    COUNT(DISTINCT ex.exercise_name) as mastery_count
  FROM (
    SELECT 
      e.user_id,
      e.name as exercise_name,
      COUNT(*) as session_count
    FROM workout_exercises e
    JOIN workout_sessions ws ON e.session_id = ws.id
    GROUP BY e.user_id, e.name
    HAVING COUNT(*) >= 10
  ) ex
  JOIN profiles p ON ex.user_id = p.id
  WHERE p.leaderboard_participation = true
  GROUP BY ex.user_id, p.display_name, p.avatar_url
  ORDER BY mastery_count DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get user's PR rank
CREATE OR REPLACE FUNCTION get_user_pr_rank(target_user_id uuid)
RETURNS TABLE (rank bigint) AS $$
BEGIN
  RETURN QUERY
  WITH pr_counts AS (
    SELECT 
      pr.user_id,
      COUNT(*) as pr_count
    FROM personal_records pr
    JOIN profiles p ON pr.user_id = p.id
    WHERE p.leaderboard_participation = true
    GROUP BY pr.user_id
  ),
  ranked AS (
    SELECT 
      user_id,
      pr_count,
      RANK() OVER (ORDER BY pr_count DESC) as rank
    FROM pr_counts
  )
  SELECT ranked.rank
  FROM ranked
  WHERE ranked.user_id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create leaderboard_events table for special events
CREATE TABLE IF NOT EXISTS leaderboard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  metric text NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- RLS for leaderboard_events (read-only for authenticated users)
ALTER TABLE leaderboard_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active events"
  ON leaderboard_events FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage events"
  ON leaderboard_events FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');
```

- [ ] **Step 3: Run migration**

```bash
cd phoenix-portal
npx supabase db push
```

Expected: Migration applies successfully.

- [ ] **Step 4: Run typecheck on portal**

```bash
npm run typecheck
```

Expected: No errors (Edge Function is Deno, not checked by portal's tsc).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/compute-rankings/index.ts
git add supabase/migrations/20260412_leaderboard_functions.sql
git commit -m "feat: add compute-rankings Edge Function

Full implementation with:
- Global rankings from gamification_stats (volume, workouts, streaks)
- PR count and exercise mastery via database functions
- Weekly competitions with rotating metrics
- Special event support via leaderboard_events table
- User-specific ranking queries
- Leaderboard opt-out filtering via profiles.leaderboard_participation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 18: Add Profile Leaderboard Opt-Out

**Files:**
- Modify: `src/app/components/Profile.tsx`

- [ ] **Step 1: Add leaderboard opt-out toggle**

Add a new setting in the privacy section of Profile.tsx:

```tsx
<div className="flex items-center justify-between py-4 border-b border-secondary">
  <div>
    <h4 className="text-sm font-medium text-white">
      Appear on Leaderboards
    </h4>
    <p className="text-sm text-muted-foreground">
      Show your stats in community rankings
    </p>
  </div>
  <Switch
    checked={profile?.leaderboard_opt_in ?? true}
    onCheckedChange={(checked) => {
      updateProfile.mutate({ leaderboard_opt_in: checked });
    }}
    disabled={updateProfile.isPending}
  />
</div>
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: May need to add `leaderboard_opt_in` to profile types.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/Profile.tsx
git commit -m "feat: add leaderboard opt-out toggle to Profile

Users can hide themselves from community rankings while
still viewing leaderboards.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 19: Final Integration Test

**Files:**
- Test: All modified files

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No type errors.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test**

Start dev server and verify:
- Celebrations don't appear
- Cycles show "Active on mobile" badge, no progress bar
- Routines have delete option in menu
- Cycles have delete option in menu
- Workouts shows list-first with calendar widget in sidebar
- Leaderboard shows rankings UI (empty data OK)
- Analytics has Records tab
- Profile has leaderboard opt-out

```bash
npm run dev
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: integration verification complete

All portal UX redesign features implemented and verified:
- Celebration popups removed
- Cycle activation UI removed (read-only badge)
- Delete functionality for routines and cycles
- Workouts tab redesigned with list-first layout
- Leaderboard with competitive rankings
- Personal records moved to Analytics

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Remove celebration popups | 7 deleted, 3 modified |
| 2 | Remove cycle activation UI | 1 modified |
| 3 | Create DeleteConfirmDialog | 1 created |
| 4 | Add useDeleteRoutine mutation | 1 modified |
| 5 | Add delete to Routines UI | 1 modified |
| 6 | Add useDeleteCycle mutation | 1 modified |
| 7 | Add delete to Cycles UI | 1 modified |
| 8 | Create CalendarWidget | 1 created |
| 9 | Create WorkoutQuickStats | 1 created |
| 10 | Refactor WorkoutHistory | 1 modified |
| 11 | Add leaderboard query keys | 1 modified |
| 12 | Create leaderboard queries | 1 created |
| 13 | Create Leaderboard page | 1 created |
| 14 | Create RecordsTab | 1 created |
| 15 | Update Analytics with Records | 1 modified |
| 16 | Update routes and navigation | 5 modified, 2 deleted |
| 17 | Create rankings Edge Function stub | 1 created |
| 18 | Add profile opt-out | 1 modified |
| 19 | Final integration test | N/A |
