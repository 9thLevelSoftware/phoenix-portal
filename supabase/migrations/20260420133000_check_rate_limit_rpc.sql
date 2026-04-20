-- Add the atomic rate-limit RPC expected by supabase/functions/_shared/rateLimit.ts.
--
-- Why this exists:
-- - The edge helper already prefers `public.check_rate_limit(...)` for the
--   hot-path sync/auth endpoints.
-- - The table/schema migrations for rate_limit_tracking shipped, but the RPC
--   itself never made it into migration history.
-- - Without this function, every request falls back to a multi-query path and
--   any failure in that path surfaces as `rate_limit_unavailable`.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_user_id uuid,
  p_max_requests integer,
  p_window_seconds integer
)
RETURNS TABLE(
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_window_interval interval := make_interval(secs => p_window_seconds);
  v_row public.rate_limit_tracking%ROWTYPE;
  v_next_count integer;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'check_rate_limit requires non-empty p_key';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'check_rate_limit requires non-null p_user_id';
  END IF;

  IF p_max_requests IS NULL OR p_max_requests < 1 THEN
    RAISE EXCEPTION 'check_rate_limit requires p_max_requests >= 1';
  END IF;

  IF p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'check_rate_limit requires p_window_seconds >= 1';
  END IF;

  LOOP
    SELECT *
      INTO v_row
      FROM public.rate_limit_tracking
      WHERE key = p_key
        AND user_id = p_user_id
      FOR UPDATE;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.rate_limit_tracking (
          key,
          user_id,
          provider,
          requests_this_window,
          window_started_at,
          last_request_at,
          last_reset_at
        )
        VALUES (
          p_key,
          p_user_id,
          p_key,
          1,
          v_now,
          v_now,
          NULL
        );

        RETURN QUERY
        SELECT TRUE, GREATEST(p_max_requests - 1, 0), NULL::integer;
        RETURN;
      EXCEPTION
        WHEN unique_violation THEN
          -- Another request inserted the row first. Retry and lock it.
      END;
    ELSE
      IF v_row.window_started_at < (v_now - v_window_interval) THEN
        UPDATE public.rate_limit_tracking
        SET
          requests_this_window = 1,
          window_started_at = v_now,
          last_request_at = v_now,
          last_reset_at = v_now,
          provider = COALESCE(provider, p_key)
        WHERE id = v_row.id;

        RETURN QUERY
        SELECT TRUE, GREATEST(p_max_requests - 1, 0), NULL::integer;
        RETURN;
      END IF;

      IF v_row.requests_this_window >= p_max_requests THEN
        RETURN QUERY
        SELECT
          FALSE,
          0,
          GREATEST(
            CEIL(EXTRACT(EPOCH FROM ((v_row.window_started_at + v_window_interval) - v_now)))::integer,
            1
          );
        RETURN;
      END IF;

      v_next_count := v_row.requests_this_window + 1;

      UPDATE public.rate_limit_tracking
      SET
        requests_this_window = v_next_count,
        last_request_at = v_now,
        provider = COALESCE(provider, p_key)
      WHERE id = v_row.id;

      RETURN QUERY
      SELECT TRUE, GREATEST(p_max_requests - v_next_count, 0), NULL::integer;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, uuid, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, uuid, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
