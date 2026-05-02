# `phoenix-portal/audit/`

UX/UI audit deliverable for the Phoenix Portal web app. Audited 2026-05-01.

## Start here

1. **`PLAN.md`** — definitive plan for this repo. Top-fix-first list, severity-ranked findings catalog, sequencing recommendation, mockup index.
2. **`PARITY-COORDINATION.md`** — cross-cutting items requiring coordinated changes with `Project-Phoenix-MP`. **Identical copy lives in the mobile repo's `audit/` folder.** Keep them in sync.

## Folder layout

```
audit/
├── README.md                       — this file
├── PLAN.md                         ★ start here
├── PARITY-COORDINATION.md          — cross-repo coordination spec (identical in both repos)
│
├── findings/                       — per-stream finding files (raw audit output, full text)
│   ├── 02-portal-static.md         — 22 findings, React/TSX static review
│   ├── 03-visual-brand.md          — 21 findings, palette/type/spacing parity (cross-platform)
│   ├── 04-a11y-parity.md           — 19 findings + WCAG ratios + 20-row parity matrix (cross-platform)
│   └── 05-portal-live.md           — 15 findings, Playwright live walkthrough
│
├── mockups/                        — proposed-redesign annotated mockups
│   └── M-03-portal-protected-route-ux.md  — 537 lines, 4 surfaces (404 / AuthRequired / TierLocked / FREE-tier dashboard + AppSidebar locks)
│
├── screenshots/                    — 56 PNG captures from live walkthrough + 3 JSON probe files
│   ├── *.png
│   ├── _data.json                  — DOM probe data (computed colors, focus order, viewport metrics)
│   ├── _routes.json                — per-route redirect/h1 probe results
│   └── _auth-dialog.json           — auth dialog DOM/aria probe
│
└── scripts/                        — re-runnable Playwright walkthrough scripts
    ├── portal-walkthrough.mjs      — full landing + responsive + dynamic-type + reduced-motion sweep
    └── portal-rescan.mjs           — narrower re-run for triage / regression check
```

## How findings cross-reference

The master audit at the monorepo root (`../_audit/`, untracked archival) renumbers all findings globally as `G-###`. The PLAN.md in this folder uses **portal-local IDs** (`P-1`, `P-2`, ...) for the top fix-first list and **per-stream IDs** (`02-F-001`, `04-F-001`, etc.) when referring to specific findings. Cross-repo parity items are tagged `(PARITY)` and linked to `PARITY-COORDINATION.md` sections (`§1`, `§2`, ...).

## Scripts: re-running the walkthrough

The Playwright scripts that produced the live screenshots are committed for reproducibility. To re-run after a change:

```bash
# from phoenix-portal/ (parent of audit/)
npm install
npm run dev &  # serve on http://localhost:5173
# wait for ready
npx playwright install chromium  # one-time, downloads browser binaries
node audit/scripts/portal-walkthrough.mjs
# or for narrower re-runs:
node audit/scripts/portal-rescan.mjs
```

Outputs land in `audit/screenshots/portal/` (overwriting) and `_data.json` / `_routes.json` are refreshed.

## Branch & commit hygiene

This audit is on branch **`feat/ux-ui-audit-2026-05-01`** (created from `main`). Nothing is committed yet — `git add audit/` and commit when you're ready. The `_audit/` folder at the monorepo root is the archival master and is **not** part of this repo (it's untracked at a non-git level above).

## Out of scope for this audit

See `PLAN.md` §9 for the full list. Notably:
- Sync/backend logic
- Performance benchmarking
- Authenticated walkthrough (the live walkthrough hit auth on 13/18 surfaces — schedule a credentialed re-run after the routing redesign in Mockup M-03 ships)
- iOS-specific portal rendering (this is web — out of context)
- Brand voice / copy tone

---

Questions or scope changes? Update `PLAN.md` first; downstream tickets reference it.
