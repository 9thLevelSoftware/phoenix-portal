-- 204-C / 204-E: a client clock on sync tombstones, an atomic clocked cycle
-- delete, and a push-time re-create gate that lets a strictly newer edit win.
--
-- 1. sync_tombstones.client_deleted_at is the LWW key of the delete: the
--    deleting device's clock for a clocked mobile delete (`deletedCycles`),
--    now() for every other delete (portal, clockless mobile routine delete,
--    race re-delete). deleted_at stays the server clock and the pull cursor
--    (two clocks, never compared with each other). Existing rows are
--    backfilled from deleted_at.
-- 2. record_sync_tombstone() reads the transaction-local
--    `phoenix.sync_delete_clock` setting, which delete_cycles_clocked sets
--    around its own DELETE, and falls back to now().
-- 3. delete_cycles_clocked(p_user_id, p_deletions) replaces the Edge's
--    separate "probe the clock" and "delete" PostgREST calls, which a
--    concurrent cycle write could land between. Per id it locks the row, then
--    takes the per-cycle advisory lock every training_cycles write already
--    holds (the guard_training_cycle_lww trigger's 'training-cycle:' key) --
--    the order every other cycle writer uses, since a BEFORE ROW trigger runs
--    with the row already locked -- then compares the stored
--    client_updated_at with the deletion clock, and either
--    reports a rejection (stored key strictly newer) or deletes the row. The
--    tombstone trigger records the device's clock. An id the server no longer
--    holds is tombstoned directly, so a later stale upload cannot recreate it.
--    Legacy clockless `deletedCycleIds` never reach this function.
-- 4. apply_sync_tombstone_gate(p_user_id, p_rows) replaces the push's
--    get_sync_tombstones lookup: a pushed routine/cycle is skipped when its
--    DTO clock is missing (older builds send none) or not strictly newer than
--    the tombstone's client clock; a strictly newer edit wins and the
--    tombstone is removed in the same transaction
--    (docs/sync-reliability-contract.md). get_sync_tombstones is unchanged and
--    still serves the pull.
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE public.sync_tombstones
  ADD COLUMN IF NOT EXISTS client_deleted_at TIMESTAMPTZ;

UPDATE public.sync_tombstones
   SET client_deleted_at = deleted_at
 WHERE client_deleted_at IS NULL;

ALTER TABLE public.sync_tombstones
  ALTER COLUMN client_deleted_at SET DEFAULT now();
ALTER TABLE public.sync_tombstones
  ALTER COLUMN client_deleted_at SET NOT NULL;

COMMENT ON COLUMN public.sync_tombstones.client_deleted_at IS
  'LWW key of the delete: the deleting device''s clock for a clocked mobile delete, now() otherwise. deleted_at remains the server clock / pull cursor.';

CREATE OR REPLACE FUNCTION public.record_sync_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clock_text TEXT;
  v_clock TIMESTAMPTZ;
BEGIN
  -- Account deletion: auth.users is already gone while its cascade deletes
  -- routines/cycles. Record nothing for a deleted user.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  -- delete_cycles_clocked sets this around its own DELETE; every other
  -- delete path records now().
  v_clock_text := pg_catalog.current_setting('phoenix.sync_delete_clock', true);
  v_clock := CASE
    WHEN v_clock_text IS NULL OR v_clock_text = '' THEN now()
    ELSE v_clock_text::TIMESTAMPTZ
  END;

  INSERT INTO public.sync_tombstones (user_id, entity, entity_id, deleted_at, client_deleted_at)
  VALUES (OLD.user_id, TG_ARGV[0], OLD.id, now(), v_clock)
  ON CONFLICT (user_id, entity, entity_id)
  DO UPDATE SET
    deleted_at = now(),
    client_deleted_at = GREATEST(public.sync_tombstones.client_deleted_at, EXCLUDED.client_deleted_at);

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sync_tombstone() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_cycles_clocked(
  p_user_id UUID,
  p_deletions JSONB
)
RETURNS TABLE(
  id UUID,
  accepted BOOLEAN,
  existed BOOLEAN,
  server_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_item JSONB;
  v_id UUID;
  v_clock TIMESTAMPTZ;
  v_stored TIMESTAMPTZ;
  v_found BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'delete_cycles_clocked: p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_deletions IS NULL OR jsonb_typeof(p_deletions) <> 'array' THEN
    RAISE EXCEPTION 'delete_cycles_clocked: p_deletions must be a JSON array' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_deletions)
  LOOP
    v_id := (v_item ->> 'id')::UUID;
    v_clock := (v_item ->> 'updatedAt')::TIMESTAMPTZ;
    IF v_id IS NULL OR v_clock IS NULL THEN
      RAISE EXCEPTION 'delete_cycles_clocked: id and updatedAt are required' USING ERRCODE = '22023';
    END IF;

    -- Row lock first, then the key guard_training_cycle_lww takes on every
    -- cycle insert and update. That is the order of every other cycle
    -- writer: an UPDATE (portal edit, merge_training_cycles_from_push's
    -- FOR UPDATE) holds the row before its BEFORE ROW trigger takes the
    -- advisory lock, so taking the advisory lock first here deadlocked
    -- against a concurrent merge of the same cycle.
    SELECT c.client_updated_at INTO v_stored
      FROM public.training_cycles c
     WHERE c.id = v_id AND c.user_id = p_user_id
       FOR UPDATE;
    v_found := FOUND;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('training-cycle:' || v_id::TEXT, 0)
    );

    IF NOT v_found THEN
      -- A concurrent insert of this id held the advisory lock until it
      -- committed; look again now that it has.
      SELECT c.client_updated_at INTO v_stored
        FROM public.training_cycles c
       WHERE c.id = v_id AND c.user_id = p_user_id
         FOR UPDATE;
      v_found := FOUND;
    END IF;

    -- A delete may win only when its clock is at least the stored LWW key; a
    -- row with no stored key loses to a clocked delete.
    IF v_found AND v_stored IS NOT NULL AND v_stored > v_clock THEN
      id := v_id; accepted := FALSE; existed := TRUE; server_updated_at := v_stored;
      RETURN NEXT;
      CONTINUE;
    END IF;

    PERFORM pg_catalog.set_config('phoenix.sync_delete_clock', v_clock::TEXT, true);
    IF v_found THEN
      -- CASCADE takes cycle_days; the AFTER DELETE trigger records the
      -- tombstone with this device's clock.
      DELETE FROM public.training_cycles c WHERE c.id = v_id AND c.user_id = p_user_id;
    ELSE
      INSERT INTO public.sync_tombstones (user_id, entity, entity_id, deleted_at, client_deleted_at)
      VALUES (p_user_id, 'cycle', v_id, now(), v_clock)
      ON CONFLICT (user_id, entity, entity_id)
      DO UPDATE SET
        deleted_at = now(),
        client_deleted_at = GREATEST(public.sync_tombstones.client_deleted_at, EXCLUDED.client_deleted_at);
    END IF;
    PERFORM pg_catalog.set_config('phoenix.sync_delete_clock', '', true);

    id := v_id; accepted := TRUE; existed := v_found; server_updated_at := NULL;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_cycles_clocked(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cycles_clocked(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.delete_cycles_clocked(UUID, JSONB) IS
  'mobile-sync-push clocked cycle deletes: per id, under the per-cycle lock, reject (stored LWW key strictly newer) or delete/tombstone with the device clock. Service role only.';

CREATE OR REPLACE FUNCTION public.apply_sync_tombstone_gate(
  p_user_id UUID,
  p_rows JSONB
)
RETURNS TABLE(entity TEXT, entity_id UUID, skipped BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_row JSONB;
  v_entity TEXT;
  v_id UUID;
  v_clock TIMESTAMPTZ;
  v_tombstone_clock TIMESTAMPTZ;
  v_live BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'apply_sync_tombstone_gate: p_user_id is required' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB))
  LOOP
    v_entity := v_row ->> 'entity';
    v_id := (v_row ->> 'id')::UUID;
    v_clock := NULL;
    IF jsonb_typeof(v_row -> 'clock') = 'string' THEN
      BEGIN
        v_clock := (v_row ->> 'clock')::TIMESTAMPTZ;
      EXCEPTION WHEN others THEN
        v_clock := NULL;
      END;
    END IF;

    SELECT t.client_deleted_at INTO v_tombstone_clock
      FROM public.sync_tombstones t
     WHERE t.user_id = p_user_id AND t.entity = v_entity AND t.entity_id = v_id
       FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- A row that is live again for the same user makes the tombstone stale
    -- (get_sync_tombstones hides it for the same reason).
    IF v_entity = 'routine' THEN
      v_live := EXISTS (
        SELECT 1 FROM public.routines r WHERE r.id = v_id AND r.user_id = p_user_id
      );
    ELSE
      v_live := EXISTS (
        SELECT 1 FROM public.training_cycles c WHERE c.id = v_id AND c.user_id = p_user_id
      );
    END IF;
    IF v_live THEN
      CONTINUE;
    END IF;

    -- A missing clock (older builds send none) never beats a delete.
    IF v_clock IS NULL OR v_clock <= v_tombstone_clock THEN
      entity := v_entity; entity_id := v_id; skipped := TRUE;
      RETURN NEXT;
    ELSE
      DELETE FROM public.sync_tombstones t
       WHERE t.user_id = p_user_id AND t.entity = v_entity AND t.entity_id = v_id;
      entity := v_entity; entity_id := v_id; skipped := FALSE;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_sync_tombstone_gate(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_sync_tombstone_gate(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.apply_sync_tombstone_gate(UUID, JSONB) IS
  'mobile-sync-push re-create gate: skipped=true when the pushed row''s clock is missing or not newer than the tombstone''s client clock; a strictly newer edit removes the tombstone (skipped=false). Service role only.';

COMMIT;
