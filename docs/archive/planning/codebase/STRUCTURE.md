# Codebase Structure

**Analysis Date:** 2026-02-15

## Directory Layout

```
phoenix-portal/
├── src/
│   ├── main.tsx                    # React root entry point
│   ├── app/
│   │   ├── App.tsx                 # Root component: state, navigation, routing
│   │   ├── components/
│   │   │   ├── [FeatureName].tsx   # Feature pages (Dashboard, Analytics, etc.)
│   │   │   ├── [Feature]Mobile.tsx # Mobile variants
│   │   │   ├── Navigation.tsx       # Desktop navigation sidebar
│   │   │   ├── MobileBottomNav.tsx # Mobile bottom tab navigation
│   │   │   ├── LandingPage.tsx     # Onboarding/login screen
│   │   │   ├── ui/                 # 40+ Radix UI primitive wrappers
│   │   │   ├── routine-builder/    # Routine creation subcomponents
│   │   │   ├── cycle-builder/      # Training cycle subcomponents
│   │   │   ├── celebrations/       # Achievement animations
│   │   │   ├── mobile/             # Mobile-specific feature pages
│   │   │   ├── modals/             # Modal dialogs
│   │   │   └── figma/              # Figma integration utilities
│   │   └── hooks/
│   │       └── useIsMobile.ts      # 768px mobile breakpoint detection
│   ├── styles/
│   │   ├── index.css               # Master stylesheet imports
│   │   ├── theme.css               # Phoenix color palette, custom animations
│   │   ├── tailwind.css            # Tailwind directives
│   │   └── fonts.css               # Font imports
│   └── assets/
│       └── [image-files].png       # Static images
├── index.html                      # HTML entry with <div id="root">
├── vite.config.ts                  # Vite config: @ alias, plugins
├── tsconfig.json                   # TypeScript configuration
├── postcss.config.mjs              # PostCSS config
├── package.json                    # Dependencies, build scripts
└── node_modules/                   # Dependencies (not committed)
```

## Directory Purposes

**src/:**
- Purpose: All TypeScript/React source code
- Contains: Application code, styles, assets
- Key files: `main.tsx` (entry), `app/App.tsx` (root component)

**src/app/:**
- Purpose: Application-specific code
- Contains: Root component, feature components, hooks
- Key files: `App.tsx` (state/routing center)

**src/app/components/:**
- Purpose: All React components (features, builders, UI)
- Contains: 27 top-level .tsx files + 71 nested subcomponents
- Key files: Dashboard, Navigation, LandingPage

**src/app/components/ui/:**
- Purpose: Radix UI primitive wrappers with Phoenix theming
- Contains: 40+ unstyled component exports (accordion, avatar, badge, button, card, checkbox, dialog, dropdown, label, progress, select, tabs, tooltip, etc.)
- Key files: `button.tsx`, `card.tsx`, `dialog.tsx` (most used)

**src/app/components/routine-builder/:**
- Purpose: Exercise selection, grouping, superset management for routine creation
- Contains: ExerciseCard.tsx, SupersetContainer.tsx, SupersetComponents.tsx, SelectionModeBar.tsx, helper/type files
- Key files: `superset-types.ts` (domain model), `SupersetContainer.tsx` (main composition)

**src/app/components/cycle-builder/:**
- Purpose: Multi-week training plan design with progression and day assignment
- Contains: CycleOverview.tsx, DayEditor.tsx, DayCard.tsx, DaySchedule.tsx, ProgressionRules.tsx, RoutinePicker.tsx, WeekOverview.tsx
- Key files: `DayEditor.tsx` (main editing interface), `ProgressionRules.tsx` (progression configuration)

**src/app/components/celebrations/:**
- Purpose: Achievement unlocks and milestone animations
- Contains: WorkoutComplete.tsx, StreakMilestone.tsx, PRCelebration.tsx, BadgeEarned.tsx, ChallengeWon.tsx
- Key files: `ChallengeWon.tsx` (complex animation with Podium, Confetti, Spotlight subcomponents)

**src/app/components/celebrations/challenge-won/:**
- Purpose: Subcomponents for ChallengeWon celebration
- Contains: Podium.tsx, Spotlight.tsx, ConfettiEffect.tsx, RewardsCard.tsx, types.ts

**src/app/components/mobile/:**
- Purpose: Mobile-optimized feature pages
- Contains: AnalyticsMobile.tsx, ChallengesMobile.tsx, CommunityMobile.tsx
- Key files: Responsive alternatives to desktop feature pages

**src/app/components/modals/:**
- Purpose: Dialog and modal components
- Contains: RoutinePickerModal.tsx

**src/app/components/figma/:**
- Purpose: Figma integration utilities
- Contains: ImageWithFallback.tsx (image loading with fallback)

**src/app/hooks/:**
- Purpose: React hooks for shared component logic
- Contains: useIsMobile.ts (mobile detection hook)
- Key files: `useIsMobile.ts` (768px breakpoint, resize listener)

**src/styles/:**
- Purpose: Global styling and design system
- Contains: CSS custom properties, animations, typography
- Key files: `theme.css` (Phoenix color palette, custom animations), `index.css` (imports master)

**src/assets/:**
- Purpose: Static assets (images, icons, etc.)
- Contains: PNG images and other media
- Key files: `4aa483a986255912b80c24338a4e7f563d95eabd.png` (Figma image)

## Key File Locations

**Entry Points:**
- `src/main.tsx`: React DOM render, creates root and mounts App.tsx
- `src/app/App.tsx`: Root component managing all navigation state and page routing
- `index.html`: HTML shell with `<div id="root">` mount point

**Configuration:**
- `vite.config.ts`: Vite build config, @ alias to `./src`, React and Tailwind plugins
- `tsconfig.json`: TypeScript compiler settings
- `postcss.config.mjs`: PostCSS configuration
- `package.json`: Dependencies (React 18, Vite 6, Tailwind v4, shadcn/ui, Recharts, Framer Motion)

**Core Logic:**
- `src/app/App.tsx`: Page routing state, authentication flag, modal/detail visibility
- `src/app/components/Navigation.tsx`: Desktop navigation with icon buttons and active tab indicator
- `src/app/components/MobileBottomNav.tsx`: Mobile tab bar with 5 primary pages
- `src/app/hooks/useIsMobile.ts`: Responsive breakpoint detection

**Feature Pages:**
- `src/app/components/Dashboard.tsx`: Welcome, activity charts, badges, recent PRs
- `src/app/components/Analytics.tsx`: Workout statistics and trends
- `src/app/components/Challenges.tsx`: Competitive challenges with leaderboards
- `src/app/components/Community.tsx`: Social features, feed
- `src/app/components/Profile.tsx`: User settings and achievements
- `src/app/components/PersonalRecords.tsx`: Best lifts by exercise
- `src/app/components/WorkoutHistory.tsx`: List of past workouts
- `src/app/components/SessionDetail.tsx`: Single workout breakdown
- `src/app/components/RoutinesEnhanced.tsx`: Routine list with create/edit
- `src/app/components/TrainingCycles.tsx`: Training plan list

**Builders:**
- `src/app/components/RoutineBuilder.tsx`: Main routine creation orchestrator
- `src/app/components/RoutineBuilderEnhanced.tsx`: Alternative routine builder
- `src/app/components/CycleBuilderMain.tsx`: Main training cycle orchestrator
- `src/app/components/CycleBuilder.tsx`: Alternative cycle builder

**Testing:**
- No test files present (no Jest, Vitest, or other test framework configured)

## Naming Conventions

**Files:**

- **Feature components:** PascalCase, descriptive name: `Dashboard.tsx`, `Analytics.tsx`, `PersonalRecords.tsx`
- **Mobile variants:** `[Feature]Mobile.tsx` suffix: `DashboardMobile.tsx`, `AnalyticsMobile.tsx`
- **Subcomponents:** Nested in feature folder with PascalCase: `routine-builder/SupersetContainer.tsx`
- **UI primitives:** Lowercase, component name: `button.tsx`, `card.tsx`, `dialog.tsx`
- **Types/helpers:** Lowercase with dashes: `superset-types.ts`, `superset-helpers.ts`
- **Styles:** Lowercase: `theme.css`, `index.css`, `fonts.css`

**Directories:**

- **Features:** Standalone components named by feature: `components/Dashboard.tsx`, not in subfolder
- **Feature groups:** Kebab-case for multi-component features: `routine-builder/`, `cycle-builder/`, `celebrations/`
- **Config:** Root level with lowercase: `vite.config.ts`, `postcss.config.mjs`

**Components:**

- **Exported:** Named exports with PascalCase: `export function Dashboard() { ... }`
- **Props interfaces:** `[ComponentName]Props` format: `NavigationProps`, `DashboardProps`
- **State variables:** camelCase: `currentPage`, `selectedSessionId`, `showRoutineBuilder`
- **Event handlers:** `handle[Action]` pattern: `handleNavigate()`, `handleViewSession()`, `handleSaveRoutine()`
- **Callbacks in props:** `on[Action]` pattern: `onNavigate`, `onViewSession`, `onBack`

## Where to Add New Code

**New Feature Page:**
1. Create component file: `src/app/components/[FeatureName].tsx`
2. Export named function: `export function [FeatureName]() { ... }`
3. Add to App.tsx imports and conditional render
4. Add to Navigation.tsx navItems array (desktop)
5. Add to MobileBottomNav.tsx if primary feature
6. Create mobile variant if needed: `src/app/components/mobile/[FeatureName]Mobile.tsx`
7. Tests (when test framework added): `src/app/components/[FeatureName].test.tsx`

**New Sub-builder Component:**
1. Create in appropriate builder subfolder: `src/app/components/routine-builder/[ComponentName].tsx`
2. Define props interface in component file
3. Export as named function
4. Import into main builder (RoutineBuilder.tsx or CycleBuilderMain.tsx)
5. Pass state and callbacks from parent builder

**New Utility Function:**
1. If domain-specific (superset logic): Add to `src/app/components/[feature-builder]/[name]-helpers.ts`
2. If general use: Create `src/app/utils/[name].ts` (directory doesn't exist yet - create if adding many utilities)
3. Export as named function, import where needed

**New Custom Hook:**
1. Create in `src/app/hooks/use[HookName].ts`
2. Use React hooks (useState, useEffect, useRef, etc.)
3. Return value or object of values
4. Import in components with: `import { use[HookName] } from '@/app/hooks/use[HookName]'`

**New UI Component:**
1. Create in `src/app/components/ui/[component-name].tsx`
2. Wrap Radix UI primitive or custom implementation
3. Apply Tailwind classes with cn() utility
4. Export as default or named function
5. Example pattern from existing: See `src/app/components/ui/button.tsx`

**New Styling/Theme:**
1. Add CSS variables to `:root` in `src/styles/theme.css`
2. Add to `@theme inline` block for Tailwind v4
3. Use via `var(--custom-var)` or Tailwind class name
4. Phoenix colors are defined; use hex values from there

**New Asset:**
1. Place PNG/SVG/media in `src/assets/`
2. Import: `import imageName from '@/assets/filename.png'`
3. Use in JSX: `<img src={imageName} alt="..." />`

## Special Directories

**node_modules/:**
- Purpose: NPM dependencies
- Generated: Yes (by npm install)
- Committed: No (in .gitignore)
- Contains: React, Vite, Tailwind, Radix UI, Recharts, Framer Motion, and 70+ other packages

**dist/:**
- Purpose: Production build output
- Generated: Yes (by `npm run build`)
- Committed: No (in .gitignore)
- Contains: Bundled JS, CSS, HTML, optimized for deployment

**.git/:**
- Purpose: Git repository metadata
- Generated: Yes (by git init)
- Committed: No (system directory)
- Contains: Commit history, branches

---

*Structure analysis: 2026-02-15*
