# Architecture

**Analysis Date:** 2026-02-15

## Pattern Overview

**Overall:** Single-Page Application (SPA) with client-side state management

**Key Characteristics:**
- Component-driven React architecture with TSX
- Props drilling for state management (no Redux, Context, or Zustand)
- All UI state and navigation logic centralized in root component
- Feature components are mostly self-contained with internal state
- Dark-themed design system with Phoenix branding colors
- Mock data embedded in components (no API integration yet)

## Layers

**Presentation Layer:**
- Purpose: Render UI and handle user interactions
- Location: `src/app/components/`
- Contains: React functional components (.tsx files), UI primitives from shadcn/ui
- Depends on: Lucide icons, Framer Motion for animations, Recharts for data visualization
- Used by: Root App component

**Navigation & Layout Layer:**
- Purpose: Manage page routing and overall layout structure
- Location: `src/app/App.tsx` (root), `src/app/components/Navigation.tsx`, `src/app/components/MobileBottomNav.tsx`
- Contains: State management for current page, authentication, modal/detail views
- Depends on: All feature components
- Used by: Main rendering in App.tsx

**UI Primitives Layer:**
- Purpose: Provide reusable, unstyled button, card, dialog, input components
- Location: `src/app/components/ui/`
- Contains: 40+ Radix UI primitive wrappers (accordion, avatar, button, card, checkbox, dialog, dropdown, label, progress, select, tabs, tooltip, etc.)
- Depends on: @radix-ui/* packages, tailwindcss, clsx
- Used by: Feature components and builders

**Feature Components Layer:**
- Purpose: Implement specific features (Dashboard, Analytics, Challenges, etc.)
- Location: `src/app/components/[FeatureName].tsx`
- Contains: Dashboard, Analytics, Challenges, Community, Profile, Routines, TrainingCycles, PersonalRecords, WorkoutHistory, SessionDetail
- Depends on: UI primitives, icons, charts, animations
- Used by: Navigation layer for page rendering

**Builder Subcomponent Layer:**
- Purpose: Complex multi-step forms and specialized editors
- Location: `src/app/components/routine-builder/`, `src/app/components/cycle-builder/`
- Contains: Routine builder (exercise cards, superset management), Cycle builder (day/week/progression editors)
- Depends on: UI primitives, drag-and-drop (@dnd-kit), types
- Used by: RoutineBuilder.tsx, CycleBuilderMain.tsx

**Celebration/Animation Layer:**
- Purpose: Special effects and achievement animations
- Location: `src/app/components/celebrations/`
- Contains: WorkoutComplete, StreakMilestone, PRCelebration, ChallengeWon, BadgeEarned
- Depends on: Framer Motion, Recharts, custom components (Confetti, Podium, Spotlight)
- Used by: Demo page, future workout completion flows

**Mobile Responsive Layer:**
- Purpose: Mobile-specific implementations
- Location: `src/app/components/mobile/`, mobile variants with `Mobile` suffix
- Contains: AnalyticsMobile.tsx, ChallengesMobile.tsx, CommunityMobile.tsx, DashboardMobile.tsx
- Depends on: useIsMobile hook, UI primitives
- Used by: Feature components for responsive rendering

**Styling Layer:**
- Purpose: Design tokens, colors, animations, typography
- Location: `src/styles/theme.css` (primary), `src/styles/index.css` (imports), `src/styles/tailwind.css`
- Contains: CSS custom properties for Phoenix color palette, custom animations (flame-flicker, ember-rise, phoenix-glow)
- Depends on: Tailwind CSS v4
- Used by: All components via utility classes and @apply

**Utility & Hooks Layer:**
- Purpose: Reusable logic and helpers
- Location: `src/app/hooks/`
- Contains: useIsMobile.ts (mobile detection at 768px breakpoint)
- Depends on: React hooks (useState, useEffect)
- Used by: Feature components for responsive behavior

## Data Flow

**Authentication Flow:**

1. App mounts in unauthenticated state (`isAuthenticated: false`)
2. LandingPage rendered with "Get Started" button
3. User clicks → `handleGetStarted()` sets `isAuthenticated: true`
4. Dashboard becomes default page
5. Navigation/MobileBottomNav available for page transitions
6. LandingPage no longer rendered

**Page Navigation Flow:**

1. User clicks nav item (desktop Navigation or mobile MobileBottomNav)
2. `onNavigate(page)` callback triggers
3. `handleNavigate()` in App.tsx updates `currentPage` state
4. Detail state reset: `selectedSessionId`, `selectedRoutineId`, builder flags cleared
5. Conditional rendering in App.tsx shows new page component
6. Feature component renders with hardcoded mock data

**Detail View Flow (Session Detail):**

1. User on WorkoutHistory page clicks workout item
2. `onViewSession(sessionId)` callback triggered
3. `setSelectedSessionId(sessionId)` in App.tsx
4. App.tsx detects `currentPage === 'history' && selectedSessionId`
5. SessionDetail component renders instead of WorkoutHistory
6. User clicks back → `handleBackFromSession()` clears `selectedSessionId`
7. WorkoutHistory redisplayed

**Builder Flow (Routine Creation/Edit):**

1. User clicks "Create Routine" button or selects routine to edit
2. `handleCreateRoutine()` or `handleEditRoutine(id)` sets flags
3. `showRoutineBuilder: true` and `selectedRoutineId: id` (or null for new)
4. App.tsx renders RoutineBuilder instead of RoutinesEnhanced list
5. RoutineBuilder manages internal state for exercise selection, superset grouping
6. User saves → `handleSaveRoutine()` logs data, clears builder state
7. RoutinesEnhanced list redisplayed

**State Management:**

- Root state in App.tsx: `isAuthenticated`, `currentPage`, `showPrivacyPolicy`, `selectedSessionId`, `selectedRoutineId`, `showRoutineBuilder`, `showCycleBuilder`, `streak`, `isMobile`
- Feature state in components: Each feature component maintains own state for charts, tables, modal opens, form inputs
- No persistence: All data lost on page refresh (mock data only)
- No async: No API calls or async state management

## Key Abstractions

**Feature Component:**
- Purpose: Self-contained page with UI, mock data, and interactions
- Examples: `Dashboard.tsx`, `Analytics.tsx`, `Challenges.tsx`, `Community.tsx`, `Profile.tsx`
- Pattern: Functional component with useState for local state, Recharts for visualization, conditional rendering for sub-sections

**Builder Component:**
- Purpose: Multi-step editor with drag-and-drop and complex state
- Examples: `RoutineBuilder.tsx`, `CycleBuilderMain.tsx`
- Pattern: Wrapper component that coordinates subcomponents (ExerciseCard, SupersetContainer, DayEditor, ProgressionRules)

**Subcomponent:**
- Purpose: Recomposable pieces of builders and features
- Examples: `routine-builder/SupersetContainer.tsx`, `cycle-builder/DayEditor.tsx`
- Pattern: Accept data and callbacks via props, render specific domain

**UI Primitive:**
- Purpose: Styling wrapper around Radix UI component
- Examples: Button, Card, Dialog, Select, Tabs
- Pattern: Accept className and children, apply Phoenix theme via Tailwind, forward Radix props

**Custom Animation:**
- Purpose: Phoenix-themed visual effects
- Examples: Celebration components (ChallengeWon, PRCelebration, StreakMilestone)
- Pattern: Use Framer Motion `motion.div`, custom Recharts visualizations, CSS keyframes

## Entry Points

**Root Entry Point:**
- Location: `src/main.tsx`
- Triggers: DOM mount at `#root` element in `index.html`
- Responsibilities: Create React root, render App component, import global styles

**Application Root:**
- Location: `src/app/App.tsx`
- Triggers: Mounted by main.tsx
- Responsibilities: Manage all navigation state, authentication state, detail/modal visibility, render correct page based on `currentPage`, pass callbacks to child components

**Landing/Auth Entry:**
- Location: `src/app/components/LandingPage.tsx`
- Triggers: App.tsx when `isAuthenticated === false`
- Responsibilities: Show onboarding UI, call `onGetStarted()` callback to authenticate

**Feature Entry Points:**
- Dashboard → `src/app/components/Dashboard.tsx`
- History → `src/app/components/WorkoutHistory.tsx` (or SessionDetail if `selectedSessionId` set)
- Analytics → `src/app/components/Analytics.tsx`
- Challenges → `src/app/components/Challenges.tsx`
- Community → `src/app/components/Community.tsx`
- Profile → `src/app/components/Profile.tsx`
- Routines → `src/app/components/RoutinesEnhanced.tsx` (or RoutineBuilder if building)
- Cycles → `src/app/components/TrainingCycles.tsx` (or CycleBuilderMain if building)
- Records → `src/app/components/PersonalRecords.tsx`

## Error Handling

**Strategy:** None currently implemented

**Patterns:**
- No try-catch blocks in components
- No error boundaries or fallback UI
- No user-facing error messages
- Mock data assumed always available
- Missing error handling for future API integration points

## Cross-Cutting Concerns

**Logging:**
- Console.log used for debugging (e.g., "Saving routine:" in handleSaveRoutine)
- No structured logging framework
- No performance metrics or analytics setup

**Validation:**
- Form validation in routine-builder: SetConfig requires reps and weight
- No centralized validation schema (no zod, yup, etc.)
- Superset helpers validate exercise grouping logic

**Authentication:**
- Simulated with boolean flag in App.tsx state
- No credential storage or session persistence
- No token/JWT handling
- LandingPage with "Get Started" button hardcoded to set authenticated

**Responsive Design:**
- 768px breakpoint for mobile detection (useIsMobile hook, App.tsx)
- Tailwind `md:` prefix for desktop-only elements
- Mobile bottom nav replaces desktop sidebar navigation
- Mobile feature variants: DashboardMobile, AnalyticsMobile, etc.

---

*Architecture analysis: 2026-02-15*
