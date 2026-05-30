-- =============================================================
-- Backfill exercises.muscle_group from the exercise NAME.
--
-- ROOT CAUSE: the mobile sync push hardcoded muscle_group = "General"
-- for every session exercise (SyncManager.kt), so 100% of historical
-- exercises rows landed in a single "General" bucket. That collapsed the
-- portal Body tab (Muscle Distribution donut, Muscle Balance radar, Muscle
-- Group Breakdown, body heatmap) into one meaningless slice.
--
-- The mobile hardcode is fixed going forward, and the portal now classifies
-- by exercise name at query time. This migration additionally repairs the
-- existing data so the muscle_group COLUMN is meaningful for any other
-- consumer.
--
-- The name -> canonical-group mapping mirrors the portal classifier
-- (src/lib/exercise-muscles.ts: EXERCISE_MAP + keyword fallback tier) so the
-- stored column agrees with what the portal computes. Canonical groups:
-- Chest, Back, Shoulders, Arms, Legs, Core.
--
-- IDEMPOTENT: only rows still equal to 'General' are touched, and the join
-- is on lower(btrim(name)), so re-running is a safe no-op. Genuinely
-- unknown/ambiguous names ("Unknown Exercise", "Bear Crawl", "Muscle Clean &
-- Press", "Bar Rotation") are intentionally left as 'General'.
-- =============================================================

WITH name_map(norm_name, grp) AS (
    VALUES
        -- ── Chest ──
        ('bench press', 'Chest'),
        ('press', 'Chest'),
        ('bench press - wide grip', 'Chest'),
        ('decline bench press', 'Chest'),
        ('incline bench press', 'Chest'),
        ('neutral grip bench press', 'Chest'),
        ('alternating bench press', 'Chest'),
        ('chest press', 'Chest'),
        ('chest press - gym ball', 'Chest'),
        ('fly', 'Chest'),
        ('chest fly', 'Chest'),
        ('incline fly', 'Chest'),
        ('cable fly', 'Chest'),
        ('lying pec fly', 'Chest'),
        ('incline pec fly', 'Chest'),
        ('pullover', 'Chest'),
        ('lat pullover', 'Chest'),
        ('prone lat pullover', 'Chest'),
        ('decline push up', 'Chest'),
        ('push up', 'Chest'),
        ('pushup', 'Chest'),
        ('crossover', 'Chest'),
        ('cable crossover', 'Chest'),
        ('dip', 'Chest'),
        ('chest dip', 'Chest'),
        ('pec deck', 'Chest'),
        -- ── Back ──
        ('row', 'Back'),
        ('bent over row', 'Back'),
        ('alternating bent over row', 'Back'),
        ('bent over row - wide grip', 'Back'),
        ('bent over row - reverse grip', 'Back'),
        ('bent over row sa', 'Back'),
        ('bent over crossover row', 'Back'),
        ('barbell row', 'Back'),
        ('cable row', 'Back'),
        ('seated row', 'Back'),
        ('seated sa row', 'Back'),
        ('kneeling row', 'Back'),
        ('pull up', 'Back'),
        ('pullup', 'Back'),
        ('chin up', 'Back'),
        ('pulldown', 'Back'),
        ('lat pulldown', 'Back'),
        ('close grip pulldown', 'Back'),
        ('wide grip pulldown', 'Back'),
        ('deadlift', 'Back'),
        ('conventional deadlift', 'Back'),
        ('suitcase deadlift', 'Back'),
        ('shrug', 'Back'),
        ('bent over shrug', 'Back'),
        ('hyperextension', 'Back'),
        ('good morning', 'Back'),
        ('t-bar row', 'Back'),
        -- ── Shoulders ──
        ('overhead press', 'Shoulders'),
        ('shoulder press', 'Shoulders'),
        ('seated shoulder press', 'Shoulders'),
        ('shoulder press - neutral grip', 'Shoulders'),
        ('shoulder press (inside)', 'Shoulders'),
        ('military press', 'Shoulders'),
        ('arnold press', 'Shoulders'),
        ('arnold press (out & up)', 'Shoulders'),
        ('lateral raise', 'Shoulders'),
        ('crossover lateral raise', 'Shoulders'),
        ('side raise', 'Shoulders'),
        ('front raise', 'Shoulders'),
        ('double arm front raise', 'Shoulders'),
        ('rear delt raise', 'Shoulders'),
        ('upright row', 'Shoulders'),
        ('face pull', 'Shoulders'),
        ('face pulls', 'Shoulders'),
        ('reverse fly', 'Shoulders'),
        ('rear delt fly', 'Shoulders'),
        ('crossover rear delt fly', 'Shoulders'),
        ('crossover rear delt fly (chest supported)', 'Shoulders'),
        ('rear delt row', 'Shoulders'),
        ('crossover rear delt row - single arm', 'Shoulders'),
        -- ── Arms ──
        ('curl', 'Arms'),
        ('bicep curl', 'Arms'),
        ('biceps curl', 'Arms'),
        ('bicep curl - pronated', 'Arms'),
        ('alternating bicep curls', 'Arms'),
        ('outward bicep curl', 'Arms'),
        ('bayesian curl', 'Arms'),
        ('hammer curl', 'Arms'),
        ('alternating hammer curl', 'Arms'),
        ('preacher curl', 'Arms'),
        ('concentration curl', 'Arms'),
        ('zottman curl', 'Arms'),
        ('tricep extension', 'Arms'),
        ('overhead tricep extension', 'Arms'),
        ('seated overhead tricep extension', 'Arms'),
        ('kneeling overhead tricep extension', 'Arms'),
        ('overhead tricep bar extension', 'Arms'),
        ('bent over tricep extension', 'Arms'),
        ('tricep kick back', 'Arms'),
        ('tricep kickback', 'Arms'),
        ('tricep dip', 'Arms'),
        ('close grip bench press', 'Arms'),
        ('skull crusher', 'Arms'),
        ('skullcrusher', 'Arms'),
        ('tricep pushdown', 'Arms'),
        ('triceps pushdown', 'Arms'),
        ('kickback', 'Arms'),
        ('wrist curl', 'Arms'),
        -- ── Legs ──
        ('squat', 'Legs'),
        ('back squat', 'Legs'),
        ('low bar squat', 'Legs'),
        ('high bar squat', 'Legs'),
        ('front squat', 'Legs'),
        ('goblet squat', 'Legs'),
        ('squat pulses', 'Legs'),
        ('suitcase squat', 'Legs'),
        ('bulgarian split squat', 'Legs'),
        ('bulgarian split squats', 'Legs'),
        ('split squat', 'Legs'),
        ('lunge', 'Legs'),
        ('reverse lunge', 'Legs'),
        ('walking lunge', 'Legs'),
        ('side lunge', 'Legs'),
        ('leg press', 'Legs'),
        ('leg extension', 'Legs'),
        ('lying leg extension', 'Legs'),
        ('leg curl', 'Legs'),
        ('hamstring curl', 'Legs'),
        ('sl hamstring curl', 'Legs'),
        ('standing hamstring curl', 'Legs'),
        ('lying leg curl', 'Legs'),
        ('romanian deadlift', 'Legs'),
        ('stiff leg deadlift', 'Legs'),
        ('split stance rdl', 'Legs'),
        ('sl rdl w/ knee raise', 'Legs'),
        ('rdl', 'Legs'),
        ('glute bridge', 'Legs'),
        ('sl glute bridge', 'Legs'),
        ('calf raise', 'Legs'),
        ('hip thrust', 'Legs'),
        ('step up', 'Legs'),
        ('sumo deadlift', 'Legs'),
        ('hack squat', 'Legs'),
        ('hip abduction', 'Legs'),
        ('hip adduction', 'Legs'),
        -- ── Core ──
        ('plank', 'Core'),
        ('side plank', 'Core'),
        ('crunch', 'Core'),
        ('high crunch', 'Core'),
        ('sa bicycle crunch', 'Core'),
        ('sit up', 'Core'),
        ('situp', 'Core'),
        ('leg raise', 'Core'),
        ('hanging leg raise', 'Core'),
        ('hanging knee raise', 'Core'),
        ('russian twist', 'Core'),
        ('woodchop', 'Core'),
        ('wood chop', 'Core'),
        ('ab rollout', 'Core'),
        ('ab wheel', 'Core'),
        ('cable crunch', 'Core'),
        ('bicycle crunch', 'Core'),
        ('mountain climber', 'Core'),
        ('dragon flag', 'Core'),
        ('hollow hold', 'Core'),
        ('dead bug', 'Core'),
        ('alternating oblique punch', 'Core'),
        ('double leg raise (bench supported)', 'Core')
)
UPDATE exercises ex
SET muscle_group = nm.grp
FROM name_map nm
WHERE ex.muscle_group = 'General'
  AND lower(btrim(ex.name)) = nm.norm_name;
