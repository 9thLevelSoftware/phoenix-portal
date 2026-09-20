from pathlib import Path
import re

base = Path(r"D:\portal-wt\pr-160")

# --- rls_isolation: same mash fixes as PR172 ---
p = base / "supabase/tests/database/rls_isolation.test.sql"
t = p.read_text()
t = t.replace(
    "'EMBER', 'active', now() + INTERVAL '30 days'\n        'FLAME', 'active', now() + INTERVAL '30 days'",
    "'EMBER', 'active', now() + INTERVAL '30 days'",
)
t = t.replace(
    """-- Users A and B are both EMBER; C has no subscription row (FREE). A owns one
-- Users A and B are both FLAME, so every owner write policy (including the
-- FLAME-gated ones from 20260920000900) has a positive control; C has no
-- subscription row (FREE). A owns one fixture row in every private
-- user-owned relation listed in rls_cases. Tier denials live in
-- trust_plane.test.sql (EMBER) and tier_matrix.test.sql (FLAME).""",
    """-- Users A and B are both EMBER; C has no subscription row (FREE). A owns one
-- fixture row in every private user-owned relation listed in rls_cases. Tier
-- denials live in trust_plane.test.sql (EMBER) and tier_matrix.test.sql (FLAME).""",
)
t = t.replace(
    """          -- B's subscription is needed for EMBER; no client UPDATE/DELETE
          -- B's subscription is needed for FLAME; no client UPDATE/DELETE
          -- policy may ever match it, so the blind probe still expects 0.""",
    """          -- B's subscription is needed for EMBER; no client UPDATE/DELETE
          -- policy may ever match it, so the blind probe still expects 0.""",
)
t = t.replace(
    """SELECT is(
    public.user_has_min_tier('FLAME'),
    false,
    'A still does not hold FLAME after the attempts'
    public.user_has_min_tier('INFERNO'),
    false,
    'A still does not hold INFERNO after the attempts'
);""",
    """SELECT is(
    public.user_has_min_tier('FLAME'),
    false,
    'A still does not hold FLAME after the attempts'
);

SELECT is(
    public.user_has_min_tier('INFERNO'),
    false,
    'A still does not hold INFERNO after the attempts'
);""",
)
# generic: Fixtures inserted as postgres mashed comments
t = t.replace(
    """-- Fixtures are inserted as postgres (bypassing the EMBER-gated INSERT
-- policies, which trust_plane.test.sql covers).""",
    """-- Fixtures are inserted as postgres (bypassing the EMBER-gated INSERT
-- policies, which trust_plane.test.sql covers).""",
)
p.write_text(t)
print("pr160 rls_isolation done")

# --- sync_tombstones: restore mashed ok(EXISTS) assertion ---
p = base / "supabase/tests/database/sync_tombstones.test.sql"
t = p.read_text()
old = """    'sync_tombstones has no foreign key (the trigger can fire during an account cascade)'
    EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'public.sync_tombstones'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'auth.users'::regclass
          AND c.confdeltype = 'c'
          AND a.attname = 'user_id'
    ),
    'sync_tombstones.user_id cascades when the auth user is deleted'
);"""
new = """SELECT ok(
    EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'public.sync_tombstones'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'auth.users'::regclass
          AND c.confdeltype = 'c'
          AND a.attname = 'user_id'
    ),
    'sync_tombstones.user_id cascades when the auth user is deleted'
);"""
if old not in t:
    print("sync_tombstones pattern not found, dumping around EXISTS:")
    idx = t.find("has no foreign key")
    print(repr(t[max(0, idx-200):idx+400]) if idx >= 0 else "no 'has no foreign key'")
else:
    t = t.replace(old, new, 1)
    p.write_text(t)
    print("pr160 sync_tombstones done")

# --- dashboard_capture: drop the non-IGNORED duplicate expectation ---
p = base / "supabase/tests/database/dashboard_capture.test.sql"
t = p.read_text()
old = """            ('subscription_events'::text, 'subscription_events_operation_check'::text,
             'CHECK ((operation = ANY (ARRAY[''INSERT''::text, ''UPDATE''::text, ''DELETE''::text, ''IGNORED''::text])))'::text),
            ('subscription_events'::text, 'subscription_events_operation_check'::text,
             'CHECK ((operation = ANY (ARRAY[''INSERT''::text, ''UPDATE''::text, ''DELETE''::text])))'::text),"""
new = """            ('subscription_events'::text, 'subscription_events_operation_check'::text,
             'CHECK ((operation = ANY (ARRAY[''INSERT''::text, ''UPDATE''::text, ''DELETE''::text, ''IGNORED''::text])))'::text),"""
if old not in t:
    print("dashboard_capture pattern not found")
    idx = t.find("subscription_events_operation_check")
    print(repr(t[max(0,idx-100):idx+400]) if idx>=0 else "missing")
else:
    t = t.replace(old, new, 1)
    p.write_text(t)
    print("pr160 dashboard_capture done")

# --- due_deletion: create auth users first so FK inserts succeed; delete one after residue setup is NOT needed if we only use FK-less residue for deleted users ---
p = base / "supabase/tests/database/due_deletion.test.sql"
t = p.read_text()
old = """-- A deleted user's residue (no auth.users row) and a live user's rows.
INSERT INTO public.sync_tombstones (user_id, entity, entity_id) VALUES
    ('35353535-0000-4000-8000-0000000000dd', 'routine', gen_random_uuid()),
    ('35353535-0000-4000-8000-000000000002', 'routine', gen_random_uuid());"""
new = """-- A deleted user's residue (no auth.users row) and a live user's rows.
-- sync_tombstones.user_id references auth.users, so create the users, write
-- tombstones, then delete the "deleted" user's auth row. FK-less residue
-- (webhook events, subscription_events, avatar folders) is inserted after the
-- delete so it survives the cascade the way production residue does.
INSERT INTO auth.users (id, email)
VALUES
    ('35353535-0000-4000-8000-0000000000dd'::uuid, 'due-deleted@example.test'),
    ('35353535-0000-4000-8000-000000000002'::uuid, 'due-live@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sync_tombstones (user_id, entity, entity_id) VALUES
    ('35353535-0000-4000-8000-0000000000dd', 'routine', gen_random_uuid()),
    ('35353535-0000-4000-8000-000000000002', 'routine', gen_random_uuid());

DELETE FROM auth.users WHERE id = '35353535-0000-4000-8000-0000000000dd'::uuid;"""
if old not in t:
    print("due_deletion pattern not found")
else:
    t = t.replace(old, new, 1)
    p.write_text(t)
    print("pr160 due_deletion done")

print("pr160 script complete")
