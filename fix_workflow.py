from pathlib import Path

p = Path(r"D:\portal-wt\pr-162\.github\workflows\migrations.yml")
t = p.read_text(encoding="utf-8")
old = '''          psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20260920003100_scheduler_and_sync_queue_cron.sql
          psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$dir/check.sql"
'''
new = '''          psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20260920003100_scheduler_and_sync_queue_cron.sql
          psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$dir/check.sql"
          # seed.sql drops sync_queue unique indexes to load duplicate fixtures,
          # and re-applying 003100 overwrites the PR-52 client-insert guard.
          # Restore the production shape before pgTAP.
          psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20260920005200_sync_queue_pending_unique.sql
'''
if old not in t:
    raise SystemExit("workflow snippet not found")
t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8")
print("pr162 migrations.yml updated")
