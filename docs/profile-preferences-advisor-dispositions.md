# Profile Preference Advisor Dispositions

Initially captured 2026-07-15 at 20:50 EDT and updated after PR #86 deployed
to production at 22:11 EDT. The reviewed PR head was `8b635b9`; the production
squash/deployment SHA is `1b5d9ca`. This record separates the feature-object
result from unrelated baseline findings. It does not describe the local
database or any remote environment as globally clean.

The Edge Function local gate was rerun from a fresh database on 2026-07-16
against local Edge branch head `42089e7` plus the Task 9 documentation/config
diff. No staging or production resource was read or mutated by that rerun.

## Outcome

- New findings on `public.local_profile_preferences`,
  `public.local_profile_preference_section_canonical`, or
  `public.mutate_local_profile_preference_section`: **0** in the fresh local,
  preview, and post-deployment production advisor reruns.
- Resolved target findings: **0**. No target finding required a fix.
- Unrelated findings: the local lint error, all 104 local advisor warnings, all
  199 preview notices, and all current production findings below are outside
  the target objects and feature migration scope.
- Production deployment boundary: read-only migration inventory now contains
  `20260715234034_profile_preferences`, and the repository drift workflow
  compared 83 local with 83 remote migrations without drift. The production
  advisor output below is post-deployment verification.

## Local database lint

Command: `npx --yes supabase@2.81.3 -o json db lint --local --fail-on warning`

| Environment | Source/command | Finding ID | Severity | Object | Disposition or fix | Rerun result |
| --- | --- | --- | --- | --- | --- | --- |
| Local | `supabase db lint --local --fail-on warning` | `plpgsql_check` / SQLSTATE `42703` | ERROR | `public.upsert_routine_lww` | Pre-existing and unrelated: the function references the absent `public.routines.created_at` column. Fixing the existing routine function/schema is outside the profile-preference files. | Fresh run exit `1`; the same single error remains. Neither new preference function was reported. |

The nonzero lint exit is retained as a baseline concern; it is not converted
into a clean result.

## Local database advisors

Command: `npx --yes supabase@2.81.3 -o json db advisors --local`

| Environment | Source/command | Finding ID | Severity | Object | Disposition or fix | Rerun result |
| --- | --- | --- | --- | --- | --- | --- |
| Local | `supabase db advisors --local` | [`auth_rls_initplan`](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan) (72 findings) | WARN | `public.challenge_participants`, `public.community_comments`, `public.community_votes`, `public.creator_follows`, `public.cycle_days`, `public.exercise_catalog`, `public.exercise_progress`, `public.exercise_signatures`, `public.external_activities`, `public.local_profiles`, `public.oauth_states`, `public.oauth_tokens`, `public.personal_records`, `public.profiles`, `public.rate_limit_tracking`, `public.routine_exercises`, `public.routines`, `public.saved_community_items`, `public.session_phase_statistics`, `public.shared_cycles`, `public.shared_routines`, `public.subscriptions`, `public.sync_queue`, `public.training_cycles`, `public.user_goals`, `public.user_insights`, `public.user_integrations`, `public.user_onboarding`, `public.vbt_assessments`, and `public.workout_sessions` | Pre-existing performance findings outside the target objects and feature file scope; no change in this PR. | Fresh rerun still reports 72 warnings. |
| Local | `supabase db advisors --local` | [`multiple_permissive_policies`](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) (30 findings) | WARN | `public.local_profiles` and `public.profiles` | Pre-existing performance findings outside the target objects and feature file scope; no change in this PR. | Fresh rerun still reports 30 warnings. |
| Local | `supabase db advisors --local` | [`duplicate_index`](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index) (1 finding) | WARN | `public.user_onboarding` | Pre-existing performance finding outside the target objects and feature file scope; no change in this PR. | Fresh rerun still reports 1 warning. |
| Local | `supabase db advisors --local` | [`function_search_path_mutable`](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) (1 finding) | WARN | `public._external_activities_bump_updated_at` | Pre-existing security finding outside the target objects and feature file scope; no change in this PR. | Fresh rerun still reports 1 warning. |
| Local | `supabase db advisors --local` target-object filter | `target-object-scope` | NONE | `public.local_profile_preferences`, `public.local_profile_preference_section_canonical`, and `public.mutate_local_profile_preference_section` | No advisor fix required. The migration already defines both functions with an empty `search_path`, and no advisor row names any target object. | Exit `0`; 104 total pre-existing warnings and `TargetFindings=0`. |

## Staging or preview baseline

Closing and reopening PR #86 deleted the stale preview and caused the Supabase
GitHub integration to create fresh branch `teeahnjwmkhmvpdjswuh` from final PR
head `8b635b9`. The preview migration pipeline and clean-apply CI succeeded
before these read-only advisor reruns.

| Environment | Source/command | Finding ID | Severity | Object | Disposition or fix | Rerun result |
| --- | --- | --- | --- | --- | --- | --- |
| Preview | Supabase `get_advisors(security)` (read-only) | `security_definer_view` (1), `function_search_path_mutable` (1), `anon_security_definer_function_executable` (12), and `authenticated_security_definer_function_executable` (12) | 1 ERROR, 25 WARN | Pre-existing objects outside `public.local_profile_preferences` and its two functions | Outside the target migration scope; no target advisor fix required. | Fresh preview rerun reported 26 notices and `TargetFindings=0`. |
| Preview | Supabase `get_advisors(performance)` (read-only) | `auth_rls_initplan` (72), `multiple_permissive_policies` (30), `duplicate_index` (1), `unindexed_foreign_keys` (9), `unused_index` (60), and `auth_db_connections_absolute` (1) | 103 WARN, 70 INFO | Existing objects outside `public.local_profile_preferences` | Outside the target migration scope; no target advisor fix required. | Fresh preview rerun reported 173 notices and `TargetFindings=0`. |

The preview is explicitly non-clean because of unrelated existing findings;
the feature's target table and functions have zero advisor findings.

## Production security post-deployment baseline

Source: read-only Supabase `get_advisors` for project
`ilzlswmatadlnsuxatcv`, type `security`.

| Environment | Source/command | Finding ID | Severity | Object | Disposition or fix | Rerun result |
| --- | --- | --- | --- | --- | --- | --- |
| Production | Supabase `get_advisors(security)` (read-only) | [`security_definer_view`](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view) (1 finding) | ERROR | `public.public_profiles` | **Pre-existing and out of scope.** This is a real production ERROR: the view is defined with the `SECURITY DEFINER` property. The profile-preference migration does not modify this view. | Current baseline still reports 1 ERROR; production is not globally clean. |
| Production | Supabase `get_advisors(security)` (read-only) | [`function_search_path_mutable`](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) (10 findings) | WARN | `public._external_activities_bump_updated_at`, `public.detect_plateaus`, `public.get_acwr`, `public.get_exercise_trend`, `public.get_goal_progress_cached`, `public.get_muscle_distribution`, `public.get_volume_comparison`, `public.get_volume_rolling_avg`, `public.get_wearable_trends`, and `public.get_workout_streak` | **Pre-existing and out of scope.** None is a target preference function; no change in this PR. | Current baseline still reports 10 warnings. |
| Production | Supabase `get_advisors(security)` (read-only) | [`anon_security_definer_function_executable`](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) (19 findings) | WARN | `public.check_comment_rate_limit`, `public.check_goal_limit`, `public.get_percentile_rank`, `public.get_profile_stats`, `public.get_routines_excluding_ids`, `public.get_sessions_excluding_ids`, `public.handle_new_user`, `public.import_shared_cycle`, `public.import_shared_routine`, `public.insert_routine_exercises_from_snapshot`, `public.refresh_community_benchmarks`, `public.refresh_hot_scores`, `public.rls_auto_enable`, `public.update_comment_count`, `public.update_leaderboard_events_updated_at`, `public.update_pr_count_on_record`, `public.update_profile_stats_on_workout`, `public.update_vote_count`, and `public.user_subscription_tier` | Pre-existing and out of the feature file scope. No change in this PR. | Current baseline still reports 19 warnings. |
| Production | Supabase `get_advisors(security)` (read-only) | [`authenticated_security_definer_function_executable`](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) (19 findings) | WARN | The same 19 pre-existing functions listed in the preceding row | Pre-existing and out of the feature file scope. No change in this PR. | Current baseline still reports 19 warnings. |
| Production | Supabase `get_advisors(security)` (read-only) | [`auth_leaked_password_protection`](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) (1 finding) | WARN | Supabase Auth | Pre-existing project configuration warning outside the migration/test file scope. No change in this PR. | Current baseline still reports 1 warning. |
| Production | Supabase `get_advisors(security)` (read-only) | [`auth_insufficient_mfa_options`](https://supabase.com/docs/guides/auth/auth-mfa) (1 finding) | WARN | Supabase Auth | Pre-existing project configuration warning outside the migration/test file scope. No change in this PR. | Current baseline still reports 1 warning. |

Production security total: 51 notices (1 ERROR and 50 WARN). This baseline is
explicitly non-clean.

## Production performance post-deployment baseline

Source: read-only Supabase `get_advisors` for project
`ilzlswmatadlnsuxatcv`, type `performance`.

| Environment | Source/command | Finding ID | Severity | Object | Disposition or fix | Rerun result |
| --- | --- | --- | --- | --- | --- | --- |
| Production | Supabase `get_advisors(performance)` (read-only) | [`auth_rls_initplan`](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan) (78 findings) | WARN | `public.challenge_participants`, `public.community_comments`, `public.community_votes`, `public.creator_follows`, `public.cycle_days`, `public.exercise_catalog`, `public.exercise_progress`, `public.exercise_signatures`, `public.external_activities`, `public.goal_snapshots`, `public.local_profiles`, `public.oauth_states`, `public.oauth_tokens`, `public.overload_suggestions`, `public.personal_records`, `public.profiles`, `public.rate_limit_tracking`, `public.routine_exercises`, `public.routines`, `public.saved_community_items`, `public.session_phase_statistics`, `public.shared_cycles`, `public.shared_routines`, `public.subscriptions`, `public.sync_queue`, `public.telemetry_analysis`, `public.training_cycles`, `public.user_goals`, `public.user_insights`, `public.user_integrations`, `public.user_onboarding`, `public.vbt_assessments`, `public.wearable_daily_summaries`, and `public.workout_sessions`; no `public.local_profile_preferences` finding | Pre-existing performance warnings outside the feature's target objects and file scope. No change in this PR. | Current baseline still reports 78 warnings. |
| Production | Supabase `get_advisors(performance)` (read-only) | [`multiple_permissive_policies`](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) (36 findings) | WARN | `public.local_profiles` and `public.profiles` | Pre-existing performance warnings outside the target table. No change in this PR. | Current baseline still reports 36 warnings. |
| Production | Supabase `get_advisors(performance)` (read-only) | [`duplicate_index`](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index) (2 findings) | WARN | `public.local_profiles` and `public.user_onboarding` | Pre-existing performance warnings outside the target table. No change in this PR. | Current baseline still reports 2 warnings. |
| Production | Supabase `get_advisors(performance)` (read-only) | [`unindexed_foreign_keys`](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) (10 findings) | INFO | `public.challenge_participants`, `public.cycle_days`, `public.exercise_progress`, `public.goal_snapshots`, `public.oauth_states`, `public.personal_records`, `public.rate_limit_tracking`, `public.shared_cycles`, `public.shared_routines`, and `public.user_blocks` | Pre-existing performance information outside the target objects. No change in this PR. | Current baseline still reports 10 notices. |
| Production | Supabase `get_advisors(performance)` (read-only) | [`unused_index`](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) (13 findings) | INFO | `public.community_comments`, `public.content_reports`, `public.exercise_catalog`, `public.saved_community_items`, `public.session_phase_statistics`, `public.sync_queue`, `public.telemetry_analysis`, `public.training_cycles`, `public.user_goals`, and `public.vbt_assessments` | Pre-existing performance information outside the target objects. No change in this PR. | Current baseline still reports 13 notices. |
| Production | Supabase `get_advisors(performance)` (read-only) | [`auth_db_connections_absolute`](https://supabase.com/docs/guides/deployment/going-into-prod) (1 finding) | INFO | Supabase Auth | Pre-existing project configuration information outside the migration/test file scope. No change in this PR. | Current baseline still reports 1 notice. |

Production performance total: 140 notices (116 WARN and 24 INFO). These
pre-existing warnings/notices remain open and are not evidence of a globally
clean environment.

## Edge Function authentication boundary

`mobile-sync-push` and `mobile-sync-pull` intentionally retain
`verify_jwt = false`. This disables only the gateway's pre-handler JWT
decision; it does not make either handler unauthenticated. Each handler
requires the exact bearer syntax, calls `auth.getUser(userJwt)` through a
caller-scoped client, derives the user id only from that verified result, and
constructs the service-role client only after authentication and strict
request validation succeed.

The manual boundary is required by mobile retry semantics: definitive bearer
syntax or returned Auth 400/401/403 failures become 401, while Auth service
outages, rate limits, malformed results, and thrown calls become sanitized
503 responses. Enabling the gateway check would allow the gateway to return
before the handler and erase that distinction. The push and pull test suites
both prove that every Auth failure constructs and calls zero privileged
clients. See the official Supabase descriptions of the
[`verify_jwt` gateway layer](https://supabase.com/docs/guides/functions/auth-headers)
and [handler-owned authentication](https://supabase.com/docs/guides/troubleshooting/edge-function-401-error-response).

## Task 9 fresh local verification

All commands below used Supabase CLI `2.81.3` and Deno `2.2.15`. The Deno
integration environment was populated from the running local Supabase stack
without printing its local keys. The push suite's golden digest guard used the
least-privilege read grant shown below; the guard was not weakened.

| Command | Result | Disposition |
| --- | --- | --- |
| `npx --yes supabase@2.81.3 db reset --local` | PASS | Fresh replay applied `20260715234034_profile_preferences` and completed seed/restart. |
| `npx --yes supabase@2.81.3 migration list --local` | PASS | Local migration inventory includes `20260715234034` and matches the local database history. |
| `npx --yes supabase@2.81.3 test db --local` | PASS | 1 file, 38 tests, 0 failures. |
| `npx --yes deno@2.2.15 test --allow-read=supabase/functions/_shared/profile-preference-byte-goldens.json --allow-env --allow-net supabase/functions/mobile-sync-push` | PASS | 170 passed, 0 failed; all three real local integration tests executed. |
| `npx --yes deno@2.2.15 test --allow-env --allow-net supabase/functions/mobile-sync-pull` | PASS | 67 passed, 0 failed; the real mutation/pull integration test executed. |
| `npx --yes supabase@2.81.3 db lint --local --fail-on warning` | BASELINE NONZERO | Exit 1 only for pre-existing SQLSTATE `42703` in `public.upsert_routine_lww`, which references absent `public.routines.created_at`; neither preference function was reported. |
| `npx --yes supabase@2.81.3 db advisors --local` | PASS WITH BASELINE WARNINGS | Exit 0; 104 known warnings (`auth_rls_initplan` 72, `multiple_permissive_policies` 30, `duplicate_index` 1, `function_search_path_mutable` 1), with `TargetFindings=0`. |
| `npm run test:sync` | PASS | 18 files; 269 passed and 17 skipped. |
| `npm run check:edge-functions` | PASS | Exit 0 using the pinned Deno fallback. |
| `npm run verify:full` | BASELINE NONZERO | The chain stops at Biome 2.5.4 on six formatter errors in unchanged test files; none is in the profile-preference or Task 9 diff. The remaining stages were run explicitly as recorded below. |

The explicit continuation after the repository-wide Biome baseline produced:

- `npm run typecheck`: PASS.
- `npm test`: 131 files; 1,355 passed and 17 skipped.
- `npm run build`: PASS; `npm run assert:no-sourcemaps` and
  `npm run assert:supabase-config` also passed.
- The exact parallel `npm run test:e2e` run reached every test: 60 passed, the
  live-Realtime test skipped as designed, and the first four parallel
  accessibility workers timed out at `page.waitForLoadState("networkidle")`
  after 30 seconds. The four exact failures passed 4/4 in a one-worker rerun,
  and the complete `npm run test:e2e -- --workers=1` recovery passed all 64
  runnable tests with the same one live-Realtime skip. No E2E source or
  configuration file differs from `origin/main`; the evidence is consistent
  with local fully-parallel startup/resource contention rather than a feature
  failure.

## Required portal test manifest mapping

Every handoff manifest key maps to an executable pgTAP diagnostic or Deno test
below. The fresh Task 9 runs above executed all of them; no row relies on a
source-string search.

| Manifest key | Executable coverage |
| --- | --- |
| `database:exact-function-acls-and-no-client-dml` | `profile_preferences.test.sql` diagnostic of the same name; exact signatures, owners, `SECURITY INVOKER`, empty `search_path`, return shape, function ACLs, table DML ACLs, and RLS policy catalog. |
| `database:temporary-grant-owner-rls-and-cross-owner-user-id-protection` | `profile_preferences.test.sql` diagnostic of the same name; rolled-back grants exercise owner select/insert/update/delete and the cross-owner `WITH CHECK` failure before privileges are reasserted. |
| `database:base-revision-accept-and-stale-canonical-conflict` | `profile_preferences.test.sql` diagnostic of the same name; all five base-zero accepts, matching-base increment, sibling preservation, stale canonical conflict, and explicit domain rejections. |
| `edge:auth-and-cross-user-profile-rejection` | Push `auth: ... definitive 401 before auth or admin construction`, `body userId cannot authorize a preference mutation`, and the real lost-ack integration's other-owner `UNKNOWN_PROFILE`; pull real integration proves cross-owner omission. |
| `edge:auth-rejection-vs-operational-outage-classification` | The complete push and pull `auth: returned ... definitive 401`, `auth outage: ... generic name-only 503`, and safe-name test tables. |
| `edge:strict-five-section-validation-and-local-only-rejection` | Push `all five exact section wrappers validate`, `strict preference shape: ...`, `recursive normalized local-only key ...`, duplicate-identity, and valid-sibling isolation tests. |
| `edge:kotlin-int32-float32-unicode-and-rfc3339-parity` | Push `Kotlin Int32: ...`, `Kotlin Float32 ...`, CORE/RACK original-number boundary, PostgreSQL text safety, and RFC3339 accept/reject tables; pull malformed timestamp/Unicode infrastructure cases. |
| `edge:fatal-utf8-bom-and-original-byte-enforcement` | Push `raw bytes: ... before admin construction`, U+FFFD acceptance, ordinary original-byte limits, and legacy-capacity tests through the real raw handler. |
| `edge:section-262143-262144-262145-byte-boundaries` | Push `raw section boundary: 262143/262144/262145 bytes uses the exact element span`. |
| `edge:envelope-524287-524288-524289-byte-boundaries` | Push `raw request boundary: 524287/524288/524289 original bytes is enforced inclusively`, plus exact scanner offset and duplicate-key tests. |
| `edge:unexpected-rpc-error-is-sanitized-5xx` | Push `preference infrastructure: ... is one name-only 503` table covers returned/thrown errors, cardinality, malformed canonical/revision/reason matrices, and invalid/oversized names. |
| `edge:same-section-concurrent-first-write` | Real local Deno integration `same-section concurrent first writes accept one and converge one conflict`. |
| `edge:different-section-concurrent-first-write` | Real local Deno integration `different-section concurrent first writes both preserve revision-one siblings`. |
| `edge:lost-ack-retry-canonical-convergence` | Real handler integration `handler lost-ack retry converges committed and failed siblings`. |
| `edge:mutation-and-first-page-pull-canonical-equality` | Pull real local integration `real mutation canonicals equal isolated first-page pull and absence never creates`, plus first-page exact owner/profile query mapping. |
| `edge:later-pull-pages-omit-preferences-and-keep-sync-time` | Pull `later page omits preferences and preserves pagination and injected syncTime`, also asserted through the real local integration. |

## Task 10 nonproduction preview verification

Draft PR [#88](https://github.com/9thLevelSoftware/phoenix-portal/pull/88)
created Supabase preview branch
`fcd6308c-6daf-412e-8064-535fe0f23309`, project ref
`otygdxrzhlzooychegzb`, for Git branch
`codex/profile-preferences-edge-functions`. The preview parent is production
`ilzlswmatadlnsuxatcv`; the refs were compared before any preview query or
mutation. The preview is ephemeral, contains no copied production data, and
reported `ACTIVE_HEALTHY` / `FUNCTIONS_DEPLOYED`.

The GitHub integration deployed branch commit `caee554` as
`mobile-sync-push` version 2 with `verify_jwt = false` and bundle SHA-256
`06a6f132a3be2d818981c175c6b2f55d4bd94ae370f5fbfe3a7be76d883e4de2`,
and `mobile-sync-pull` version 2 with `verify_jwt = false` and bundle SHA-256
`2ebfb660a4f029789c64adee76a031152fba32382c720e10fde45c63f42d56b9`.
Normalized SHA-256 comparison of both retrieved entrypoints and every
transitive shared source file matched the committed branch files. Because the
GitHub integration had already deployed an exact bundle, no redundant manual
function deployment/version bump was performed.

The integration version-bumped all 22 functions in this isolated preview from
1 to 2 on the `caee554` update, including source-unchanged functions. This is
the same integration behavior previously observed during the database rollout,
but it affected only the disposable preview. No production function was
deployed or changed by Task 10.

Fresh local verification after the bounded-body review fix produced:

- push Deno suite: 174/174, including all three real local integrations;
- pull Deno suite: 67/67, including the real mutation/pull integration;
- sync suite: 269 passed and 17 skipped;
- Edge Function check, Deno type checks, focused formatting, and diff checks:
  PASS.

Two disposable preview users and profiles then exercised the deployed version-2
functions. The live smoke result was:

- legacy push and pull both returned 200 without preference acceptance fields;
- all five sections were accepted at revision 1, and the first-page pull
  canonical wrappers deep-equaled the mutation canonicals;
- a stale CORE write returned `REVISION_CONFLICT` with the stored canonical;
- cross-owner mutation returned `UNKNOWN_PROFILE`, and cross-owner pull omitted
  preferences;
- pull of the second user's absent row omitted preferences and left the
  database row count at zero;
- a later page omitted preferences while retaining the existing numeric
  `syncTime` contract;
- a recursively local-only adult key returned `VALIDATION_FAILED`; the stored
  documents contained no adult, safeword, local-generation, or legacy-migration
  key;
- malformed bearer syntax returned 401;
- complete request bytes 524,288 returned 200 and 524,289 returned 413;
- a raw section of 262,144 bytes returned 200 and 262,145 returned
  `SECTION_TOO_LARGE`.

The post-smoke database audit found exactly one owner preference row, zero
absent-user rows, all five revisions equal to 1, and no local-only key stored.
Cleanup removed both disposable Auth users and their related subscription and
profile rows; the cleanup audit returned zero users, subscriptions, and local
profiles. Preview Edge logs independently recorded the version-2 invocations.

Fresh preview advisor reads reported zero findings mentioning
`public.local_profile_preferences`,
`public.local_profile_preference_section_canonical`, or
`public.mutate_local_profile_preference_section`. The preview is not globally
clean: the security advisor reported 26 existing findings (1 ERROR, 25 WARN),
and the performance advisor reported 144 existing findings (103 WARN, 41
INFO), all outside the target objects.

All PR #88 checks passed after `caee554`, including CI, Biome, TypeScript,
Vitest, Playwright, production build, Edge Function Deno check, both sync Node
matrix jobs, migration clean-apply, GitGuardian, Cloudflare preview, and
Supabase Preview. The three Gemini review threads were fixed in `caee554`,
replied to, independently re-reviewed as clean, and resolved.

The repository's existing `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_PROD_PROJECT_REF` secrets were then used only to resolve and prove
the exact nondefault child preview. The resolver rejected production/default,
cross-parent, wrong-Git-branch, and unhealthy targets; masked the retrieved
preview keys before exporting them; and never consumed the production database
password. The dedicated `SYNC_STAGING_*` credential path remains supported.

The first two live workflow attempts exposed test-harness defects rather than
function defects. Public signup hit Auth limits; after switching to
service-role provisioning, the legacy fixture generator still emitted
non-UUID entity IDs and the live command ran mock-only assertions against the
real service. Commit `47a18d2` corrected the fixture contract and bounded live
mode to two real-service smoke cases using one disposable preview user. The
complete fault-injection and mock-contract suite remains under
`npm run test:sync` and passed 329 tests with 19 designed skips.

Live workflow run
[`29506765765`](https://github.com/9thLevelSoftware/phoenix-portal/actions/runs/29506765765)
then passed on commit `47a18d2`: preview credential resolution, ordinary legacy
push/pull, strict workout-hierarchy push/pull, always-run cleanup, and artifact
handling all completed successfully. The logs identified only preview ref
`otygdxrzhlzooychegzb`; keys remained masked. An independent post-run preview
query returned zero `sync-test-*@test.local` Auth users, zero matching
subscriptions, and zero matching local profiles. No production query,
mutation, function deployment, or test invocation occurred.

The preview integration redeployed all 22 isolated-preview functions at
version 7 for the final implementation push. `mobile-sync-push` and
`mobile-sync-pull` are active with their intentional `verify_jwt = false`
handler-owned authentication boundary. All PR checks for implementation commit
`47a18d2` passed, including Supabase Preview, both sync Node jobs, Sync
Validation, clean database apply, Deno, TypeScript, Vitest, Playwright, Biome,
build, dependency/security, and Cloudflare gates. All review threads remain
resolved.

## PR disposition

The profile-preference feature added no local, preview, or production advisor
finding on its target table or functions. PR #88 merged after its Edge
implementation, preview smoke, fail-closed live workflow, and cleanup audit
completed. The final mobile backend-ready decision is now governed by the
Task 11 reconciliation evidence below.

## Task 11 production preflight reconciliation

The main-only production migration-drift workflow
[`29507101015`](https://github.com/9thLevelSoftware/phoenix-portal/actions/runs/29507101015)
passed immediately before Edge Function PR #88 merged. Read-only production
catalog checks confirmed migration `20260715234034`, the preference table,
both invoker-security functions with empty search paths, and the intended table
ACL boundary. PR #88 then squash-merged as `49a36eab`; protected production
deployment run
[`29507381498`](https://github.com/9thLevelSoftware/phoenix-portal/actions/runs/29507381498)
passed from `main`. `mobile-sync-push` version 133 and
`mobile-sync-pull` version 127 became active with handler-owned authentication.

The designated production smoke did not use a real user account. Its first
disposable public signup failed with HTTP 500 and left no Auth row. Read-only
catalog diagnosis found a legacy `PRIMARY KEY (id)` on
`public.local_profiles`, even though migration `20260321120000` declares
`PRIMARY KEY (user_id, id)`. The existing `handle_new_user()` trigger inserts
the mobile sentinel `id = 'default'` for every account, so the global key makes
that trigger fail after one default row. Aggregate-only evidence at discovery
time was 144 Auth users, 2 local-profile rows, 1 default row, and 143 users
missing their default parent. No real-user identity or preference payload was
read.

Migration `20260716151000_fix_local_profiles_composite_primary_key.sql`
repairs only the recognized legacy key shape. It fails closed on unexpected
primary-key or foreign-key catalogs, rebinds all six composite foreign keys to
the intended composite primary key, backfills missing default profiles, and
reasserts the signup trigger. Fresh replay and 39 pgTAP assertions pass. A
disposable local legacy-shape simulation proved the transition from one global
default to per-user defaults and verified a subsequent signup creates its own
default row.

Draft PR #89 created isolated preview `bfgpylzbilgouskczcen`. The preview
recorded migration `20260716151000`, reported the exact composite primary key
and all six referencing foreign keys, and allowed two disposable Auth users to
receive separate `id = 'default'` rows through the real trigger. Cleanup
audited zero remaining fixture users and local profiles. Production smoke and
the mobile backend-ready gate remain paused until PR #89 passes final review,
merges, and deploys through the normal migration pipeline.
