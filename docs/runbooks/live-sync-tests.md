# Live sync tests

Live `Sync Tests` runs are manual dispatches from protected `main` with
`use_mocks=false`. The `sync-tests-live` job asserts the ref before checkout and
uses the `sync-live-staging` GitHub Environment. Mock jobs receive no environment
or live credentials.

Before enabling live runs, the operator must configure that environment:

- Restrict deployment branches to `main`, require an independent reviewer, and
  prevent self-review and administrator bypass where supported.
- Store `SYNC_STAGING_SUPABASE_URL`, `SYNC_STAGING_SUPABASE_ANON_KEY`,
  `SYNC_STAGING_SUPABASE_SERVICE_ROLE_KEY`, and `SYNC_STAGING_PROJECT_REF` as
  environment secrets for an isolated staging project with no production data.
- Set `SUPABASE_PROD_PROJECT_REF` as an environment variable (nonsecret project
  metadata) so the resolver and cleanup retain their production-target guard.
- Remove the corresponding staging credentials from repository and organization
  secret scopes accessible to contributor-controlled workflows. Audit other
  workflows before removing any shared general token; this workflow does not use
  a Supabase Management API token or production credentials.

The resolver requires dedicated staging credentials in this workflow and cannot
fall back to Management API discovery. The dispatch project-ref input must match
the configured staging ref. Its local Management API mode remains available to
existing operator tooling.

Environment protection and secret scoping are external configuration gates;
repository tests cannot prove they are configured. Verify a non-main live
dispatch skips the live job before approval or checkout, then verify a main
dispatch requires independent approval. No workflow dispatch or external
configuration is performed by the source change itself.
