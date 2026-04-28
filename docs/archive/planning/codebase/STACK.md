# Technology Stack

**Analysis Date:** 2026-02-15

## Languages

**Primary:**
- TypeScript - Version inferred from tsconfig (React 18 with JSX support)
- TSX/JSX - Component development across entire `src/` directory

**Secondary:**
- CSS - Custom theme and animations in `src/styles/`
- JavaScript - Vite configuration files

## Runtime

**Environment:**
- Node.js (no .nvmrc specified - uses system Node)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- React 18.3.1 - UI framework (peerDependency)
- Vite 6.4.1 - Build tool and dev server
- TypeScript - Type safety

**Styling:**
- Tailwind CSS 4.1.12 - Utility-first CSS framework
- @tailwindcss/vite 4.1.12 - Tailwind plugin for Vite (required even if not actively used)

**Component Library:**
- shadcn/ui - Radix UI-based component primitives
  - 50+ Radix UI components packaged as shadcn/ui
  - Installed components in `src/app/components/ui/` including: accordion, alert, alert-dialog, avatar, badge, button, calendar, card, carousel, checkbox, command, dialog, dropdown-menu, form, hover-card, input, label, navigation-menu, pagination, popover, progress, radio-group, scroll-area, select, separator, sheet, skeleton, slider, sonner (toast), switch, table, tabs, textarea, toggle, toggle-group, tooltip

**Visualization:**
- Recharts 2.15.2 - Charts and data visualization library
  - Used in `src/app/components/Analytics.tsx`, `src/app/components/Dashboard.tsx`, `src/app/components/mobile/AnalyticsMobile.tsx`
  - Components: LineChart, BarChart, AreaChart, PieChart with supporting primitives

**Animation:**
- motion 12.23.24 - Framer Motion (imported as `motion/react`)
  - Used for component animations: `animate` props, `transition` prop with spring physics
  - Examples: opacity/position animations with delay staggering in `src/app/components/Analytics.tsx`

**UI Enhancement:**
- Lucide React 0.487.0 - Icon library
- class-variance-authority 0.7.1 - CSS class composition utility
- clsx 2.1.1 - Conditional CSS class management
- tailwind-merge 3.2.0 - Tailwind class merging utility
- tw-animate-css 1.3.8 - CSS animation utilities

**Form Handling:**
- react-hook-form 7.55.0 - Form state management
- input-otp 1.4.2 - OTP input component
- cmdk 1.1.1 - Command menu component

**Data/Time:**
- date-fns 3.6.0 - Date utility functions
- react-day-picker 8.10.1 - Date picker component

**Carousel/Carousel UI:**
- embla-carousel-react 8.6.0 - Carousel component
- react-slick 0.31.0 - Slider component

**Drag & Drop:**
- @dnd-kit/core 6.3.1 - Base drag-and-drop system
- @dnd-kit/sortable 10.0.0 - Sortable implementation
- @dnd-kit/utilities 3.2.2 - DnD utilities
- react-dnd 16.0.1 - Alternative drag-and-drop library
- react-dnd-html5-backend 16.0.1 - HTML5 backend for react-dnd

**Layout:**
- react-resizable-panels 2.1.7 - Resizable panel layout
- react-responsive-masonry 2.7.1 - Masonry layout

**Theme:**
- next-themes 0.4.6 - Theme switching utility (configured but not actively used in dark-mode-only implementation)
- vaul 1.1.2 - Drawer/sheet component

**UI Framework (Included but not primary):**
- @mui/material 7.3.5 - Material Design components
- @mui/icons-material 7.3.5 - Material Design icons
- @emotion/react 11.14.0 - CSS-in-JS library (MUI dependency)
- @emotion/styled 11.14.1 - Styled components (MUI dependency)
- @popperjs/core 2.11.8 - Positioning engine (MUI dependency)
- react-popper 2.3.0 - React wrapper for Popper (MUI dependency)

## Build & Dev Dependencies

**Build:**
- Vite 6.4.1 - Fast build tool and dev server
- @vitejs/plugin-react 4.7.0 - React fast refresh plugin

**PostCSS:**
- PostCSS configuration at `postcss.config.mjs` - Empty but extensible

## Configuration

**Vite:**
- Config file: `vite.config.ts`
- Path aliases: `@` maps to `./src/`
- React plugin for JSX transformation
- Tailwind CSS plugin for stylesheet injection

**TypeScript:**
- No explicit `tsconfig.json` found - uses Vite's default TS configuration
- JSX mode: react-jsx (Vite default)

**Styling:**
- Main stylesheet: `src/styles/index.css`
- Theme variables: `src/styles/theme.css` (Phoenix color palette with CSS custom properties)
- Fonts: `src/styles/fonts.css`
- Tailwind: `src/styles/tailwind.css`
- Supports Tailwind v4 `@theme inline` directive for CSS variable exposure

**Entry Points:**
- HTML entry: `index.html` with div#root
- Script entry: `src/main.tsx` using React 18's createRoot API

## Platform Requirements

**Development:**
- Node.js (system version)
- npm for package management
- Vite dev server (runs on http://localhost:5173)
- Modern browser with ES2020+ support

**Production:**
- Static file hosting (Vercel, Netlify, Railway, GitHub Pages)
- Output: `dist/` folder with optimized builds
- No backend runtime required

## Environment

**Configuration approach:**
- No .env configuration detected
- No environment variables used
- All configuration is compile-time (embedded in TypeScript)

**Dark Theme:**
- Default dark theme (#0D0D0D background)
- CSS variables defined in `:root` and `.dark` selectors
- Support for theme switching via `next-themes` (installed but not actively used)

## Additional Notes

- **Package.json type:** "module" (ES modules only)
- **Private package:** false
- **pnpm override:** Vite pinned to 6.3.5 (though npm dependency is 6.4.1)
- **No test framework** configured
- **No linter** configured (no ESLint or Biome)
- **No bundler plugins** for external API/SDK integration

---

*Stack analysis: 2026-02-15*
