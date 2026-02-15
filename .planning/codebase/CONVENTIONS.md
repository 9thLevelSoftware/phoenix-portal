# Coding Conventions

**Analysis Date:** 2026-02-15

## Naming Patterns

**Files:**
- PascalCase for React components: `Dashboard.tsx`, `LandingPage.tsx`, `RoutineBuilder.tsx`
- kebab-case for feature directories: `cycle-builder/`, `routine-builder/`, `challenge-won/`
- camelCase for utilities and hooks: `useIsMobile.ts`, `utils.ts`
- lowercase for regular TypeScript files: `types.ts`

**Functions:**
- camelCase for arrow functions and regular functions
- PascalCase for React component functions and named exports
- Handler functions prefixed with verb: `handleNavigate`, `handleViewSession`, `handleSaveRoutine`, `handleBackFromPrivacy`
- Utility functions describe their action: `checkMobile`, `cn` (className merger)

**Variables:**
- camelCase for all variables: `isAuthenticated`, `currentPage`, `selectedSessionId`, `isMobile`, `hasUnsavedChanges`
- Prefix boolean variables with `is`, `show`, or `has`: `isMobile`, `showPrivacyPolicy`, `showRoutineBuilder`, `hasUnsavedChanges`
- Prefix state setters consistently: `setIsAuthenticated`, `setCurrentPage`, `setSelectedSessionId`
- Inline object properties use camelCase: `muscleGroup`, `exerciseCount`, `progressionType`, `deloadEnabled`

**Types:**
- PascalCase for interface and type names: `Exercise`, `RoutineBuilderProps`, `TrainingCycle`, `ChallengeWonProps`
- Suffix prop interfaces with `Props`: `RoutineBuilderProps`, `LandingPageProps`, `ChallengeWonProps`
- SCREAMING_SNAKE_CASE for constants: `PLACEMENT_CONFIG` (in `types.ts` files)

**Directories and Organizational Structure:**
- Feature-based directories use kebab-case: `cycle-builder`, `routine-builder`, `challenge-won`
- UI primitives live in `ui/` directory
- Mobile-specific variants placed in `mobile/` directory
- Shared hooks in `hooks/` directory with camelCase filenames

## Code Style

**Formatting:**
- 2-space indentation (consistent across all files)
- Single quotes for strings in TypeScript/TSX
- Semicolons always used
- No Prettier config found - format follows React/TypeScript conventions by convention

**Linting:**
- No ESLint configuration detected
- Code follows standard React and TypeScript patterns by observation
- Style relies on developer discipline and IDE auto-formatting

**Tailwind & Styling:**
- Use Tailwind utility classes exclusively; inline styles avoided except in gradient definitions for Recharts
- Dark theme by default with explicit color references: `bg-[#0D0D0D]`, `text-white`, `border-[#374151]`
- Phoenix color palette accessed via hex values from `theme.css`:
  - Primary: `#FF6B35` (Ember)
  - Secondary: `#DC2626` (Flame Red)
  - Accent: `#F59E0B` (Gold)
  - Success: `#10B981` (Forge Green)
- Responsive prefixes used extensively: `sm:`, `md:`, `lg:` for mobile-first design
- Custom animations applied via class names: `animate-flame-flicker`, `animate-ember-rise`, `animate-phoenix-glow`

## Import Organization

**Order:**
1. React imports: `import { useState } from 'react'`
2. Third-party library imports: `import { motion } from 'motion/react'`, `import { Card } from '@/app/components/ui/card'`
3. Component imports with `@/` alias: `import { Dashboard } from '@/app/components/Dashboard'`
4. Internal utility imports: `import { useIsMobile } from '@/app/hooks/useIsMobile'`
5. Type imports: Usually inline within files rather than separate import statements

**Path Aliases:**
- `@/` maps to `./src` (configured in `vite.config.ts`)
- All imports use `@/app/` prefix for absolute imports from source root
- Example: `@/app/components/ui/card`, `@/app/hooks/useIsMobile`, `@/styles/theme.css`

## Error Handling

**Patterns:**
- Minimal error handling observed - project is view-only with mock data
- `console.log` used for debug output (e.g., in `CelebrationDemo.tsx`, `RoutineBuilder.tsx`)
- No try-catch blocks or formal error boundaries detected
- Props receive `any` type for complex objects pending API integration: `onSave: (routine: any) => void`
- Null coalescing with optional chaining: `selectedSessionId || undefined`, `routineId || undefined`

**Guidelines:**
- Use `console.log` for debugging during development
- When API integration occurs, add proper error handling and validation
- Optional props documented with `?`: `onNavigateToPrivacy?: () => void`, `userAvatar?: string`

## Comments

**When to Comment:**
- Comment section purposes in JSX, especially large layout blocks: `{/* Welcome Header */}`, `{/* Main Grid */}`, `{/* Portal Banner */}`
- Comment non-obvious logic or workarounds
- Type definitions include descriptive comments: `// Phoenix Project Color Palette`, `// Challenge Won Celebration Types`

**JSDoc/TSDoc:**
- Not extensively used in current codebase
- Function parameters rely on TypeScript type annotations for documentation
- When documenting complex types, place comments above the interface:
  ```typescript
  // Training Cycle Builder Type Definitions
  export interface TrainingCycle { ... }
  ```

## Function Design

**Size:**
- Components range 100-400 lines (larger ones like `Dashboard.tsx`, `LandingPage.tsx`)
- Smaller feature components 50-150 lines
- Hooks minimal: `useIsMobile.ts` is 22 lines

**Parameters:**
- Props always destructured in component function signatures: `function Dashboard()`, `export function Challenges() { ... }`
- Handler callbacks passed as props with clear naming: `onGetStarted`, `onNavigate`, `onViewSession`
- Type parameters over optional positional arguments

**Return Values:**
- Components return JSX.Element via implicit return
- Hooks return state directly or tuples: `return isMobile` for `useIsMobile`
- Early returns for conditional rendering: `if (isMobile) { return <ChallengesMobile />; }`

## Module Design

**Exports:**
- Named exports preferred: `export function Dashboard() { ... }`
- Single component export per file (following React convention)
- Type exports from `types.ts` files: `export interface TrainingCycle { ... }`, `export const PLACEMENT_CONFIG = { ... }`

**Barrel Files:**
- Not explicitly used; components imported directly by path
- Example: Import from `@/app/components/Dashboard` not `@/app/components`

**State Management:**
- Props drilling from `App.tsx` root component
- `useState` hooks for local component state
- No Redux, Context API, or Zustand detected
- All navigation and auth state lives in `App.tsx`: `isAuthenticated`, `currentPage`, `selectedSessionId`, `showPrivacyPolicy`, `showRoutineBuilder`, `showCycleBuilder`, `streak`

**Component Composition:**
- Feature pages are direct React function components
- Mobile variants co-exist as separate components in `mobile/` directory
- Subcomponents grouped in feature directories: `cycle-builder/`, `routine-builder/`, `celebrations/`
- shadcn/ui primitives imported from `@/app/components/ui/`

---

*Convention analysis: 2026-02-15*
