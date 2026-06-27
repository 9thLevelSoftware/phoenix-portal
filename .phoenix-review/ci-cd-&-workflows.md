# Review: CI/CD & Workflows

Scope reviewed:
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-edge-functions.yml`
- `.github/workflows/migrations.yml`
- `.github/workflows/sync-tests.yml`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `AGENTS.md`
- `CLAUDE.md`
- `WORKFLOW.md`
- `README.md`

Summary:
- Findings: 21
- Severity breakdown: 0 critical, 4 high, 10 medium, 7 low
- Category breakdown: 3 bug, 2 stub, 0 error, 16 failure-point

Verification:
- Read all 11 assigned files end to end.
- Cross-checked referenced npm scripts in `package.json`, E2E Supabase configuration in `playwright.config.ts` / `e2e/support/supabase.ts`, Edge Function check coverage in `scripts/check-edge-functions.mjs`, and router mode in `src/main.tsx` where needed to validate workflow/documentation findings.
- No code was modified outside this report.

## `.github/workflows/ci.yml`

### Finding 1
- Category: failure-point
- Severity: high
- Line numbers: 51-59
- Description: The CI job is named `Edge Function Deno Check`, but it delegates to `npm run check:edge-functions`, whose script currently runs `deno check` only for `mobile-sync-push/index.ts` and `mobile-sync-pull/index.ts`. The repository contains many other Edge Functions, and `deploy-edge-functions.yml` deploys all local functions to production, so syntax/type/import breakage in unlisted functions can pass CI and be deployed.
- Suggested fix direction: Expand `scripts/check-edge-functions.mjs` or the workflow to discover/check every `supabase/functions/*/index.ts` entrypoint, preferably using the same function set that production deploys. Add an explicit exclusion list only for intentional skips.

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 97-111
- Description: The production build job runs `npm run build` with placeholder Supabase values and then only checks for sourcemaps. It does not run the repository's full `npm run verify` / `assert:supabase-config` guard, so CI can pass even when shipped config/CSP/build artifacts contain stale or wrong Supabase project refs that the local verify command is supposed to catch.
- Suggested fix direction: Run `npm run verify` or at least `npm run assert:supabase-config` after the build step, and provide the same stale-ref denylist/build-time environment that production uses. Keep placeholders only for compileability checks that are clearly separate from deploy readiness.

## `.github/workflows/deploy-edge-functions.yml`

### Finding 3
- Category: failure-point
- Severity: high
- Line numbers: 17-24, 59-65
- Description: `workflow_dispatch` can deploy whichever ref the operator selects, but the job has no `environment`, branch assertion, or ref guard before deploying all functions to the production Supabase project. A manual run from a feature branch or stale commit could push unreviewed Edge Function code directly to prod.
- Suggested fix direction: Add a protected production environment with required reviewers and an explicit shell or job-level guard such as `github.ref == 'refs/heads/main'` before the deploy step. If non-main hotfix deploys are ever needed, make that a separate audited input with a confirmation gate.

## `.github/workflows/migrations.yml`

### Finding 4
- Category: stub
- Severity: medium
- Line numbers: 8-10
- Description: The workflow explicitly documents live-production drift detection as out of scope and tracked as a follow-up. The current gate proves migrations can clean-apply locally, but it cannot detect the previously documented class of prod drift where schema changes exist in one environment but not another.
- Suggested fix direction: Add a separate scheduled or protected workflow that runs a linked `supabase db diff` / schema comparison against production or a read-only prod clone using tightly scoped secrets, and alerts without requiring PR credentials on every run.

### Finding 5
- Category: failure-point
- Severity: medium
- Line numbers: 55-59, 77-79
- Description: The clean-apply job has no job-level or step-level timeout. `supabase start`, Docker image pulls, health checks, or `supabase db reset` can hang until GitHub's default maximum timeout, consuming CI capacity and delaying feedback for migration PRs.
- Suggested fix direction: Add `timeout-minutes` to the job and/or the Supabase start/reset steps, and keep the `if: always()` cleanup step so the local stack is still stopped after failures.

## `.github/workflows/sync-tests.yml`

### Finding 6
- Category: bug
- Severity: medium
- Line numbers: 3-18
- Description: The workflow is path-filtered but does not include `.github/workflows/sync-tests.yml` in either the push or pull-request paths. Changes to this workflow can therefore merge without running the workflow they modify, unlike the migrations and deploy workflows that include their own files in their path filters.
- Suggested fix direction: Add `.github/workflows/sync-tests.yml` to both path lists, and consider also including `package.json`, `package-lock.json`, and relevant Vitest config files because dependency/test-runner changes can break sync tests without touching `tests/sync/**`.

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 3-18
- Description: This workflow omits an explicit top-level `permissions` block. It does not need repository write access, but will inherit whatever default `GITHUB_TOKEN` permissions the repository or organization has configured, increasing blast radius for a workflow that runs on pull requests.
- Suggested fix direction: Add `permissions: contents: read` at the workflow or job level, matching the other CI workflows unless a future step genuinely requires broader permissions.

### Finding 8
- Category: failure-point
- Severity: high
- Line numbers: 56-83
- Description: Live sync tests protect production by denying only two hard-coded URL patterns (`ilzlswmatadlnsuxatcv.supabase.co` and `api.phoenix-portal.com`). If production moves to a new Supabase ref or another custom domain, a misconfigured `SYNC_STAGING_SUPABASE_URL` could still point at prod and the live test suite would run against it.
- Suggested fix direction: Use an allowlist for known staging project refs/hosts, or require a separate `SYNC_STAGING_PROJECT_REF` secret and compare it to the parsed URL. Fail closed for unknown hosts instead of only blocking a small denylist.

### Finding 9
- Category: failure-point
- Severity: low
- Line numbers: 29-45, 94-119
- Description: The workflow hardcodes Node 20 for the primary job and tests only Node 20/22 in the PR matrix, while the main CI workflow follows `.nvmrc`, which currently selects Node 24. Sync tests can therefore pass in this workflow while still failing under the repository's current default Node runtime.
- Suggested fix direction: Use `node-version-file: .nvmrc` for the primary job and include that version in the matrix, or document why sync tests intentionally exclude the runtime used by the rest of CI.

## `.github/ISSUE_TEMPLATE/bug_report.yml`

### Finding 10
- Category: failure-point
- Severity: medium
- Line numbers: 29-60
- Description: The Mobile OS Version, Mobile App Version, and Mobile Device Model fields say they are required for Mobile App-only or Both reports, but GitHub Issue Forms cannot enforce that conditional requirement and these fields are configured with `required: false`. Mobile bugs can be filed without the device/app data needed for triage.
- Suggested fix direction: Split web and mobile bug templates, make the mobile fields required unconditionally when platform includes mobile, or replace the conditional copy with a required textarea that asks reporters to enter `N/A` for web-only issues.

### Finding 11
- Category: failure-point
- Severity: low
- Line numbers: 83-89
- Description: Expected behavior is optional. For a bug report, missing expected behavior often makes it difficult to determine whether the report describes a defect, a feature request, or expected product behavior.
- Suggested fix direction: Make the expected-behavior field required, or fold it into the required bug description prompt so every bug report captures actual vs expected behavior.

## `.github/ISSUE_TEMPLATE/config.yml`

### Finding 12
- Category: failure-point
- Severity: low
- Line numbers: 3-5
- Description: The only contact link sends general questions to the `Project-Phoenix-MP` discussions board rather than a Phoenix Portal discussion/support location. Portal users who avoid opening a blank issue can be routed to the mobile-app repository, making triage ownership ambiguous.
- Suggested fix direction: Point the contact link at a portal-specific discussion category or clearly state that the mobile repository discussion board is the intended shared support venue for both projects.

## `.github/ISSUE_TEMPLATE/feature_request.yml`

No findings identified in the assigned review categories.

## `AGENTS.md`

### Finding 13
- Category: failure-point
- Severity: medium
- Line numbers: 36-39
- Description: The guidance tells agents to run `npm run test:sync` for migration-adjacent work and to commit idempotent migration files, but it does not direct them to run the migration clean-apply gate or an equivalent Supabase migration validation when `supabase/migrations/**` changes. Agents following only this short guide can miss the workflow's primary migration failure mode.
- Suggested fix direction: Add a migration-specific validation bullet that mirrors `.github/workflows/migrations.yml` (local clean apply / `supabase db reset --no-seed` where available) and require documenting any missing Supabase/Docker prerequisites.

## `CLAUDE.md`

### Finding 14
- Category: bug
- Severity: low
- Line numbers: 24-32
- Description: The environment-variable list documents `SENTRY_DSN`, but the application initializes Sentry from `import.meta.env.VITE_SENTRY_DSN`. Following this guidance will leave browser error tracking disabled because Vite does not expose non-`VITE_` variables to client code.
- Suggested fix direction: Rename the documented variable to `VITE_SENTRY_DSN` and align `.env.example` / README documentation so all agent-facing setup instructions use the same key.

### Finding 15
- Category: stub
- Severity: medium
- Line numbers: 220-222
- Description: The migration CI coverage section records a not-yet-wired scheduled production drift check. This is a known gap in the migration safety story and is the exact class of issue the migration discipline section is trying to prevent.
- Suggested fix direction: Either implement the scheduled prod-drift workflow or move this to a tracked issue/runbook with owner and status so agents do not treat the coverage as complete.

## `WORKFLOW.md`

### Finding 16
- Category: bug
- Severity: high
- Line numbers: 41-44, 150-159
- Description: The Codex turn sandbox disables network access, but the documented execution flow requires `git fetch origin main --prune`, branch pushes, PR creation/update, and Linear handoff activity. Workers following this workflow can be blocked from performing the very network operations required to complete an issue.
- Suggested fix direction: Enable network access for the phases that require git/Linear/GitHub operations, or move fetch/push/PR/Linear writes into trusted hooks/tools outside the network-disabled turn sandbox and update the workflow accordingly.

### Finding 17
- Category: failure-point
- Severity: medium
- Line numbers: 22-30
- Description: The `after_create` hook performs both a fresh clone and `npm ci`, but the hook timeout is only 600,000 ms (10 minutes). Cold npm installs, registry slowness, or native optional dependency downloads can exceed this and leave newly created workspaces half-provisioned.
- Suggested fix direction: Increase the hook timeout, add retry/cache support, or split clone and dependency installation into separately reported steps so failures are diagnosable and retryable.

### Finding 18
- Category: failure-point
- Severity: low
- Line numbers: 66
- Description: The untrusted-input handling paragraph contains literal `\n` escape sequences instead of real Markdown line breaks. This makes an important safety instruction harder for agents and humans to read, and increases the chance that issue-content trust boundaries are missed.
- Suggested fix direction: Replace the escaped `\n` text with normal Markdown bullets/paragraphs and keep the instruction visually prominent near the issue metadata.

## `README.md`

### Finding 19
- Category: failure-point
- Severity: low
- Line numbers: 84-89
- Description: The development quickstart tells contributors to use `npm install`, while CI and the workflow guidance use `npm ci`. `npm install` can mutate `package-lock.json` or resolve dependencies differently from CI, leading to avoidable local/CI drift.
- Suggested fix direction: Change the default setup command to `npm ci` and mention `npm install <pkg>` only for intentional dependency changes.

### Finding 20
- Category: failure-point
- Severity: low
- Line numbers: 118-128
- Description: The environment-variable section omits `VITE_SENTRY_DSN` and does not list the six required Paddle price ID variables individually. New deployments following only the README can silently ship with disabled error monitoring or incomplete checkout configuration.
- Suggested fix direction: List every required/optional runtime variable explicitly, including `VITE_SENTRY_DSN` as optional monitoring config and all tier/interval Paddle price IDs.

### Finding 21
- Category: failure-point
- Severity: medium
- Line numbers: 161-167
- Description: The deployment section lists GitHub Pages as a static-host option without warning that the app uses `BrowserRouter`. Deep links and refreshes on nested routes will 404 on GitHub Pages unless a SPA fallback/404 rewrite or a hash-router/base-path strategy is configured.
- Suggested fix direction: Add host-specific SPA fallback requirements, document a supported GitHub Pages configuration, or remove GitHub Pages from the quick deploy list if it is not tested.
