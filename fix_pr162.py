from pathlib import Path

base = Path(r"D:\portal-wt\pr-162")

# Re-apply the unique-index migration after triage so pgTAP sees production shape.
# seed.sql drops the indexes to load duplicate fixtures; re-applying 003100
# overwrites the PR-52 guard body. Restore both by re-running 005200.
p = base / ".github/workflows/migrations.yml"
t = p.read_text()
old = """            psql \"$DB_URL\" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20260920003100_scheduler_and_sync_queue_cron.sql
            psql \"$DB_URL\" -v ON_ERROR_STOP=1 -q -f \"$dir/check.sql\""""
new = """            psql \"$DB_URL\" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20260920003100_scheduler_and_sync_queue_cron.sql
            psql \"$DB_URL\" -v ON_ERROR_STOP=1 -q -f \"$dir/check.sql\"
            # seed.sql drops sync_queue unique indexes to load duplicate fixtures,
            # and re-applying 003100 overwrites the PR-52 client-insert guard.
            # Restore the production shape before pgTAP.
            psql \"$DB_URL\" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20260920005200_sync_queue_pending_unique.sql"""
if old not in t:
    print("workflow pattern not found")
    idx = t.find("20260920003100_scheduler")
    print(repr(t[max(0, idx-200):idx+300]) if idx >= 0 else "no 003100 in workflow")
else:
    t = t.replace(old, new, 1)
    p.write_text(t)
    print("pr162 migrations.yml restored 005200 after triage")

# Also restore indexes at the end of check.sql as a belt-and-suspenders local path
p = base / "scripts/ci/sync-queue-triage/check.sql"
if p.exists():
    t = p.read_text()
    if "sync_queue_one_active" not in t.split("BEGIN")[-1] and "CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_one_active" not in t:
        t = t.rstrip() + """

-- Restore the PR-52 unique indexes dropped by seed.sql so later suites
-- (pgTAP sync_queue_dedupe + scheduler) see the production shape.
CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_one_active
  ON public.sync_queue (
    user_id,
    provider,
    ((coalesce(sync_type, 'incremental') = 'initial'))
  )
  WHERE status IN ('pending', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_one_processing
  ON public.sync_queue (user_id, provider)
  WHERE status = 'processing';
"""
        p.write_text(t)
        print("pr162 check.sql restores indexes")
    else:
        print("check.sql already has index restore")
else:
    print("check.sql missing")

print("pr162 script complete")
