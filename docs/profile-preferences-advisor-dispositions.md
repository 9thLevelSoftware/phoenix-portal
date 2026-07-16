# Profile Preference Advisor Dispositions

Initially captured 2026-07-15 at 20:50 EDT and updated after PR #86 deployed
to production at 22:11 EDT. The reviewed PR head was `8b635b9`; the production
squash/deployment SHA is `1b5d9ca`. This record separates the feature-object
result from unrelated baseline findings. It does not describe the local
database or any remote environment as globally clean.

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

## PR disposition

The feature adds no local, preview, or production advisor error or warning on
the target table or functions. The migration is deployed and verified in both
fresh preview and production, including production no-drift evidence. The
unrelated non-clean baselines above remain visible for follow-up in their own
scope. Edge implementation remains a later task.
