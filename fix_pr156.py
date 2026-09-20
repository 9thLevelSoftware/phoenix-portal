from pathlib import Path

base = Path(r"D:\portal-wt\pr-156")

# --- EMBER cannot INSERT routines after flame_write_policies (FLAME required) ---
for rel in (
    "supabase/tests/database/definer_function_grants.test.sql",
    "supabase/tests/database/trust_plane.test.sql",
):
    p = base / rel
    if not p.exists():
        print("missing", rel)
        continue
    t = p.read_text()
    # Change lives_ok EMBER INSERT routines to throws_ok FLAME-required
    old = """SELECT lives_ok(
    $sql$
        INSERT INTO public.routines (user_id, name)
        VALUES (
            'a1a1a1a1-0000-4000-8000-000000000001'::uuid,
            'ember write through user_has_min_tier policy'
        )
    $sql$,
    'EMBER JWT can INSERT routines (policy calls user_has_min_tier)'
);"""
    new = """SELECT throws_ok(
    $sql$
        INSERT INTO public.routines (user_id, name)
        VALUES (
            'a1a1a1a1-0000-4000-8000-000000000001'::uuid,
            'ember write through user_has_min_tier policy'
        )
    $sql$,
    '42501',
    NULL,
    'EMBER JWT cannot INSERT routines (browser authoring is FLAME-only since 20260920000900)'
);"""
    if old in t:
        t = t.replace(old, new)
        print("fixed definer-style EMBER routines insert in", rel)
    else:
        print("definer-style block not in", rel)

    old2 = """SELECT lives_ok(
    $sql$
        INSERT INTO public.routines (user_id, name)
        VALUES (
            '44444444-4444-4444-8444-444444444444'::uuid,
            'ember cloud write'
        )
    $sql$,
    'EMBER JWT can INSERT routines'
);"""
    new2 = """SELECT throws_ok(
    $sql$
        INSERT INTO public.routines (user_id, name)
        VALUES (
            '44444444-4444-4444-8444-444444444444'::uuid,
            'ember cloud write'
        )
    $sql$,
    '42501',
    NULL,
    'EMBER JWT cannot INSERT routines (browser authoring is FLAME-only since 20260920000900)'
);"""
    if old2 in t:
        t = t.replace(old2, new2)
        print("fixed trust_plane EMBER routines insert in", rel)
    else:
        print("trust_plane-style block not in", rel)

    p.write_text(t)

# --- GitGuardian redaction (same artifacts as PR141) ---
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

print("pr156 script complete")
