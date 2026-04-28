# Symphony Runbook

This repo includes a project-owned `WORKFLOW.md` for
[OpenAI Symphony](https://github.com/openai/symphony). Symphony polls Linear,
creates an isolated workspace per issue, and launches `codex app-server` inside
that workspace.

Symphony is a low-key engineering preview, not production infrastructure. Run it
only in a trusted local or controlled CI-like environment where unattended Codex
work is acceptable.

## What Is Versioned Here

- `WORKFLOW.md`: the Symphony workflow contract for Phoenix Portal.
- `.worktrees/symphony/`: the default ignored root where Symphony creates
  per-issue workspaces.
- This runbook: operator setup, safety notes, and validation expectations.

The experimental Elixir implementation is not vendored into this app repo. Keep
the orchestration service separate from Phoenix Portal and point it at this
repo's `WORKFLOW.md`.

## Required Local Setup

1. Install and authenticate the Codex CLI.
2. Confirm app-server support:

   ```bash
   codex --version
   codex app-server --help
   ```

3. Create a Linear personal API key and set it in the shell that runs Symphony:

   ```bash
   export LINEAR_API_KEY=lin_api_...
   ```

   PowerShell equivalent:

   ```powershell
   $env:LINEAR_API_KEY = "lin_api_..."
   ```

4. Confirm `WORKFLOW.md` has the expected Linear project slug. The committed
   Phoenix Portal slug is `phoenix-portal-a6089d66fd4f`.
5. Ensure `git`, `node`, and `npm` are available to the Symphony process.

On Windows, prefer running the Symphony reference implementation from WSL or a
shell environment that can execute the POSIX-style hook scripts in
`WORKFLOW.md`. The repo itself is Windows-safe, but the current reference
implementation and hooks are easiest to operate from a Unix-like shell.

## Running The Reference Implementation

Follow the upstream
[Symphony Elixir README](https://github.com/openai/symphony/blob/main/elixir/README.md)
to install the reference implementation, then start it with this repo's workflow:

```bash
git clone https://github.com/openai/symphony
cd symphony/elixir
mise trust
mise install
mise exec -- mix setup
mise exec -- mix build
mise exec -- ./bin/symphony /path/to/phoenix-portal/WORKFLOW.md --logs-root /path/to/symphony-logs --port 4008
```

If you do not want the Phoenix observability service, omit `--port`.

## Workflow Assumptions

The committed workflow expects these Linear states:

- Active: `Todo`, `In Progress`, `Rework`, `Merging`
- Review hold: `Human Review`
- Terminal: `Done`, `Closed`, `Cancelled`, `Canceled`, `Duplicate`

If your Linear workflow uses different names, update `WORKFLOW.md` before
starting Symphony. A mismatch can cause work to be skipped or stopped during
reconciliation.

## Workspace Model

Symphony creates one workspace per issue under `.worktrees/symphony/`.
`after_create` clones `https://github.com/9thLevelSoftware/phoenix-portal.git`
and runs `npm ci`. The workspace persists between attempts for the same issue.

The `codex` config in `WORKFLOW.md` uses:

- `approval_policy: never` for unattended operation
- `thread_sandbox: workspace-write`
- `turn_sandbox_policy.networkAccess: true`

That is intentional for an autonomous runner, but it is not a low-risk default.
Do not run it against untrusted issues, untrusted branches, or a workstation with
credentials you are unwilling to expose to an agent process.

## Validation Bar

Before a Symphony-run agent moves an issue to `Human Review`, the default bar is:

```bash
npm run typecheck
npm test
npm run build
```

Additional validation:

- Run `npm run test:e2e` for UI, route, auth, browser-visible, or interaction
  changes.
- Run `npm run test:sync` for sync, Edge Function, or DTO changes.
- For Supabase migrations, use idempotent migration files under
  `supabase/migrations/` and validate locally when Supabase services and
  credentials are available.

## Operator Checklist

Before starting Symphony:

- `WORKFLOW.md` has `tracker.project_slug: "phoenix-portal-a6089d66fd4f"`.
- `LINEAR_API_KEY` is set in the Symphony process environment.
- The Linear workflow state names match `WORKFLOW.md`.
- `codex app-server --help` works in the same shell.
- `npm ci` succeeds in a clean clone.
- `gh auth status` works if agents are expected to open or update PRs.

During operation:

- Watch Symphony logs for workflow parse errors, Linear auth errors, stalled
  Codex sessions, and repeated retry loops.
- Keep concurrency low until the workflow has completed several issues cleanly.
- Treat unexpected test failures as issues to root-cause, not noise.

To stop a run safely, move the Linear issue out of an active state or stop the
Symphony process. Terminal-state cleanup runs on startup and active-run
reconciliation.
