#!/usr/bin/env bash
# Gating checks for 20260920007600_reconcile_prod_schema_drift.sql.
#
# The migration's entire safety argument is "every step is catalog-gated, so on
# a database already in the target shape nothing runs and no table lock is
# taken". The pgTAP suite asserts the END STATE of a from-zero apply, which is
# identical whether or not the gates work, and `supabase db reset` applies each
# migration exactly once -- so neither the no-op claim nor idempotency had any
# automated coverage. This script gives them one.
#
# Phases (each runs the real migration file, nothing simulated):
#   1 already-in-target-shape  -> expect 0 `reconcile:` NOTICEs  (idempotent)
#   2 prod-shaped by a fixture -> expect 0                       (no-op on prod)
#   3 drifted, with rows       -> expect 8, then assert convergence
#   4 after that real apply    -> expect 0                       (converges)
#
# Phase 3 is also the partial-apply guard: drop the backfill from section 2 and
# SET NOT NULL aborts with 23502; switch to_jsonb() for ::jsonb and the
# non-JSON row aborts with 22P02 (or the assertions catch the changed shape).
#
# Usage:
#   DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#     bash scripts/migration-gating/run.sh
# Locally, without psql on PATH, point PSQL at the stack's container:
#   PSQL="docker exec -i supabase_db_<id> psql" DB_URL=... bash .../run.sh
#
# Destructive: it drifts and re-converges the target database. Run it against a
# throwaway local/CI stack, never against a database you care about.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
migration="$repo/supabase/migrations/20260920007600_reconcile_prod_schema_drift.sql"

: "${DB_URL:?DB_URL is required, e.g. \$(supabase status -o json | jq -r .DB_URL)}"
PSQL_BIN=${PSQL:-psql}

if [ ! -f "$migration" ]; then
  echo "FAIL: migration not found at $migration" >&2
  exit 1
fi

run_sql() { # <file> -> stdout+stderr of the run
  # shellcheck disable=SC2086
  $PSQL_BIN "$DB_URL" -v ON_ERROR_STOP=1 -X -q < "$1" 2>&1
}

failures=0

apply_migration() { # <label> <expected reconcile NOTICE count>
  local label="$1" expected="$2" out notices
  if ! out="$(run_sql "$migration")"; then
    printf '%s\n' "$out"
    echo "FAIL [$label]: the migration returned a non-zero exit status"
    failures=$((failures + 1))
    return
  fi
  notices="$(printf '%s\n' "$out" | grep -c 'reconcile:' || true)"
  if [ "$notices" -ne "$expected" ]; then
    printf '%s\n' "$out"
    echo "FAIL [$label]: expected $expected 'reconcile:' NOTICE(s), got $notices"
    failures=$((failures + 1))
    return
  fi
  echo "ok   [$label]: $notices 'reconcile:' NOTICE(s)"
}

run_fixture() { # <label> <file>
  local label="$1" file="$2" out
  if ! out="$(run_sql "$file")"; then
    printf '%s\n' "$out"
    echo "FAIL [$label]: $(basename "$file") failed"
    failures=$((failures + 1))
    return 1
  fi
  echo "ok   [$label]: $(basename "$file")"
}

echo "== phase 1: re-apply against the schema the chain just produced =="
apply_migration "idempotent" 0

echo "== phase 2: drift, re-shape by hand, re-apply (no-op on a prod-shaped schema) =="
run_fixture "prod-shape" "$here/01-drift.sql"
run_fixture "prod-shape" "$here/02-prod-shape.sql"
apply_migration "prod-shape no-op" 0

echo "== phase 3: drift with rows, apply for real =="
run_fixture "drifted" "$here/01-drift.sql"
run_fixture "drifted" "$here/03-drifted-rows.sql"
apply_migration "drifted apply" 8
run_fixture "drifted" "$here/04-assert-converged.sql"

echo "== phase 4: re-apply after the real apply =="
apply_migration "converged" 0

if [ "$failures" -ne 0 ]; then
  echo "migration gating: $failures check(s) failed"
  exit 1
fi
echo "migration gating: all checks passed"
