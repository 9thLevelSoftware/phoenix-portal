# Phoenix Portal

[![Beta](https://img.shields.io/badge/version-v0.1.0--beta-orange)](https://github.com/9thLevelSoftware/phoenix-portal/releases/tag/v0.1.0-beta)
[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-7-purple)](https://vite.dev)

Web companion dashboard for [Project Phoenix](https://github.com/DasBluEyedDevil/Project-Phoenix-MP) — the community rescue project keeping Vitruvian Trainer workout machines alive after company bankruptcy.

![Phoenix Portal Dashboard](https://img.shields.io/badge/theme-dark-0D0D0D?style=flat&labelColor=FF6B35)

## Features

### Dashboard & History
- **Real-time Dashboard** — Workout stats, streak tracking, recovery score, goal progress rings
- **Workout History** — Searchable/filterable workout log synced from mobile app
- **Session Detail** — Deep dive into individual workouts with exercise breakdown

### Analytics & Insights
- **Performance Analytics** — Volume trends, PR tracking, muscle group distribution
- **Biomechanics Analysis** — Velocity zones, ROM trends, asymmetry detection
- **Training Load Gauge** — Acute:chronic workload ratio monitoring
- **Muscle Heatmap** — Visual muscle group coverage
- **Force Curves** — Concentric/eccentric power output visualization

### Session Replay
- **50Hz Telemetry Playback** — Rep-by-rep motion replay canvas
- **Timeline Navigation** — Scrub through workout timeline
- **Fatigue Summary** — Per-set fatigue analysis
- **Quality Badges** — Rep quality indicators

### Routine Builder
- **Visual Routine Editor** — Drag-and-drop exercise ordering
- **Superset Support** — Group exercises with rest period configuration
- **AMRAP & PR-scaling** — Advanced workout modifiers
- **Community Sharing** — Publish to routine library

### Training Cycles
- **Multi-week Periodization** — Build structured training blocks
- **Day-by-Day Planning** — Assign routines to specific days
- **Cycle Activation** — Single active cycle enforcement

### Community Hub
- **Routine Library** — Browse and clone community routines
- **Vote System** — Upvote/downvote community content
- **Leaderboards** — Compete on volume, PRs, streaks
- **Challenges** — Time-limited competitions

### Integrations
- **Strava** — Bidirectional activity sync
- **Fitbit** — Wearable data import
- **Garmin** — Webhook-based activity import
- **Hevy** — Workout history migration
- **Liftosaur** — Program and log migration

## Subscription Tiers

| Tier        | Monthly | Annual  | Access                                                |
| ----------- | ------- | ------- | ----------------------------------------------------- |
| **FREE**    | $0      | $0      | Landing, pricing                                      |
| **EMBER**   | $5      | $49/yr  | Cloud sync, history, dashboard, goals                 |
| **FLAME**   | $15     | $149/yr | Analytics, community, routines, cycles, integrations  |
| **INFERNO** | $25     | $249/yr | Session replay, advanced biomechanics *(coming soon)* |

## Tech Stack

| Layer              | Technology                                     |
| ------------------ | ---------------------------------------------- |
| **Build**          | Vite 7                                         |
| **Framework**      | React 19, TypeScript 5.7                       |
| **Styling**        | Tailwind CSS v4                                |
| **Components**     | shadcn/ui (50+ Radix primitives)               |
| **State**          | Zustand 5 (client), TanStack Query 5 (server)  |
| **Visualization**  | Recharts 3, @visx, ECharts 6                   |
| **Animation**      | Framer Motion (reduced-motion support)         |
| **Validation**     | Zod 4                                          |
| **Backend**        | Supabase (PostgreSQL, Auth, Realtime, Storage) |
| **Edge Functions** | 20 Deno functions                              |
| **Payments**       | Paddle (Merchant of Record)                    |
| **Monitoring**     | Sentry (cookie-consent-gated)                  |
| **Testing**        | Vitest 4, Playwright 1.58                      |
| **Linting**        | Biome 2.4                                      |

## Development

```bash
# Install dependencies
npm install

# Start dev server (localhost:5173)
npm run dev

# Production build
npm run build

# Run tests
npm test

# Type checking
npm run typecheck

# E2E tests
npm run test:e2e

# Regenerate Supabase types
npm run gen:types
```

### Symphony Orchestration

This repo includes `WORKFLOW.md` for [OpenAI Symphony](https://github.com/openai/symphony),
which can poll Linear and launch isolated Codex implementation runs for active
issues. Before running it, set `LINEAR_API_KEY` and fill in
`tracker.project_slug` in `WORKFLOW.md`. See
[`docs/runbooks/symphony.md`](docs/runbooks/symphony.md) for the full setup and
operating checklist.

### Environment Variables

Copy `.env.example` to `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_PADDLE_CLIENT_TOKEN=your-paddle-token
VITE_PADDLE_ENVIRONMENT=sandbox
# ... Paddle price IDs for each tier
```

## Mobile Sync Architecture

Bidirectional sync with Project Phoenix mobile app (Kotlin Multiplatform):

```
Mobile (SQLite) → POST mobile-sync-push → Supabase DB
                                            ↓
                              Broadcast sync_complete
                                            ↓
Portal ← useRealtimeSync hook ← Channel sync:{userId}
```

- **Push**: Workouts → Supabase (realtime broadcast triggers portal cache invalidation)
- **Pull**: Routines, cycles → Mobile SQLite
- **Conflict Resolution**: Domain-aware (mobile authoritative for BLE-captured data)
- **Pagination**: Cursor-based, 100 entities/page

## Phoenix Theme

Dark theme with ember color palette:

| Color       | Hex       | Usage                    |
| ----------- | --------- | ------------------------ |
| Background  | `#0D0D0D` | App background           |
| Ember       | `#FF6B35` | Primary accent           |
| Flame Red   | `#DC2626` | Alerts, emphasis         |
| Gold        | `#F59E0B` | Achievements, highlights |
| Forge Green | `#10B981` | Success states           |

Custom animations: `flame-flicker`, `ember-rise`, `phoenix-glow`

## Deployment

Build outputs to `dist/`. Deploy to any static host:
- Vercel
- Netlify
- Cloudflare Pages
- GitHub Pages

## Related Projects

- [Project Phoenix Mobile](https://github.com/DasBluEyedDevil/Project-Phoenix-MP) — Kotlin Multiplatform app (iOS/Android)

## License

MIT

---

*This project exists because of the Vitruvian Trainer community's refusal to let great hardware die.*
