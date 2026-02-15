# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Phoenix Portal is a React web companion dashboard for Project Phoenix, a community rescue project for Vitruvian Trainer workout machines. This is a **view-only companion app** - all workout control happens in the mobile app.

## Commands

```bash
npm run dev     # Start Vite dev server at http://localhost:5173
npm run build   # Production build to /dist
npm run gen:types  # Regenerate Supabase types (requires SUPABASE_PROJECT_REF env var)
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values:
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anon/public key

No test framework or linter is configured.

## Architecture

### Tech Stack
- **Vite 6** with React 18 and TypeScript
- **Tailwind CSS v4** with @tailwindcss/vite plugin
- **shadcn/ui** components (50+ Radix UI primitives in `src/app/components/ui/`)
- **Recharts** for data visualization
- **Framer Motion** (motion package) for animations

### Path Alias
`@` maps to `./src` (configured in vite.config.ts)

### State Management
Props drilling from `App.tsx` root - no Redux/Context/Zustand. All page navigation and auth state lives in App.tsx useState hooks.

### Component Organization
```
src/app/
├── App.tsx                 # Root: auth, navigation, page routing
├── components/
│   ├── [Feature].tsx       # Feature pages (Dashboard, Analytics, etc.)
│   ├── [Feature]Mobile.tsx # Mobile variants for complex features
│   ├── ui/                 # shadcn/ui primitives
│   ├── celebrations/       # Achievement animations
│   ├── routine-builder/    # Routine creation subcomponents
│   ├── cycle-builder/      # Training cycle subcomponents
│   └── mobile/             # Mobile-specific feature implementations
└── hooks/
    └── useIsMobile.ts      # Mobile detection (768px breakpoint)
```

### Styling
- Dark theme by default (background: #0D0D0D)
- Phoenix color palette in `src/styles/theme.css`:
  - Primary/Ember: `#FF6B35`
  - Flame Red: `#DC2626`
  - Gold: `#F59E0B`
  - Forge Green: `#10B981`
- Custom animations: `animate-flame-flicker`, `animate-ember-rise`, `animate-phoenix-glow`
- CSS variables exposed via `@theme inline` for Tailwind v4

### Navigation Flow
1. `LandingPage` (unauthenticated)
2. `Dashboard` (authenticated default)
3. Feature pages selected via `Navigation` (desktop) or `MobileBottomNav` (mobile)
4. Detail views (SessionDetail, RoutineBuilder) accessed from list pages

### Mobile Responsiveness
- 768px breakpoint for mobile detection
- Separate mobile component variants exist for Dashboard, Analytics, Challenges, Community
- `MobileBottomNav` replaces desktop Navigation on small screens

### Data
Currently uses mock data embedded in components - no API integration yet.

## Key Files
- `src/app/App.tsx` - Application state and routing logic
- `src/styles/theme.css` - Phoenix color palette and custom animations
- `vite.config.ts` - Path aliases and plugin configuration

## The Daem0n's Covenant

This project is bound to Daem0n for persistent AI memory. Observe this protocol:

### At Session Dawn
- Commune with `get_briefing(project_path="C:/Users/dasbl/WebstormProjects/phoenix-portal")` immediately when powers manifest
- Heed any warnings or failed approaches before beginning work

### Before Alterations
- Cast `context_check("your intention", project_path="...")` before modifications
- Cast `recall_for_file("path", project_path="...")` when touching specific scrolls
- Acknowledge any warnings about past failures

### After Decisions
- Cast `remember(category, content, rationale, file_path, project_path="...")` to inscribe decisions
- Use categories: decision, pattern, warning, learning

### After Completion
- Cast `record_outcome(memory_id, outcome, worked, project_path="...")` to seal the memory
- ALWAYS record failures (worked=false) - they illuminate future paths

See Summon_Daem0n.md for the complete Grimoire.
