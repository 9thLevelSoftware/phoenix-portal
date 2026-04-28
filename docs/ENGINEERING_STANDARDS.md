# Engineering Standards

This repo follows a Harness-style model: humans steer, agents execute, and the
repository carries the durable knowledge needed for future work.

## Repository Knowledge

- Keep `AGENTS.md` short and use it as a map.
- Put durable architecture, product, operations, security, and testing guidance
  in `docs/`.
- Treat `docs/archive/` as historical context only.
- Update docs when a review comment, production issue, or repeated mistake
  reveals a missing rule.

## Mechanical Enforcement

Prefer rules that can be checked:

- `npm run lint` for Biome formatting and lint rules.
- `npm run typecheck` for TypeScript strictness.
- `npm run check:harness` for repo knowledge and architecture boundaries.
- CI must use package scripts so local and remote checks match.

When a rule is too broad to fix immediately, baseline the existing debt in
`docs/quality/harness-baseline.json` and fail only on new violations.

## Implementation Taste

- Prefer existing project patterns over new abstractions.
- Keep shared rules centralized in schemas, helpers, or tooling.
- Avoid guessing external data shapes; validate them or rely on typed SDKs.
- Keep files small enough for agent review. Split large UI or Edge Function
  modules when touching them for related work.
- Preserve user changes and unrelated local work.

## Review And Verification

Every code change should leave a clear validation trail. Run the narrowest
meaningful checks for small edits and `npm run verify` for broad repo changes.
Call out pre-existing failures instead of hiding them.
