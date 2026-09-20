-- Telemetry reads (force curves, Biomechanics, Session Replay) keyset-page a
-- set's samples on (timestamp_ms, id) filtered by set_id. This composite index
-- serves the filter and the sort together, so each page is an index range
-- scan instead of a per-set sort.
-- Idempotent: safe to re-run.
CREATE INDEX IF NOT EXISTS idx_rep_telemetry_set_ts
  ON public.rep_telemetry (set_id, timestamp_ms);
