# Testing Patterns

**Analysis Date:** 2026-02-15

## Current Test Status

**No testing framework configured.** The project has:
- No Jest, Vitest, or other test runner installed
- No test files in the `src/` directory
- No testing configuration files (jest.config.ts, vitest.config.ts, etc.)
- No assertion libraries (Chai, Expect, etc.)

Test files found in `node_modules/` are from dependencies (react-day-picker, Radix UI, Babel) and are not part of this project's test suite.

## Test Framework

**Runner:**
- None configured
- Recommendation: Install and configure Vitest (pairs well with Vite 6)

**Suggested Installation:**
```bash
npm install -D vitest @vitest/ui happy-dom @testing-library/react @testing-library/user-event
```

**Run Commands (if testing were configured):**
```bash
vitest                 # Run tests in watch mode
vitest run            # Run all tests once
vitest run --coverage # Generate coverage report
```

## Recommended Test File Organization

**Location:**
- Co-locate test files with source code (recommended pattern)
- Alternative: Create `src/__tests__/` directory

**Naming:**
- Pattern: `ComponentName.test.tsx` or `ComponentName.spec.tsx`
- Examples: `Dashboard.test.tsx`, `RoutineBuilder.test.tsx`, `useIsMobile.test.ts`

**Structure:**
```
src/app/components/
├── Dashboard.tsx
├── Dashboard.test.tsx          # Test file
├── cycle-builder/
│   ├── CycleOverview.tsx
│   ├── CycleOverview.test.tsx
│   └── types.ts
└── ui/
    ├── button.tsx
    └── button.test.tsx
```

## Test Structure Patterns (To Implement)

**Component Test Suite:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dashboard } from './Dashboard';

describe('Dashboard', () => {
  beforeEach(() => {
    // Setup before each test
  });

  it('should render dashboard with welcome message', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
  });

  it('should display streak card with correct value', () => {
    render(<Dashboard />);
    const streakCard = screen.getByText('7 Day Streak');
    expect(streakCard).toBeVisible();
  });
});
```

**Hook Test Pattern:**
```typescript
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

describe('useIsMobile', () => {
  it('should return false for desktop window', () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false); // window.innerWidth > 768
  });

  it('should update on resize event', () => {
    const { result } = renderHook(() => useIsMobile());
    act(() => {
      global.innerWidth = 500;
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(true);
  });
});
```

## Mocking Strategy

**Framework:** Vitest built-in mocking via `vi` module

**What to Mock:**
- External API calls (when API integration occurs)
- Event handlers and callbacks
- Window/document APIs (resize, localStorage, etc.)
- Third-party libraries (Recharts data, motion animations for visual tests)

**What NOT to Mock:**
- React internals or hooks behavior (test real behavior)
- Component render logic (test the component, not the test)
- shadcn/ui primitives (they are already tested by Radix UI)
- Tailwind CSS application (visual testing handled separately)

**Example Mocking Pattern:**
```typescript
import { vi } from 'vitest';

// Mock window.innerWidth
Object.defineProperty(window, 'innerWidth', {
  writable: true,
  configurable: true,
  value: 1024,
});

// Mock event handler
const mockOnNavigate = vi.fn();
render(<Navigation currentPage="dashboard" onNavigate={mockOnNavigate} />);
user.click(screen.getByText('Analytics'));
expect(mockOnNavigate).toHaveBeenCalledWith('analytics');
```

## Fixtures and Factories

**Test Data Patterns:**
```typescript
// factory.ts - Create realistic mock data
export const createMockWorkout = (overrides?: Partial<Workout>) => ({
  id: '1',
  name: 'Push Day A',
  date: 'Today',
  volume: '5,200 kg',
  duration: '58 min',
  prs: 2,
  ...overrides,
});

export const createMockChallenge = (overrides?: Partial<Challenge>) => ({
  id: 1,
  name: 'January Volume Challenge',
  progress: 68,
  rank: 12,
  totalParticipants: 150,
  difficulty: 'hard' as const,
  ...overrides,
});
```

**Location:**
- `src/__fixtures__/` - Central fixtures directory
- Or `src/app/components/__tests__/fixtures.ts` - Feature-scoped fixtures

## Coverage Goals

**Requirements:**
- Not enforced currently
- Recommended targets once testing is set up:
  - Utilities and hooks: 90%+
  - Components: 80%+ (UI behavior, not pixel-perfect rendering)
  - Integration features: 70%+ (user workflows)

**View Coverage:**
```bash
vitest run --coverage
# Output: Coverage report in console and HTML report in ./coverage/
```

## Test Types

**Unit Tests:**
- Scope: Individual functions, hooks, utility functions
- Approach: Test function inputs/outputs in isolation
- Example: `useIsMobile.test.ts` - Test hook returns correct value based on window width

**Component Tests:**
- Scope: React components and their interactions
- Approach: Render component, assert on DOM output and state changes
- Example: `Dashboard.test.tsx` - Test that cards render, progress bars show correct values, handlers fire

**Integration Tests:**
- Scope: Multiple components working together (page-level flows)
- Approach: Render feature page, simulate user interactions, verify state flows correctly
- Example: Test `App.tsx` navigation flow - clicking navigation changes `currentPage` state and renders correct component

**E2E Tests:**
- Framework: Not currently set up
- Recommendation: Consider Playwright or Cypress once backend API is available
- Scope: Full user workflows end-to-end (login → create routine → save → view)

## Async Testing Patterns (Recommended When API Available)

```typescript
import { waitFor } from '@testing-library/react';

it('should load and display workout data', async () => {
  render(<Dashboard />);

  // Wait for async data load
  await waitFor(() => {
    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
  });

  // Assert loaded state
  expect(screen.getByText('Push Day A')).toBeInTheDocument();
});
```

## Error Testing Patterns

```typescript
it('should handle error state gracefully', () => {
  const { rerender } = render(<Dashboard />);

  // Simulate error condition
  rerender(<Dashboard error="Failed to load workouts" />);

  expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
});

it('should throw error for invalid props', () => {
  const invalidProps = { routineId: 123 }; // Should be string
  expect(() => {
    render(<RoutineBuilder {...(invalidProps as any)} onBack={() => {}} onSave={() => {}} />);
  }).toThrow();
});
```

## Recommended Setup for Future Testing

1. **Install dependencies:**
   ```bash
   npm install -D vitest @vitest/ui happy-dom @testing-library/react @testing-library/user-event
   ```

2. **Create vitest.config.ts:**
   ```typescript
   import { defineConfig } from 'vitest/config';
   import react from '@vitejs/plugin-react';
   import path from 'path';

   export default defineConfig({
     plugins: [react()],
     test: {
       environment: 'happy-dom',
       globals: true,
       setupFiles: ['./src/test/setup.ts'],
     },
     resolve: {
       alias: {
         '@': path.resolve(__dirname, './src'),
       },
     },
   });
   ```

3. **Update package.json scripts:**
   ```json
   {
     "scripts": {
       "test": "vitest",
       "test:ui": "vitest --ui",
       "test:run": "vitest run",
       "test:coverage": "vitest run --coverage"
     }
   }
   ```

4. **Add to .gitignore:**
   ```
   /coverage
   *.lcov
   ```

---

*Testing analysis: 2026-02-15*

**Note:** This codebase currently has no automated tests. The patterns documented above are recommendations for implementation when testing infrastructure is added. The project is currently in early development with mock data and view-only components.
