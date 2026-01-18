# Phoenix Portal Companion Mode Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Phoenix Portal from a workout control interface to a pure analytics/community companion site that displays synced data without implying machine control.

**Architecture:** Remove or repurpose all "Start Workout" / "Play" action buttons across components. Replace workout-control language with view/analytics language. Clarify that the portal displays data synced from the mobile app, not controls the Vitruvian machine directly.

**Tech Stack:** React, TypeScript, Tailwind CSS, Framer Motion, shadcn/ui components

**Backend:** Railway (existing) - Community features, challenges, and routine marketplace are backend-supported

---

## Task 1: Dashboard - Remove "Start Workout" Button

**Files:**
- Modify: `src/app/components/Dashboard.tsx:114-145`

**Step 1: Read the current "Today's Workout" card implementation**

The current card shows a scheduled workout with a "Start Workout" button that implies machine control.

**Step 2: Replace "Start Workout" button with "View Routine"**

Change line 139-142 from:
```tsx
<Button className="w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0 shadow-lg shadow-[#FF6B35]/50">
  <Zap className="w-4 h-4 mr-2" />
  Start Workout
</Button>
```

To:
```tsx
<Button className="w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0 shadow-lg shadow-[#FF6B35]/50">
  <Eye className="w-4 h-4 mr-2" />
  View Routine Details
</Button>
```

**Step 3: Add Eye icon import**

Add `Eye` to the lucide-react imports at line 7-17.

**Step 4: Update card title for clarity**

Change "Today's Workout" (line 121) to "Scheduled Workout" to make it clear this is informational.

**Step 5: Verify the changes compile**

Run: `npm run build` or `npm run dev`
Expected: No TypeScript errors, component renders correctly

**Step 6: Commit**

```bash
git add src/app/components/Dashboard.tsx
git commit -m "refactor(Dashboard): replace Start Workout with View Routine Details

The portal is a companion analytics site, not a workout controller.
Changed button action to view-only and clarified card title."
```

---

## Task 2: RoutinesEnhanced - Replace "Start" with "View"

**Files:**
- Modify: `src/app/components/RoutinesEnhanced.tsx:316-320`

**Step 1: Read current routine card footer**

The footer has Edit and Start buttons. Start implies workout control.

**Step 2: Replace Start button with View button**

Change lines 315-320 from:
```tsx
<Button
  size="sm"
  className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
>
  <Play className="w-4 h-4 mr-1" />
  Start
</Button>
```

To:
```tsx
<Button
  size="sm"
  className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
>
  <Eye className="w-4 h-4 mr-1" />
  View
</Button>
```

**Step 3: Update imports**

Replace `Play` with `Eye` in the lucide-react imports (line 17), or add `Eye` if both are needed elsewhere.

**Step 4: Verify the changes compile**

Run: `npm run build` or `npm run dev`
Expected: No TypeScript errors

**Step 5: Commit**

```bash
git add src/app/components/RoutinesEnhanced.tsx
git commit -m "refactor(RoutinesEnhanced): replace Start button with View

Portal displays routine data, doesn't control workouts."
```

---

## Task 3: Community - Update Import/Start Program Buttons

**Files:**
- Modify: `src/app/components/Community.tsx:216-224, 320-321`

**Step 1: Update Featured Routines "Import" button**

Change lines 216-219 from:
```tsx
<Button className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
  <Download className="w-4 h-4 mr-2" />
  Import
</Button>
```

To:
```tsx
<Button className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
  <Download className="w-4 h-4 mr-2" />
  Save to Library
</Button>
```

**Step 2: Update Training Cycles "Start Program" button**

Change lines 320-321 from:
```tsx
<Button className="w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
  <Download className="w-4 h-4 mr-2" />
  Start Program
</Button>
```

To:
```tsx
<Button className="w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
  <Download className="w-4 h-4 mr-2" />
  Import Program
</Button>
```

**Step 3: Verify the changes compile**

Run: `npm run build` or `npm run dev`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/app/components/Community.tsx
git commit -m "refactor(Community): clarify import actions don't start workouts

Changed button labels to indicate saving/importing rather than starting."
```

---

## Task 4: Challenges - Clarify Join Challenge Action

**Files:**
- Modify: `src/app/components/Challenges.tsx:388-390`

**Step 1: Update Join Challenge button text**

The button says "Join Challenge" which is fine, but we should add tooltip/context that this tracks your synced workouts.

Change lines 388-390:
```tsx
<Button className="w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
  Join Challenge
</Button>
```

To:
```tsx
<Button
  className="w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
  title="Join to track your synced workout progress against other athletes"
>
  Join Challenge
</Button>
```

**Step 2: Verify the changes compile**

Run: `npm run build` or `npm run dev`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/app/components/Challenges.tsx
git commit -m "refactor(Challenges): add tooltip clarifying challenge tracking

Explains that challenges track synced workout data."
```

---

## Task 5: Add Portal Context Banner Component

**Files:**
- Create: `src/app/components/PortalBanner.tsx`
- Modify: `src/app/components/Dashboard.tsx` (add import and usage)

**Step 1: Create the PortalBanner component**

Create `src/app/components/PortalBanner.tsx`:
```tsx
import { Info, X } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export function PortalBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="bg-gradient-to-r from-[#FF6B35]/10 to-[#F59E0B]/10 border border-[#FF6B35]/30 rounded-lg p-3 mb-6"
      >
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-[#FF6B35] flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-[#E5E7EB]">
              <span className="font-semibold text-[#FF6B35]">Phoenix Portal</span> displays
              workout data synced from your mobile app. Create and share routines that sync
              back to your Vitruvian trainer.
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-[#9CA3AF] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
```

**Step 2: Import and add to Dashboard**

In `Dashboard.tsx`, add import:
```tsx
import { PortalBanner } from './PortalBanner';
```

Add after the Welcome Header (around line 72):
```tsx
<PortalBanner />
```

**Step 3: Verify the changes compile**

Run: `npm run build` or `npm run dev`
Expected: No TypeScript errors, banner appears on Dashboard

**Step 4: Commit**

```bash
git add src/app/components/PortalBanner.tsx src/app/components/Dashboard.tsx
git commit -m "feat(PortalBanner): add context banner explaining portal purpose

Helps users understand the portal shows synced data and doesn't
control workouts directly."
```

---

## Task 6: Update SyncStatus Component for Clarity

**Files:**
- Modify: `src/app/components/SyncStatus.tsx` (if it exists, otherwise skip)

**Step 1: Check if SyncStatus exists and read it**

Look for the component referenced in Dashboard.tsx line 84.

**Step 2: Add sync direction indicator if not present**

Ensure the component shows:
- Last sync time (already present)
- Sync direction: "App → Portal"
- Sync status indicator

**Step 3: Verify the changes compile**

Run: `npm run build` or `npm run dev`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/app/components/SyncStatus.tsx
git commit -m "refactor(SyncStatus): clarify sync direction from app to portal"
```

---

## Task 7: Final Review and Cleanup

**Files:**
- Review: All modified files

**Step 1: Search for remaining "Start" buttons**

Run: `grep -rn "Start" src/app/components/*.tsx | grep -i button`

Ensure no workout-starting buttons remain.

**Step 2: Search for remaining "Play" icons used for control**

Run: `grep -rn "Play" src/app/components/*.tsx`

Verify Play icons are only used for video/media, not workout control.

**Step 3: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete portal companion mode refactor

All workout control buttons replaced with view/analytics actions.
Portal now clearly functions as a companion analytics site."
```

---

## Summary of Changes

| Component | Change |
|-----------|--------|
| Dashboard.tsx | "Start Workout" → "View Routine Details" |
| RoutinesEnhanced.tsx | "Start" → "View" |
| Community.tsx | "Import" → "Save to Library", "Start Program" → "Import Program" |
| Challenges.tsx | Added tooltip clarifying challenge tracking |
| PortalBanner.tsx | New component explaining portal purpose |
| SyncStatus.tsx | Clarified sync direction |

---

## Testing Checklist

- [ ] Dashboard renders without "Start Workout" button
- [ ] Routines page shows "View" instead of "Start"
- [ ] Community import buttons have clarified text
- [ ] Portal banner appears and can be dismissed
- [ ] No TypeScript/build errors
- [ ] Mobile views still work correctly
