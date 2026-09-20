from pathlib import Path

base = Path(r"D:\portal-wt\pr-141")

# --- mobile-sync-push parse artifact ---
p = base / "supabase/functions/mobile-sync-push/index.test.ts"
t = p.read_text()
old = """  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table === "personal_records"),
// ---------------------------------------------------------------------------
// KD-4: routine/cycle tombstones on push (both SYNC_LWW_ENABLED values).
// ---------------------------------------------------------------------------

const TOMB_ROUTINE_ID = "00000000-0000-4000-8000-000000000160";"""
new = """  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table === "personal_records"),
    [],
  );
});

// ---------------------------------------------------------------------------
// KD-4: routine/cycle tombstones on push (both SYNC_LWW_ENABLED values).
// ---------------------------------------------------------------------------

const TOMB_ROUTINE_ID = "00000000-0000-4000-8000-000000000160";"""
if old not in t:
    raise SystemExit("mobile-sync-push artifact not found")
t = t.replace(old, new, 1)
p.write_text(t)
print("pr141 mobile-sync-push parse fixed")

# --- types nullability from CI diff ---
p = base / "src/lib/database.types.ts"
t = p.read_text()
# In get_personal_record_tombstones and get_personal_records_excluding_ids Returns:
# deleted_at/exercise_id/local_profile_id/workout_phase should be nullable
changed = 0
for fn in ("get_personal_record_tombstones", "get_personal_records_excluding_ids"):
    marker = f"			{fn}: {{"
    idx = t.find(marker)
    if idx < 0:
        print("missing fn", fn)
        continue
    # limit search to this function block (until next get_/update_ at same indent)
    nxt = t.find("\n			get_", idx + len(marker))
    nxt2 = t.find("\n			update_", idx + len(marker))
    ends = [x for x in (nxt, nxt2) if x > 0]
    end = min(ends) if ends else idx + 2000
    block = t[idx:end]
    nb = block
    for field in ("deleted_at", "exercise_id", "local_profile_id", "workout_phase"):
        nb2 = nb.replace(f"					{field}: string;\n", f"					{field}: string | null;\n")
        if nb2 != nb:
            changed += 1
        nb = nb2
    t = t[:idx] + nb + t[end:]
print("nullable field updates:", changed)
p.write_text(t)
print("pr141 types done")

# --- GitGuardian redaction ---
p = base / "docs/plans/mvp-cloud-sync-portal.md"
if p.exists():
    t = p.read_text()
    t2 = t.replace("sb_publishable_UDrjasV6UJLm_IdIzGljoQ_YaRes4dQ", "sb_publishable_YOUR_PUBLISHABLE_KEY_HERE")
    if t2 != t:
        p.write_text(t2)
        print("redacted docs publishable key")
    else:
        print("docs key not present")

p = base / "tests/sync/helpers/supabase-test-client.ts"
if p.exists():
    t = p.read_text()
    # Replace well-known Supabase demo JWTs with clearly synthetic placeholders
    t2 = t.replace(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
        "eyJhbGciOiJURVNUIiwidHlwIjoiSldUIn0.eyJpc3MiOiJwaG9lbml4LXBvcnRhbC10ZXN0Iiwicm9sZSI6ImFub24ifQ.TEST_ANON_SIGNATURE_PLACEHOLDER",
    ).replace(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
        "eyJhbGciOiJURVNUIiwidHlwIjoiSldUIn0.eyJpc3MiOiJwaG9lbml4LXBvcnRhbC10ZXN0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.TEST_SERVICE_SIGNATURE_PLACEHOLDER",
    )
    if t2 != t:
        p.write_text(t2)
        print("redacted test-client demo JWTs")
    else:
        print("test-client JWTs not present")

print("pr141 script complete")
