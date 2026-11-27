-- User-configurable data sharing: outbound webhooks (FLAME and above).
--
-- A user registers HTTPS endpoints they control and the portal POSTs their own
-- data there as signed JSON events. This migration is the database half and is
-- inert on its own: with no row in webhook_endpoints every capture trigger
-- returns at once and the delivery job is created INACTIVE.
--
--   1. public.webhook_endpoints: browser-readable endpoint metadata. Owner
--      SELECT only; every write goes through the `webhook-endpoints` Edge
--      Function with the service role (URL validation, secret generation and
--      the tier gate cannot be done under RLS).
--   2. public.webhook_endpoint_secrets: service-only. The signing secret and
--      the optional custom header value, AES-GCM ciphertext written by the
--      Edge Function (`enc:v1:`, _shared/oauthTokenCrypto.ts). The same split
--      as user_integrations / oauth_tokens: no browser role can read it.
--   3. public.webhook_deliveries: the outbox and the delivery log. A row is a
--      thin reference (endpoint, entity, entity id), never a copy of user
--      data; the worker builds the payload from the current row at send time.
--      The composite FK (endpoint_id, user_id) -> webhook_endpoints
--      (id, user_id) makes it impossible to pair one user's entity with
--      another user's endpoint (FP-1).
--   4. private.webhook_entity_sources: which table feeds which entity and
--      scope. The backfill reads it directly. The capture triggers are
--      built FROM it by private.sync_webhook_capture_triggers(), and a
--      trigger's arguments are frozen when it is created: a later migration
--      that edits a row MUST call that function again, or the triggers keep
--      the old values. webhook_data_sharing.test.sql fails when a trigger's
--      arguments differ from its row. supabase/functions/_shared/
--      dataSharingScopes.ts mirrors the table for the payload builder
--      (parity: tests/security/data-sharing-scopes.test.ts).
--   5. private.enqueue_webhook_deliveries(): statement-level capture trigger
--      on every source table. Triggers, not a hook in mobile-sync-push, so
--      both SYNC_LWW_ENABLED paths, the push transaction, portal PostgREST
--      writes and RPCs are all covered by one mechanism. An enqueue error is
--      downgraded to a WARNING: a webhook must never abort a sync write
--      (FP-3); "Resend all" (enqueue_webhook_backfill) is the recovery path.
--   6. Service-role RPCs: create_webhook_endpoint,
--      rotate_webhook_signing_secret, set_webhook_endpoint_header,
--      claim_webhook_deliveries (FOR UPDATE SKIP LOCKED),
--      complete_webhook_delivery, enqueue_webhook_backfill.
--   7. pg_cron: `deliver-webhooks` every minute through
--      private.invoke_edge_function, created INACTIVE (the Edge Function does
--      not exist yet), and a daily retention job.
--
-- Not shared, by design: raw telemetry, the INFERNO-gated biomechanics tables
-- (session_phase_statistics, vbt_assessments, exercise_signatures: a FLAME
-- webhook must not carry data its owner cannot read in the portal, FP-2),
-- Strava-sourced external activities, community rows, billing and internal
-- sync state. See dataSharingScopes.ts.
--
-- Idempotent: safe to re-run. Re-applying never flips a cron job's `active`
-- flag and re-issues every grant.
--
-- Operator, applying this file: it creates three triggers on each of the
-- busiest tables (workout_sessions, exercises, personal_records, routines,
-- ...), and each CREATE TRIGGER needs a brief lock that waits behind any
-- write in progress. Run it, and its BEGIN ... ROLLBACK rehearsal, at low
-- traffic. A `lock_timeout` failure is a clean retry: the file is one
-- transaction, so nothing was applied.
--
-- Operator, after the `deliver-webhooks` Edge Function is deployed:
--   SELECT cron.alter_job(
--     (SELECT jobid FROM cron.job WHERE jobname = 'deliver-webhooks'),
--     active := true);
--   Setting active := false again is the kill switch for all deliveries.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Endpoint metadata (browser-readable, server-written).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL
    CONSTRAINT webhook_endpoints_label_check
    CHECK (char_length(label) BETWEEN 1 AND 80),
  url text NOT NULL
    CONSTRAINT webhook_endpoints_url_check
    CHECK (char_length(url) <= 2048 AND url ~ '^https://[^[:space:]]+$'),
  scopes text[] NOT NULL
    CONSTRAINT webhook_endpoints_scopes_check
    CHECK (
      cardinality(scopes) BETWEEN 1 AND 9
      AND scopes <@ ARRAY[
        'workouts', 'personal_records', 'routines', 'cycles', 'goals',
        'progress', 'achievements', 'external_activities', 'profile'
      ]::text[]
    ),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT webhook_endpoints_status_check
    CHECK (status IN ('active', 'paused', 'disabled')),
  -- Why the endpoint is not active. Fixed codes only: the browser reads this.
  disabled_reason text
    CONSTRAINT webhook_endpoints_disabled_reason_check
    CHECK (disabled_reason IN (
      'user_paused', 'subscription_lapsed', 'too_many_failures', 'endpoint_gone'
    )),
  custom_header_name text
    CONSTRAINT webhook_endpoints_custom_header_name_check
    CHECK (custom_header_name ~ '^[A-Za-z][A-Za-z0-9-]{0,63}$'),
  -- Last characters of the signing secret, so the user can tell two apart.
  signing_key_hint text NOT NULL
    CONSTRAINT webhook_endpoints_signing_key_hint_check
    CHECK (char_length(signing_key_hint) BETWEEN 1 AND 8),
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_endpoints_id_user_key UNIQUE (id, user_id),
  CONSTRAINT webhook_endpoints_reason_matches_status
    CHECK ((status = 'active') = (disabled_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS webhook_endpoints_user_idx
  ON public.webhook_endpoints (user_id);

-- Every write to a shared table first asks "does any active endpoint share
-- this scope?" (private.enqueue_webhook_deliveries). This keeps that probe
-- off a sequential scan as the table grows.
CREATE INDEX IF NOT EXISTS webhook_endpoints_active_scopes_idx
  ON public.webhook_endpoints USING gin (scopes)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS webhook_endpoints_updated_at ON public.webhook_endpoints;
CREATE TRIGGER webhook_endpoints_updated_at
  BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own webhook endpoints" ON public.webhook_endpoints;
CREATE POLICY "Users can view own webhook endpoints" ON public.webhook_endpoints
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- TRUNCATE is not subject to RLS, so revoke every browser-role privilege
-- except SELECT.
REVOKE ALL ON TABLE public.webhook_endpoints FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.webhook_endpoints TO authenticated;
GRANT ALL ON TABLE public.webhook_endpoints TO service_role;

COMMENT ON TABLE public.webhook_endpoints IS
  'User-registered outbound webhook endpoints (data sharing, FLAME+). Owner SELECT; written only by the webhook-endpoints Edge Function. 20261106120000.';

-- ---------------------------------------------------------------------------
-- 2. Endpoint secrets (service-only).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_endpoint_secrets (
  endpoint_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signing_secret_enc text NOT NULL,
  -- The secret replaced by the last rotation, still signed with until
  -- previous_expires_at so a receiver can switch over without dropping events.
  previous_signing_secret_enc text,
  previous_expires_at timestamptz,
  custom_header_value_enc text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_endpoint_secrets_endpoint_fkey
    FOREIGN KEY (endpoint_id, user_id)
    REFERENCES public.webhook_endpoints (id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.webhook_endpoint_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.webhook_endpoint_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webhook_endpoint_secrets TO service_role;

COMMENT ON TABLE public.webhook_endpoint_secrets IS
  'Signing secrets and custom header values for webhook_endpoints, as enc:v1: AES-GCM ciphertext. Service role only; no browser policy or grant. 20261106120000.';

-- ---------------------------------------------------------------------------
-- 3. Outbox and delivery log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL,
  user_id uuid NOT NULL,
  entity text NOT NULL
    CONSTRAINT webhook_deliveries_entity_check
    CHECK (entity IN (
      'workout', 'personal_record', 'routine', 'cycle', 'goal',
      'exercise_progress', 'badge', 'gamification_stats',
      'rpg_attributes', 'external_activity', 'profile', 'local_profile', 'ping'
    )),
  entity_id text NOT NULL
    CONSTRAINT webhook_deliveries_entity_id_check
    CHECK (char_length(entity_id) BETWEEN 1 AND 200),
  -- Resolved by the worker at send time: '<entity>.updated' / '<entity>.deleted'.
  event_type text,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT webhook_deliveries_status_check
    CHECK (status IN ('pending', 'delivering', 'delivered', 'dead', 'skipped')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  last_status_code integer,
  -- A fixed code, never a provider message: the owner reads this through RLS.
  last_error_code text
    CONSTRAINT webhook_deliveries_error_code_check
    CHECK (last_error_code ~ '^[a-z0-9_]{1,64}$'),
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT webhook_deliveries_endpoint_fkey
    FOREIGN KEY (endpoint_id, user_id)
    REFERENCES public.webhook_endpoints (id, user_id) ON DELETE CASCADE
);

-- Coalescing: at most one pending delivery per endpoint and entity. A second
-- change while one is waiting is a no-op, because the worker sends the
-- current row anyway.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_one_pending
  ON public.webhook_deliveries (endpoint_id, entity, entity_id)
  WHERE status = 'pending';

-- The claim.
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON public.webhook_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'delivering');

-- The owner's delivery-log read and the ON DELETE CASCADE lookup.
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_created_idx
  ON public.webhook_deliveries (endpoint_id, created_at DESC);

CREATE INDEX IF NOT EXISTS webhook_deliveries_user_idx
  ON public.webhook_deliveries (user_id);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own webhook deliveries" ON public.webhook_deliveries;
CREATE POLICY "Users can view own webhook deliveries" ON public.webhook_deliveries
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.webhook_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.webhook_deliveries TO authenticated;
GRANT ALL ON TABLE public.webhook_deliveries TO service_role;

COMMENT ON TABLE public.webhook_deliveries IS
  'Outbox and delivery log for webhook_endpoints. Thin references only; payloads are built at send time. Owner SELECT; written by capture triggers and the service role. 20261106120000.';

-- ---------------------------------------------------------------------------
-- 4. Entity sources: which table feeds which entity and scope.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.webhook_entity_sources (
  source_table text PRIMARY KEY,
  scope text NOT NULL,
  entity text NOT NULL,
  -- true: the entity's own table. false: a child whose change means "the
  -- parent entity changed".
  is_root boolean NOT NULL,
  -- Column of source_table holding the entity id.
  id_column text NOT NULL,
  -- Column of source_table holding the owner; NULL when the owner is only on
  -- the parent (then parent_table.user_id via id_column -> parent_table.id).
  user_column text,
  parent_table text,
  -- Optional predicate over alias `c` (the changed / scanned rows).
  row_filter text,
  -- Extra predicate for the backfill only (alias `c`).
  backfill_filter text,
  CONSTRAINT webhook_entity_sources_owner_check
    CHECK ((user_column IS NULL) <> (parent_table IS NULL))
);

ALTER TABLE private.webhook_entity_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.webhook_entity_sources
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO private.webhook_entity_sources
  (source_table, scope, entity, is_root, id_column, user_column, parent_table,
   row_filter, backfill_filter)
VALUES
  ('workout_sessions',         'workouts',            'workout',            true,  'id',         'user_id', NULL, NULL, NULL),
  -- replace_session_children rewrites the children without touching the
  -- parent row, so the session trigger alone would miss it.
  -- `sets` and `rep_summaries` travel in the workout payload but are not
  -- sources: no browser role can write them, and every server writer
  -- rewrites `exercises` in the same call, which is captured here.
  -- webhook_data_sharing.test.sql fails if a browser role gains a write
  -- grant on either, because that would open a path this does not see.
  ('exercises',                'workouts',            'workout',            false, 'session_id', 'user_id', NULL, NULL, NULL),
  -- Soft-deleted records are sent as personal_record.deleted when the delete
  -- happens; a backfill does not replay old deletions.
  ('personal_records',         'personal_records',    'personal_record',    true,  'id',         'user_id', NULL, NULL, 'c.deleted_at IS NULL'),
  ('routines',                 'routines',            'routine',            true,  'id',         'user_id', NULL, NULL, NULL),
  ('routine_exercises',        'routines',            'routine',            false, 'routine_id', NULL, 'routines', NULL, NULL),
  ('training_cycles',          'cycles',              'cycle',              true,  'id',         'user_id', NULL, NULL, NULL),
  ('cycle_days',               'cycles',              'cycle',              false, 'cycle_id',   NULL, 'training_cycles', NULL, NULL),
  ('user_goals',               'goals',               'goal',               true,  'id',         'user_id', NULL, NULL, NULL),
  ('exercise_progress',        'progress',            'exercise_progress',  true,  'id',         'user_id', NULL, NULL, NULL),
  ('earned_badges',            'achievements',        'badge',              true,  'id',         'user_id', NULL, NULL, NULL),
  ('gamification_stats',       'achievements',        'gamification_stats', true,  'id',         'user_id', NULL, NULL, NULL),
  ('rpg_attributes',           'achievements',        'rpg_attributes',     true,  'id',         'user_id', NULL, NULL, NULL),
  -- Strava's API terms restrict onward disclosure of Strava data, so those
  -- rows never leave through a webhook.
  ('external_activities',      'external_activities', 'external_activity',  true,  'id',         'user_id', NULL, 'c.provider IS DISTINCT FROM ''strava''', NULL),
  -- profiles.id is the auth user id.
  ('profiles',                 'profile',             'profile',            true,  'id',         'id',      NULL, NULL, NULL),
  ('local_profiles',           'profile',             'local_profile',      true,  'id',         'user_id', NULL, NULL, NULL)
ON CONFLICT (source_table) DO UPDATE SET
  scope = EXCLUDED.scope,
  entity = EXCLUDED.entity,
  is_root = EXCLUDED.is_root,
  id_column = EXCLUDED.id_column,
  user_column = EXCLUDED.user_column,
  parent_table = EXCLUDED.parent_table,
  row_filter = EXCLUDED.row_filter,
  backfill_filter = EXCLUDED.backfill_filter;

-- ---------------------------------------------------------------------------
-- 5. Capture trigger.
--    TG_ARGV: scope, entity, id column, user column ('' = via parent),
--    parent table ('' = none), row filter ('' = none). The arguments are
--    literals written by this migration from the table above, never user input.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enqueue_webhook_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c_scope CONSTANT text := TG_ARGV[0];
  c_entity CONSTANT text := TG_ARGV[1];
  c_id_column CONSTANT text := TG_ARGV[2];
  c_user_column CONSTANT text := NULLIF(TG_ARGV[3], '');
  c_parent_table CONSTANT text := NULLIF(TG_ARGV[4], '');
  c_row_filter CONSTANT text := NULLIF(TG_ARGV[5], '');
  v_sql text;
BEGIN
  -- Nobody shares this scope: one probe of the partial GIN index
  -- (webhook_endpoints_active_scopes_idx) and leave. `@>` rather than
  -- `= ANY` because only the former can use that index.
  IF NOT EXISTS (
    SELECT 1 FROM public.webhook_endpoints e
    WHERE e.status = 'active' AND e.scopes @> ARRAY[c_scope]
  ) THEN
    RETURN NULL;
  END IF;

  -- A webhook must never abort the user's write (FP-3): anything that goes
  -- wrong below is logged and dropped. enqueue_webhook_backfill recovers.
  BEGIN
    v_sql :=
      'INSERT INTO public.webhook_deliveries '
      || '(endpoint_id, user_id, entity, entity_id, next_attempt_at) '
      || 'SELECT DISTINCT e.id, e.user_id, $1, '
      || pg_catalog.format('c.%I::text', c_id_column)
      -- 20 s for a multi-statement write (parent, then children) to settle.
      || ', pg_catalog.now() + interval ''20 seconds'' FROM changed_rows c ';

    IF c_user_column IS NOT NULL THEN
      v_sql := v_sql || pg_catalog.format(
        'JOIN public.webhook_endpoints e ON e.user_id = c.%I ', c_user_column);
    ELSE
      v_sql := v_sql || pg_catalog.format(
        'JOIN public.%I p ON p.id = c.%I '
        || 'JOIN public.webhook_endpoints e ON e.user_id = p.user_id ',
        c_parent_table, c_id_column);
    END IF;

    v_sql := v_sql
      || 'WHERE e.status = ''active'' AND $2 = ANY (e.scopes) '
      || pg_catalog.format('AND c.%I IS NOT NULL ', c_id_column);

    IF c_row_filter IS NOT NULL THEN
      v_sql := v_sql || 'AND (' || c_row_filter || ') ';
    END IF;

    v_sql := v_sql
      || 'ON CONFLICT (endpoint_id, entity, entity_id) '
      || 'WHERE status = ''pending'' DO NOTHING';

    EXECUTE v_sql USING c_entity, c_scope;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook capture failed on %.% (%): %',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLSTATE, SQLERRM;
  END;

  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION private.enqueue_webhook_deliveries()
  FROM PUBLIC, anon, authenticated, service_role;

-- Builds the capture triggers from private.webhook_entity_sources. One
-- trigger per event, because a transition table belongs to a single event.
-- Idempotent, and it removes capture triggers from tables that are no longer
-- a source. Call it again from any migration that changes that table.
CREATE OR REPLACE FUNCTION private.sync_webhook_capture_triggers()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s record;
  stale record;
  v_args text;
BEGIN
  FOR stale IN
    SELECT c.relname AS table_name, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname IN ('webhook_capture_insert', 'webhook_capture_update', 'webhook_capture_delete')
      AND c.relname NOT IN (SELECT source_table FROM private.webhook_entity_sources)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', stale.tgname, stale.table_name);
  END LOOP;

  FOR s IN SELECT * FROM private.webhook_entity_sources ORDER BY source_table LOOP
    IF to_regclass(format('public.%I', s.source_table)) IS NULL THEN
      RAISE NOTICE 'webhook capture: public.% does not exist; skipped', s.source_table;
      CONTINUE;
    END IF;

    v_args := format('%L, %L, %L, %L, %L, %L',
      s.scope, s.entity, s.id_column, COALESCE(s.user_column, ''),
      COALESCE(s.parent_table, ''), COALESCE(s.row_filter, ''));

    EXECUTE format(
      'DROP TRIGGER IF EXISTS webhook_capture_insert ON public.%I', s.source_table);
    EXECUTE format(
      'CREATE TRIGGER webhook_capture_insert AFTER INSERT ON public.%I '
      || 'REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT '
      || 'EXECUTE FUNCTION private.enqueue_webhook_deliveries(%s)',
      s.source_table, v_args);

    EXECUTE format(
      'DROP TRIGGER IF EXISTS webhook_capture_update ON public.%I', s.source_table);
    EXECUTE format(
      'CREATE TRIGGER webhook_capture_update AFTER UPDATE ON public.%I '
      || 'REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT '
      || 'EXECUTE FUNCTION private.enqueue_webhook_deliveries(%s)',
      s.source_table, v_args);

    EXECUTE format(
      'DROP TRIGGER IF EXISTS webhook_capture_delete ON public.%I', s.source_table);
    EXECUTE format(
      'CREATE TRIGGER webhook_capture_delete AFTER DELETE ON public.%I '
      || 'REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT '
      || 'EXECUTE FUNCTION private.enqueue_webhook_deliveries(%s)',
      s.source_table, v_args);
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION private.sync_webhook_capture_triggers()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.sync_webhook_capture_triggers();

-- ---------------------------------------------------------------------------
-- 6. Endpoint writers. Service role only; SECURITY INVOKER (the service role
--    already owns every privilege they need).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_webhook_endpoint(
  p_user_id uuid,
  p_label text,
  p_url text,
  p_scopes text[],
  p_signing_secret_enc text,
  p_signing_key_hint text,
  p_custom_header_name text DEFAULT NULL,
  p_custom_header_value_enc text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  c_max_endpoints CONSTANT integer := 3;
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_signing_secret_enc IS NULL THEN
    RAISE EXCEPTION 'webhook_endpoint_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_custom_header_name IS NULL) <> (p_custom_header_value_enc IS NULL) THEN
    RAISE EXCEPTION 'webhook_endpoint_header_incomplete' USING ERRCODE = '22023';
  END IF;

  -- Serialise creates per user so two concurrent requests cannot both pass
  -- the count check.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('webhook_endpoints:' || p_user_id::text, 0));

  IF (SELECT count(*) FROM public.webhook_endpoints e WHERE e.user_id = p_user_id)
     >= c_max_endpoints THEN
    RAISE EXCEPTION 'webhook_endpoint_limit' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.webhook_endpoints
    (user_id, label, url, scopes, signing_key_hint, custom_header_name)
  VALUES
    (p_user_id, p_label, p_url, p_scopes, p_signing_key_hint, p_custom_header_name)
  RETURNING id INTO v_id;

  INSERT INTO public.webhook_endpoint_secrets
    (endpoint_id, user_id, signing_secret_enc, custom_header_value_enc)
  VALUES
    (v_id, p_user_id, p_signing_secret_enc, p_custom_header_value_enc);

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.create_webhook_endpoint(uuid, text, text, text[], text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_webhook_endpoint(uuid, text, text, text[], text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.create_webhook_endpoint(uuid, text, text, text[], text, text, text, text) IS
  'Creates a webhook endpoint and its secret row in one transaction; at most 3 per user (P0001 webhook_endpoint_limit). Secrets arrive already encrypted. Service role only.';

CREATE OR REPLACE FUNCTION public.rotate_webhook_signing_secret(
  p_user_id uuid,
  p_endpoint_id uuid,
  p_signing_secret_enc text,
  p_signing_key_hint text,
  p_overlap_seconds integer DEFAULT 86400
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_signing_secret_enc IS NULL THEN
    RAISE EXCEPTION 'webhook_endpoint_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.webhook_endpoint_secrets s
  SET previous_signing_secret_enc = s.signing_secret_enc,
      previous_expires_at = pg_catalog.now() + pg_catalog.make_interval(
        secs => greatest(0, least(coalesce(p_overlap_seconds, 86400), 604800))),
      signing_secret_enc = p_signing_secret_enc,
      updated_at = pg_catalog.now()
  WHERE s.endpoint_id = p_endpoint_id
    AND s.user_id = p_user_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.webhook_endpoints e
  SET signing_key_hint = p_signing_key_hint
  WHERE e.id = p_endpoint_id
    AND e.user_id = p_user_id;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.rotate_webhook_signing_secret(uuid, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_signing_secret(uuid, uuid, text, text, integer)
  TO service_role;

COMMENT ON FUNCTION public.rotate_webhook_signing_secret(uuid, uuid, text, text, integer) IS
  'Replaces an endpoint''s signing secret and keeps the old one valid for the overlap (default 24 h, max 7 d). Scoped by user. Service role only.';

CREATE OR REPLACE FUNCTION public.set_webhook_endpoint_header(
  p_user_id uuid,
  p_endpoint_id uuid,
  p_custom_header_name text DEFAULT NULL,
  p_custom_header_value_enc text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF (p_custom_header_name IS NULL) <> (p_custom_header_value_enc IS NULL) THEN
    RAISE EXCEPTION 'webhook_endpoint_header_incomplete' USING ERRCODE = '22023';
  END IF;

  UPDATE public.webhook_endpoints e
  SET custom_header_name = p_custom_header_name
  WHERE e.id = p_endpoint_id
    AND e.user_id = p_user_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.webhook_endpoint_secrets s
  SET custom_header_value_enc = p_custom_header_value_enc,
      updated_at = pg_catalog.now()
  WHERE s.endpoint_id = p_endpoint_id
    AND s.user_id = p_user_id;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.set_webhook_endpoint_header(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_webhook_endpoint_header(uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.set_webhook_endpoint_header(uuid, uuid, text, text) IS
  'Sets or clears (both NULL) an endpoint''s custom header name and encrypted value together. Scoped by user. Service role only.';

-- ---------------------------------------------------------------------------
-- 7. Claim. The repo's first FOR UPDATE SKIP LOCKED queue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_webhook_deliveries(
  p_limit integer DEFAULT 100,
  p_per_endpoint integer DEFAULT 30,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE (
  delivery_id uuid,
  delivery_endpoint_id uuid,
  delivery_user_id uuid,
  delivery_entity text,
  delivery_entity_id text,
  delivery_attempt integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_limit CONSTANT integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_per_endpoint CONSTANT integer := greatest(1, least(coalesce(p_per_endpoint, 30), 200));
  v_lease CONSTANT interval := pg_catalog.make_interval(
    secs => greatest(30, least(coalesce(p_lease_seconds, 180), 3600)));
BEGIN
  -- Paid capability is enforced by the tier actually paid for (FP-2). An
  -- endpoint whose owner is no longer FLAME+ is paused here, with a reason the
  -- owner can read, and its waiting rows are closed. The capture trigger only
  -- enqueues for active endpoints, so a downgraded account cannot grow the
  -- outbox for ever. subscription_tier_for already applies the past_due and
  -- 48 h renewal grace rules.
  WITH due_endpoints AS MATERIALIZED (
    SELECT e.id, public.subscription_tier_for(e.user_id) AS tier
    FROM public.webhook_endpoints e
    WHERE e.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.webhook_deliveries d
        WHERE d.endpoint_id = e.id
          AND d.status = 'pending'
          AND d.next_attempt_at <= pg_catalog.now()
      )
  ),
  paused AS (
    UPDATE public.webhook_endpoints e
    SET status = 'paused', disabled_reason = 'subscription_lapsed'
    FROM due_endpoints de
    WHERE e.id = de.id
      AND e.status = 'active'
      AND de.tier NOT IN ('FLAME', 'INFERNO')
    RETURNING e.id
  )
  UPDATE public.webhook_deliveries d
  SET status = 'skipped',
      last_error_code = 'subscription_lapsed',
      finished_at = pg_catalog.now()
  FROM paused
  WHERE d.endpoint_id = paused.id
    AND d.status = 'pending';

  RETURN QUERY
  WITH ranked AS (
    SELECT d.id,
           d.next_attempt_at,
           pg_catalog.row_number() OVER (
             PARTITION BY d.endpoint_id ORDER BY d.next_attempt_at, d.id
           ) AS rn
    FROM public.webhook_deliveries d
    JOIN public.webhook_endpoints e ON e.id = d.endpoint_id
    WHERE e.status = 'active'
      AND (
        (d.status = 'pending' AND d.next_attempt_at <= pg_catalog.now())
        -- A worker that died mid-send: its lease has run out.
        OR (d.status = 'delivering' AND d.claimed_at < pg_catalog.now() - v_lease)
      )
  ),
  picked AS (
    SELECT d.id
    FROM public.webhook_deliveries d
    JOIN ranked r ON r.id = d.id
    WHERE r.rn <= v_per_endpoint
      -- Restated on the locked row itself: under READ COMMITTED a row another
      -- worker claimed after our snapshot is re-read after the lock wait, and
      -- only predicates on `d` are re-checked.
      AND (
        (d.status = 'pending' AND d.next_attempt_at <= pg_catalog.now())
        OR (d.status = 'delivering' AND d.claimed_at < pg_catalog.now() - v_lease)
      )
    ORDER BY r.next_attempt_at, d.id
    LIMIT v_limit
    FOR UPDATE OF d SKIP LOCKED
  )
  UPDATE public.webhook_deliveries d
  SET status = 'delivering',
      claimed_at = pg_catalog.now(),
      attempt_count = d.attempt_count + 1
  FROM picked
  WHERE d.id = picked.id
  RETURNING d.id, d.endpoint_id, d.user_id, d.entity, d.entity_id, d.attempt_count;
END
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_deliveries(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_deliveries(integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_webhook_deliveries(integer, integer, integer) IS
  'Claims due webhook deliveries (FOR UPDATE SKIP LOCKED, capped per endpoint) for active endpoints, after pausing endpoints whose owner is below FLAME. Returns the claim generation as delivery_attempt. Service role only.';

-- ---------------------------------------------------------------------------
-- 8. Completion. Fenced by (status = delivering, attempt) so a worker whose
--    lease expired cannot overwrite the newer claim's result.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_webhook_delivery(
  p_delivery_id uuid,
  p_attempt integer,
  p_outcome text,
  p_event_type text DEFAULT NULL,
  p_status_code integer DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  -- Wait after the Nth failed attempt. Nine attempts over about 46 hours.
  c_backoff_seconds CONSTANT integer[] :=
    ARRAY[60, 300, 900, 3600, 10800, 21600, 43200, 86400];
  c_max_attempts CONSTANT integer := 9;
  v_row public.webhook_deliveries%ROWTYPE;
  v_status text;
  v_error text := p_error_code;
  v_wait integer;
  v_next timestamptz;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('delivered', 'failed', 'gone', 'skipped') THEN
    RAISE EXCEPTION 'webhook_delivery_outcome_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.webhook_deliveries d
  WHERE d.id = p_delivery_id
    AND d.status = 'delivering'
    AND d.attempt_count = p_attempt
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_outcome = 'delivered' THEN
    v_status := 'delivered';
  ELSIF p_outcome = 'skipped' THEN
    v_status := 'skipped';
  ELSIF p_outcome = 'gone' THEN
    v_status := 'dead';
  ELSIF v_row.attempt_count >= c_max_attempts THEN
    v_status := 'dead';
  ELSIF EXISTS (
    SELECT 1 FROM public.webhook_deliveries o
    WHERE o.endpoint_id = v_row.endpoint_id
      AND o.entity = v_row.entity
      AND o.entity_id = v_row.entity_id
      AND o.status = 'pending'
  ) THEN
    -- The entity changed again while this attempt was in flight and a newer
    -- row is already waiting. It will carry the current state; retrying this
    -- one would only collide with the one-pending index.
    v_status := 'skipped';
    v_error := 'superseded';
  ELSE
    v_status := 'pending';
    v_wait := c_backoff_seconds[least(v_row.attempt_count, pg_catalog.array_length(c_backoff_seconds, 1))];
    -- +/- 20 % jitter so a recovering receiver is not hit by every retry at once.
    v_wait := (v_wait * (0.8 + pg_catalog.random() * 0.4))::integer;
    IF p_retry_after_seconds IS NOT NULL AND p_retry_after_seconds > 0 THEN
      v_wait := greatest(v_wait, least(p_retry_after_seconds, 3600));
    END IF;
    v_next := pg_catalog.now() + pg_catalog.make_interval(secs => v_wait);
  END IF;

  BEGIN
    UPDATE public.webhook_deliveries d
    SET status = v_status,
        event_type = coalesce(p_event_type, d.event_type),
        last_status_code = p_status_code,
        last_error_code = v_error,
        duration_ms = p_duration_ms,
        next_attempt_at = coalesce(v_next, d.next_attempt_at),
        claimed_at = NULL,
        finished_at = CASE WHEN v_status = 'pending' THEN NULL ELSE pg_catalog.now() END
    WHERE d.id = v_row.id;
  EXCEPTION WHEN unique_violation THEN
    -- A capture trigger committed a pending row for the same entity between
    -- the EXISTS check above and this UPDATE (READ COMMITTED). Same outcome
    -- as finding it up front: the newer row carries the current state.
    v_status := 'skipped';
    UPDATE public.webhook_deliveries d
    SET status = 'skipped',
        event_type = coalesce(p_event_type, d.event_type),
        last_status_code = p_status_code,
        last_error_code = 'superseded',
        duration_ms = p_duration_ms,
        claimed_at = NULL,
        finished_at = pg_catalog.now()
    WHERE d.id = v_row.id;
  END;

  IF p_outcome = 'delivered' THEN
    UPDATE public.webhook_endpoints e
    SET consecutive_failures = 0,
        last_success_at = pg_catalog.now()
    WHERE e.id = v_row.endpoint_id;
  ELSIF p_outcome IN ('failed', 'gone') THEN
    -- A delivery that ran out of attempts, or a receiver that answered
    -- 410 Gone, switches the endpoint off. The owner sees why (FP-8) and has
    -- to pass a test delivery to switch it back on.
    UPDATE public.webhook_endpoints e
    SET consecutive_failures = e.consecutive_failures + 1,
        last_failure_at = pg_catalog.now(),
        status = CASE
          WHEN v_status = 'dead' AND e.status = 'active' THEN 'disabled'
          ELSE e.status END,
        disabled_reason = CASE
          WHEN v_status = 'dead' AND e.status = 'active' THEN
            CASE WHEN p_outcome = 'gone' THEN 'endpoint_gone' ELSE 'too_many_failures' END
          ELSE e.disabled_reason END
    WHERE e.id = v_row.endpoint_id;
  END IF;

  RETURN v_status;
END
$$;

REVOKE ALL ON FUNCTION public.complete_webhook_delivery(uuid, integer, text, text, integer, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_webhook_delivery(uuid, integer, text, text, integer, text, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.complete_webhook_delivery(uuid, integer, text, text, integer, text, integer, integer) IS
  'Records a delivery attempt (delivered | failed | gone | skipped), reschedules with backoff or marks it dead, and updates the endpoint counters. Returns the new status, NULL when the claim was lost. Service role only.';

-- ---------------------------------------------------------------------------
-- 9. Backfill ("Resend all"). DEFINER because `private` is unreachable for
--    the service role (same reason as set_insights_batch_cursor).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_webhook_backfill(
  p_user_id uuid,
  p_endpoint_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scopes text[];
  s record;
  v_sql text;
  v_rows integer;
  v_total integer := 0;
BEGIN
  SELECT e.scopes INTO v_scopes
  FROM public.webhook_endpoints e
  WHERE e.id = p_endpoint_id
    AND e.user_id = p_user_id
    AND e.status = 'active';

  IF v_scopes IS NULL THEN
    RETURN 0;
  END IF;

  FOR s IN
    SELECT * FROM private.webhook_entity_sources src
    WHERE src.is_root AND src.scope = ANY (v_scopes)
    ORDER BY src.source_table
  LOOP
    CONTINUE WHEN pg_catalog.to_regclass(pg_catalog.format('public.%I', s.source_table)) IS NULL;

    -- Every row is read with the endpoint owner's id: $2 is both the owner
    -- written to the delivery and the filter on the source table.
    v_sql := pg_catalog.format(
      'INSERT INTO public.webhook_deliveries (endpoint_id, user_id, entity, entity_id) '
      || 'SELECT $1, $2, $3, c.%I::text FROM public.%I c WHERE c.%I = $2',
      s.id_column, s.source_table, s.user_column);
    IF s.row_filter IS NOT NULL THEN
      v_sql := v_sql || ' AND (' || s.row_filter || ')';
    END IF;
    IF s.backfill_filter IS NOT NULL THEN
      v_sql := v_sql || ' AND (' || s.backfill_filter || ')';
    END IF;
    v_sql := v_sql
      || ' ON CONFLICT (endpoint_id, entity, entity_id) '
      || 'WHERE status = ''pending'' DO NOTHING';

    EXECUTE v_sql USING p_endpoint_id, p_user_id, s.entity;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;

  RETURN v_total;
END
$$;

REVOKE ALL ON FUNCTION public.enqueue_webhook_backfill(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_webhook_backfill(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.enqueue_webhook_backfill(uuid, uuid) IS
  'Enqueues one delivery per existing entity in an active endpoint''s scopes ("Resend all"). Scoped by the endpoint owner. Returns the number enqueued. Service role only.';

-- ---------------------------------------------------------------------------
-- 10. Retention: the log keeps 30 days.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prune_webhook_deliveries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.webhook_deliveries d
  WHERE d.created_at < pg_catalog.now() - interval '30 days'
    AND (
      d.status IN ('delivered', 'dead', 'skipped')
      -- Rows left waiting behind an endpoint that was never switched back on.
      OR EXISTS (
        SELECT 1 FROM public.webhook_endpoints e
        WHERE e.id = d.endpoint_id AND e.status <> 'active'
      )
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END
$$;

REVOKE ALL ON FUNCTION private.prune_webhook_deliveries()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. pg_cron jobs. Owner-only, idempotent; a re-apply never flips `active`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.schedule_webhook_jobs()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  j record;
  v_jobid bigint;
  v_schedule text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skip scheduling deliver-webhooks and retention jobs';
    RETURN;
  END IF;

  FOR j IN
    SELECT *
    FROM (VALUES
      ('deliver-webhooks', '* * * * *',
       'SELECT private.invoke_edge_function(''deliver-webhooks'', ''{}''::jsonb)'),
      ('webhook-deliveries-retention', '37 3 * * *',
       'SELECT private.prune_webhook_deliveries()')
    ) AS v(jobname, schedule, command)
  LOOP
    v_jobid := NULL;
    EXECUTE 'SELECT jobid, schedule, command FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1'
      INTO v_jobid, v_schedule, v_command
      USING j.jobname;

    IF v_jobid IS NULL THEN
      v_jobid := cron.schedule(j.jobname, j.schedule, j.command);
      IF j.jobname = 'deliver-webhooks' THEN
        -- The Edge Function ships in a later release; an active job would
        -- only collect 404s until then.
        PERFORM cron.alter_job(v_jobid, active := false);
        RAISE NOTICE 'deliver-webhooks scheduled INACTIVE; deploy the Edge Function, then activate with cron.alter_job(%, active := true)', v_jobid;
      END IF;
    ELSIF v_schedule IS DISTINCT FROM j.schedule OR v_command IS DISTINCT FROM j.command THEN
      PERFORM cron.alter_job(v_jobid, schedule := j.schedule, command := j.command);
    END IF;
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION private.schedule_webhook_jobs()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.schedule_webhook_jobs();

-- ---------------------------------------------------------------------------
-- 12. Self-check: nothing added here may be reachable from the browser beyond
--     the two owner SELECTs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(format('%s/%s', p.oid::regprocedure, r.rolname), ', ')
  INTO v_offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE (
      (n.nspname = 'public'
        AND p.proname IN ('create_webhook_endpoint', 'rotate_webhook_signing_secret',
                          'set_webhook_endpoint_header', 'claim_webhook_deliveries',
                          'complete_webhook_delivery', 'enqueue_webhook_backfill'))
      OR (n.nspname = 'private'
        AND p.proname IN ('enqueue_webhook_deliveries', 'prune_webhook_deliveries',
                          'schedule_webhook_jobs', 'sync_webhook_capture_triggers'))
    )
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'webhook data sharing: functions executable by %', v_offenders
      USING ERRCODE = '42501';
  END IF;

  SELECT string_agg(format('%s/%s/%s', t.relname, r.rolname, priv.name), ', ')
  INTO v_offenders
  FROM (VALUES ('public.webhook_endpoints'), ('public.webhook_endpoint_secrets'),
               ('public.webhook_deliveries'), ('private.webhook_entity_sources')) AS t(relname)
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS priv(name)
  WHERE has_table_privilege(r.rolname, t.relname, priv.name)
    AND NOT (
      r.rolname = 'authenticated'
      AND priv.name = 'SELECT'
      AND t.relname IN ('public.webhook_endpoints', 'public.webhook_deliveries')
    );

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'webhook data sharing: table privileges too wide: %', v_offenders
      USING ERRCODE = '42501';
  END IF;
END
$$;

COMMIT;
