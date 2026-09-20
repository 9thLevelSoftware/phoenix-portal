from pathlib import Path
import re

base = Path(r"D:\portal-wt\pr-160")
p = base / "src/lib/database.types.ts"
t = p.read_text()

# Remove hand-edit comments that fail gen:types:check
old_comment = """			deletion_requests: {
				// Hand-edited for PR 35 (claimed_at, needs_support_reason,
				// last_attempt_at from migration 20260920003500). This branch
				// does not contain PR 4, so `gen:types` cannot regenerate here;
				// the verify phase regenerates the whole file.
				Row: {"""
new_comment = """			deletion_requests: {
				Row: {"""
if old_comment in t:
    t = t.replace(old_comment, new_comment)
    print("removed hand-edit comments")
else:
    print("hand-edit comments not found")

# row_snapshot optional in Insert
# Find subscription_events Insert row_snapshot
t2, n = re.subn(
    r"(subscription_events: \{[\s\S]*?Insert: \{[\s\S]*?)row_snapshot: Json;",
    r"\1row_snapshot?: Json;",
    t,
    count=1,
)
print("row_snapshot optional replacements:", n)
t = t2

# Add sync_tombstones table before telemetry_analysis if missing
if "sync_tombstones: {" not in t:
    sync_tomb = """			sync_tombstones: {
				Row: {
					deleted_at: string;
					entity: string;
					entity_id: string;
					user_id: string;
				};
				Insert: {
					deleted_at?: string;
					entity: string;
					entity_id: string;
					user_id: string;
				};
				Update: {
					deleted_at?: string;
					entity?: string;
					entity_id?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			telemetry_analysis: {"""
    if "			telemetry_analysis: {" not in t:
        raise SystemExit("telemetry_analysis anchor not found")
    t = t.replace("			telemetry_analysis: {", sync_tomb, 1)
    print("added sync_tombstones table")
else:
    print("sync_tombstones already present")

# Add get_sync_tombstones RPC before get_user_pr_rank
if "get_sync_tombstones: {" not in t:
    rpc = """			get_sync_tombstones: {
				Args: {
					p_entity?: string;
					p_ids?: string[];
					p_since?: string;
					p_user_id: string;
				};
				Returns: {
					deleted_at: string;
					entity: string;
					entity_id: string;
				}[];
			};
			get_user_pr_rank: {"""
    if "			get_user_pr_rank: {" not in t:
        raise SystemExit("get_user_pr_rank anchor not found")
    t = t.replace("			get_user_pr_rank: {", rpc, 1)
    print("added get_sync_tombstones rpc")
else:
    print("get_sync_tombstones already present")

# Add sweep_deleted_account_residue before update_cycle_with_days
if "sweep_deleted_account_residue: {" not in t:
    sweep = """			sweep_deleted_account_residue: {
				Args: { p_avatar_limit?: number };
				Returns: Json;
			};
			update_cycle_with_days: {"""
    if "			update_cycle_with_days: {" not in t:
        raise SystemExit("update_cycle_with_days anchor not found")
    t = t.replace("			update_cycle_with_days: {", sweep, 1)
    print("added sweep_deleted_account_residue rpc")
else:
    print("sweep_deleted_account_residue already present")

p.write_text(t)
print("pr160 types done")
