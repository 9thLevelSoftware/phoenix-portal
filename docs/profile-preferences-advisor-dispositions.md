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

## PR disposition

The feature adds no local, preview, or production advisor error or warning on
the target table or functions. The migration is deployed and verified in both
fresh preview and production, including production no-drift evidence. The
unrelated non-clean baselines above remain visible for follow-up in their own
scope. Edge implementation remains a later task.
