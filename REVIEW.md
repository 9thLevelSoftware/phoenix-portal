# Pull Request Review Guidance

## Review Method

Review every pull request in two passes:

1. Perform a normal correctness and safety review.
2. Perform the mandatory Ponytail review. Always include this pass, even when there are no findings.

Keep the codebase correct, secure, maintainable, and as small as possible. Prefer the simplest solution that actually satisfies the requirement: fewer files, dependencies, abstractions, branches, and concepts.

### Understand Intent First

Read the pull request title, description, linked issue, and changed files before suggesting simplification. Identify the behavior that is supposed to change and understand the real requirement.

### Correctness and Safety First

Look for bugs, broken edge cases, security issues, data-loss risks, race conditions, missing validation, poor error handling, broken tests, and regressions. Do not let simplification remove necessary safety, validation, accessibility, observability, tests, or explicitly requested behavior.

## Ponytail Review

After the correctness review, search the diff for unnecessary complexity. Prefer:

- Deletion over addition.
- Standard-library features over hand-written logic.
- Platform or native framework features over dependencies.
- Existing project patterns over new abstractions.
- One direct implementation over factories, registries, service layers, interfaces, adapters, or single-use configuration.

Challenge speculative future-proofing and flag code added “just in case,” abstractions with one implementation, wrappers around simple APIs, dependencies used for trivial behavior, duplicated helpers, unnecessary generated boilerplate, broad scaffolding, and tests that primarily test mocks, framework behavior, or implementation details instead of useful behavior. Documentation or comments that merely explain obvious code or defend unnecessary complexity may also be flagged.

Do not invent Ponytail findings. If the code is already simple, write exactly:

> Ponytail: Lean already. Ship.

### Ponytail Tags

Use these tags for Ponytail findings:

- `delete`: dead code, unused flexibility, speculative features, unnecessary branches, unused configuration, or scaffolding.
- `stdlib`: hand-written logic already provided by the language standard library.
- `native`: a dependency or custom code duplicating platform or framework functionality.
- `yagni`: an abstraction, configuration, or extension point with no current need.
- `shrink`: the same behavior can be expressed with materially less code.
- `reuse`: a new helper duplicates an existing project helper or pattern.
- `test-shrink`: a test can be simplified while preserving meaningful coverage.

Each finding must be concise and actionable:

```text
<file>:L<line>: <tag> <what to cut>. <what replaces it>.
```

Do not suggest removing required input validation, security checks, error handling that prevents data loss or silent failure, accessibility basics, tests protecting non-trivial behavior, operational logging or metrics, or behavior explicitly required by the pull request or linked issue. Prefer readable code over clever one-liners when readability prevents mistakes. Do not block a pull request merely because code could be shorter; block only for correctness, security, data-loss, or maintainability risks.

## Review Output

Use this structure:

### Verdict

Choose one:

- Approve
- Request changes
- Comment only

Follow it with one short sentence explaining why.

### Correctness / Safety Findings

List only real correctness, safety, security, regression, or test issues using:

```text
<severity>: <file>:L<line>: <issue>. <required fix>.
```

Use `critical` for bugs, security issues, or data-loss risks that must be fixed before merging; `important` for likely defects or maintainability hazards that should be fixed before merging; and `minor` for small issues, typos, naming, or clarity problems.

If there are none, write:

> No correctness or safety findings.

### Ponytail Review

Always include this section. List findings using the exact Ponytail format above. If there are none, write `Ponytail: Lean already. Ship.`. End the section with:

```text
Ponytail net: -<estimated removable lines> lines.
```

If no lines are removable, write `Ponytail net: 0 lines.`.

### Suggested Minimal Patch

For actionable findings, describe the smallest safe patch set. Change as few files as possible, prefer deleting code, do not add dependencies unless absolutely necessary, and do not propose a broad refactor when a local fix works. If no patch is needed, write:

> No patch needed.

### Final Merge Guidance

State clearly whether the pull request can merge, for example:

- Can merge after the critical finding is fixed.
- Can merge; Ponytail suggestions are optional cleanup.
- Do not merge until tests cover the changed behavior.
- Can merge as-is.

Be direct and specific. Do not praise boilerplate or ask for vague consideration. Every finding must identify exactly what should change. Mark optional simplifications as optional; when complexity creates real risk, explain that risk in one sentence. Never treat a tool, test, or CI self-report as proof when the diff contradicts it. Prefer the smallest root-cause fix over patches scattered across callers.

## Mandatory Per-PR Checklist

- Did I review correctness and security first?
- Did I run a separate Ponytail pass?
- Did I look for code to delete?
- Did I look for standard-library or native replacements?
- Did I look for one-implementation interfaces, factories, and adapters?
- Did I look for speculative configuration or extensibility?
- Did I avoid removing required validation, security, or tests?
- Did I include either Ponytail findings or “Ponytail: Lean already. Ship.”?
