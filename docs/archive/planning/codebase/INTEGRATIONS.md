# External Integrations

**Analysis Date:** 2026-02-15

## APIs & External Services

**Not detected**

The codebase contains no external API integrations. Comments indicate "Simulate API call" in `src/app/components/DashboardMobile.tsx` but no actual API clients or SDK imports are present.

## Data Storage

**Databases:**
- None detected - this is a view-only companion app
- Currently uses mock data embedded in React components
- No database client libraries (Supabase, Firebase, Prisma, etc.) present

**File Storage:**
- Local filesystem only - no cloud storage integration
- No S3, Cloud Storage, or similar services configured

**Caching:**
- None detected
- No Redis, Memcached, or browser cache strategy implemented

## Authentication & Identity

**Auth Provider:**
- None detected
- Custom mock authentication in `src/app/App.tsx`:
  - `isAuthenticated` state managed via `useState(false)`
  - `handleGetStarted()` function toggles authentication state
  - No actual auth library (Auth0, Firebase Auth, Supabase Auth, etc.)

**Implementation:**
- Props-drilled authentication state from root `App.tsx` to child components
- Landing page (`LandingPage`) component shows when unauthenticated
- Authenticated users see Dashboard and navigation
- No token management, session persistence, or real login

## Monitoring & Observability

**Error Tracking:**
- Not detected
- No Sentry, Rollbar, or similar error monitoring service

**Logs:**
- console.log statements used for debugging
- Example in `src/app/App.tsx` line 88: `console.log('Saving routine:', routine);`
- No structured logging or log aggregation service

**Analytics:**
- Not detected
- No Google Analytics, Mixpanel, or similar tracking

## CI/CD & Deployment

**Hosting:**
- Static file hosting (no API backend)
- Targets: Vercel, Netlify, Railway (static), or GitHub Pages
- Build output: `dist/` folder

**CI Pipeline:**
- Not configured
- No GitHub Actions, GitLab CI, or similar detected
- `package.json` scripts: `npm run dev` (Vite dev server) and `npm run build` (Vite build)

**Build Process:**
- Vite handles all transpilation, bundling, and optimization
- No additional build pipeline steps required

## Environment Configuration

**Required env vars:**
- None detected - no environment variables used

**Secrets location:**
- Not applicable (no secrets or credentials required)
- .env file not present in repository

## Webhooks & Callbacks

**Incoming:**
- Not detected
- No webhook endpoints implemented
- This is a view-only frontend app - no backend server

**Outgoing:**
- Not detected
- No outgoing webhook calls or callbacks to external services

## Notes on Architecture

**Sync Strategy:**
- Documentation references "data synced from the Project Phoenix mobile app" (README.md)
- No actual sync mechanism detected in codebase
- Mobile app integration planned but not implemented
- Currently shows mock data for demonstration

**Mobile Integration:**
- Related Project Phoenix Mobile App exists: https://github.com/DasBluEyedDevil/Project-Phoenix-MP (Kotlin Multiplatform)
- Integration point not yet built - Phoenix Portal is view-only placeholder

**Support/Community:**
- Ko-fi donation link included: https://ko-fi.com/vitruvianredux (referenced in `src/app/components/PrivacyPolicy.tsx`)
- Not a technical integration, just community/funding link

---

*Integration audit: 2026-02-15*
