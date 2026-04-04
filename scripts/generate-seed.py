#!/usr/bin/env python3
"""
Generate comprehensive seed SQL for Phoenix Portal from a Vitruvian Phoenix backup export.

Reads: C:/Users/dasbl/Downloads/Vitruvian Phoenix Backup (2).json
Writes: supabase/seed.sql (relative to this script's parent dir)

Usage:
    python scripts/generate-seed.py
"""

import json
import os
import random
import math
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
EXPORT_PATH = "C:/Users/dasbl/Downloads/Vitruvian Phoenix Backup (2).json"
OUTPUT_PATH = os.path.join(PROJECT_ROOT, "supabase", "seed.sql")

# ---------------------------------------------------------------------------
# Constants / mappings
# ---------------------------------------------------------------------------
MODE_MAP = {
    "Program:OldSchool": "OLD_SCHOOL",
    "Program:Echo": "ECHO",
    "Program:Pump": "PUMP",
    "Program:TUT": "TUT",
    "Program:Endurance": "ENDURANCE",
    "Program:Strength": "STRENGTH",
    "Program:Power": "OLD_SCHOOL",  # Legacy alias, maps to OLD_SCHOOL
    "Old School": "OLD_SCHOOL",
    "Echo": "ECHO",
    "Pump": "PUMP",
    "TUT": "TUT",
}

MUSCLE_GROUP_MAP = {
    "ARMS": "Arms",
    "CHEST": "Chest",
    "BACK": "Back",
    "LEGS": "Legs",
    "SHOULDERS": "Shoulders",
    "CORE": "Core",
    "Core": "Core",
    "General": "General",
}

# Realistic default weights (per-cable kg) for exercises that have 0.0 in the export
DEFAULT_WEIGHTS = {
    "Bench Press": 15.0,
    "Incline Bench Press": 12.0,
    "Bent Over Row": 14.0,
    "Plank": 0.0,
    "Squat": 20.0,
    "High Bar Squat": 25.0,
    "Shoulder Press": 8.0,
    "Face Pull": 5.0,
    "Lunge": 10.0,
    "Overhead Tricep Extension": 8.0,
    "Crunch": 5.0,
    "Conventional Deadlift": 22.0,
    "Conventional Deadlift ": 22.0,
    "Shrug": 15.0,
    "Good Morning": 10.0,
    "Front Squat": 18.0,
    "Bulgarian Split Squat": 12.0,
    "Lying Hamstring Curl": 15.0,
    "Calf Raise": 18.0,
    "Lateral Raise": 4.0,
    "Lateral Raise ": 4.0,
    "Front Raise": 4.0,
    "Arnold Press": 6.0,
    "Bicep Curl": 8.0,
    "Bicep Curl ": 8.0,
    "Hammer Curl": 9.0,
    "Overhead Tricep Bar Extension": 12.0,
    "Lying Pec Fly": 6.0,
    "Decline Push Up": 5.0,
    "Sit Up": 5.0,
    "Leg Raises From Dipbars": 5.0,
    "Cable Fly": 6.0,
    "Tricep Pushdown": 10.0,
    "Lat Pulldown": 16.0,
    "Seated Row": 14.0,
    "Chest Supported Row": 12.0,
    "Romanian Deadlift": 18.0,
}

# Seed for reproducibility
random.seed(42)

# Current reference time - "now" in the seed
NOW = datetime(2026, 2, 20, 18, 0, 0, tzinfo=timezone.utc)


def sql_escape(s):
    """Escape single quotes in SQL strings."""
    if s is None:
        return ""
    return str(s).replace("'", "''").strip()


def sql_ts(dt):
    """Format a datetime as SQL timestamp literal."""
    return dt.strftime("%Y-%m-%d %H:%M:%S+00")


def map_mode(raw_mode):
    """Map export mode string to DB mode string."""
    return MODE_MAP.get(raw_mode, "OLD_SCHOOL")


def map_muscle(raw_muscle):
    """Map export muscle group to DB format."""
    return MUSCLE_GROUP_MAP.get(raw_muscle, raw_muscle or "General")


def parse_set_reps(set_reps_str):
    """Parse setReps string like '10,10,10' or 'AMRAP,AMRAP,AMRAP' into list of ints.
    AMRAP becomes 0 (will be filled with realistic values later)."""
    if not set_reps_str:
        return [10, 10, 10]
    parts = set_reps_str.split(",")
    result = []
    for p in parts:
        p = p.strip()
        if p == "AMRAP":
            result.append(0)  # sentinel - will be replaced with realistic reps
        else:
            try:
                result.append(int(p))
            except ValueError:
                result.append(10)
    return result if result else [10, 10, 10]


def get_exercise_weight(ex):
    """Get a realistic weight for an exercise (per-cable kg)."""
    w = ex.get("weightPerCableKg", 0.0)
    if w and w > 0.1:
        return round(w, 1)
    name = ex.get("exerciseName", "").strip()
    return DEFAULT_WEIGHTS.get(name, 8.0)


def estimated_1rm(weight, reps):
    """Epley formula for estimated 1RM."""
    if reps <= 0 or weight <= 0:
        return weight
    if reps == 1:
        return weight
    return round(weight * (1 + reps / 30.0), 2)


# ---------------------------------------------------------------------------
# Load export data
# ---------------------------------------------------------------------------
print(f"Reading export: {EXPORT_PATH}")
with open(EXPORT_PATH, "r", encoding="utf-8") as f:
    export = json.load(f)

raw_data = export["data"]
raw_routines = raw_data["routines"]
raw_routine_exercises = raw_data["routineExercises"]
raw_workout_sessions = raw_data["workoutSessions"]
raw_personal_records = raw_data["personalRecords"]
raw_training_cycles = raw_data["trainingCycles"]
raw_cycle_days = raw_data["cycleDays"]

# ---------------------------------------------------------------------------
# Process routines: group exercises by routine, filter empties
# ---------------------------------------------------------------------------
exercises_by_routine = {}
for re in raw_routine_exercises:
    name = (re.get("exerciseName") or "").strip()
    if not name:
        continue
    rid = re["routineId"]
    exercises_by_routine.setdefault(rid, []).append(re)

# Sort exercises within each routine by orderIndex
for rid in exercises_by_routine:
    exercises_by_routine[rid].sort(key=lambda x: x.get("orderIndex", 0))

# Filter routines: only those with at least one valid exercise
valid_routines = [r for r in raw_routines if r["id"] in exercises_by_routine]
print(f"Valid routines: {len(valid_routines)} / {len(raw_routines)}")

# Assign variable names to routines
routine_vars = {}
for i, r in enumerate(valid_routines):
    routine_vars[r["id"]] = f"r{i + 1}"

# ---------------------------------------------------------------------------
# Build workout sessions spanning 4 weeks
# ---------------------------------------------------------------------------
# We'll pick from the standalone routines (non-cycle) that have real weights,
# plus some cycle routines. Generate 24 sessions over 28 days.

# Separate standalone routines (have actual non-zero weights) from cycle-generated ones
standalone_routines = [
    r for r in valid_routines if not r["id"].startswith("cycle_routine_")
]
cycle_routines = [r for r in valid_routines if r["id"].startswith("cycle_routine_")]

# For session generation, prefer standalone routines but also use some cycle routines
session_pool = standalone_routines[:]
# Add a few of the more interesting cycle routines (PPL variants)
ppl_routines = [
    r
    for r in cycle_routines
    if any(
        n in r["name"]
        for n in ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"]
    )
]
if len(ppl_routines) >= 6:
    session_pool.extend(ppl_routines[:6])
elif cycle_routines:
    session_pool.extend(cycle_routines[:6])

NUM_SESSIONS = 24
session_days = []
day_offset = 0
# Generate session dates - average ~6 per week with some rest days
for _ in range(NUM_SESSIONS):
    day_offset += random.choice([1, 1, 1, 1, 2, 2, 1])
    if day_offset > 28:
        break
    session_days.append(day_offset)

# Ensure we have enough
while len(session_days) < NUM_SESSIONS and session_days[-1] < 28:
    session_days.append(session_days[-1] + 1)

session_days = session_days[:NUM_SESSIONS]

# Build session data
sessions = []
# Track progressive overload per exercise
exercise_base_weights = {}  # exercise_name -> base weight from routine
exercise_progression = {}  # exercise_name -> current added weight (progressive overload)

for idx, day_num in enumerate(session_days):
    routine = session_pool[idx % len(session_pool)]
    rid = routine["id"]
    routine_exs = exercises_by_routine[rid]

    # Pick 3-5 exercises from this routine
    num_ex = min(len(routine_exs), random.choice([3, 4, 4, 5]))
    chosen_exs = routine_exs[:num_ex]

    # Session timing
    session_start = NOW - timedelta(days=28 - day_num)
    # Vary workout time: morning or evening
    hour = random.choice([6, 7, 8, 17, 18, 19])
    minute = random.randint(0, 59)
    session_start = session_start.replace(hour=hour, minute=minute)

    # Progressive overload: ~0.5-1kg increase per week per exercise
    week_num = (day_num - 1) // 7  # 0-3

    total_volume = 0
    total_sets = 0
    pr_count = 0
    ex_data = []

    for ex_idx, rex in enumerate(chosen_exs):
        ex_name = rex["exerciseName"].strip()
        muscle = map_muscle(rex.get("exerciseMuscleGroup", "General"))
        base_weight = get_exercise_weight(rex)
        mode = map_mode(rex.get("mode", "Program:OldSchool"))

        # Track base weight
        if ex_name not in exercise_base_weights:
            exercise_base_weights[ex_name] = base_weight

        # Progressive overload: add 0.5-1.0 kg per week
        progression = week_num * random.uniform(0.3, 0.8)
        current_weight = round(base_weight + progression, 1)

        reps_list = parse_set_reps(rex.get("setReps", "10,10,10"))
        num_sets = len(reps_list) if len(reps_list) >= 3 else random.choice([3, 4])
        if num_sets > 4:
            num_sets = min(num_sets, 5)  # cap at 5

        sets_data = []
        for s_idx in range(num_sets):
            target_reps = reps_list[s_idx] if s_idx < len(reps_list) else reps_list[-1]
            if target_reps == 0:  # AMRAP
                target_reps = random.randint(8, 15)

            # Actual reps: close to target, sometimes over/under
            actual_reps = target_reps + random.choice([-1, 0, 0, 0, 1, 1, 2])
            actual_reps = max(1, actual_reps)

            # Weight varies slightly per set (+/- 0.5kg)
            set_weight = round(current_weight + random.uniform(-0.5, 0.5), 1)
            set_weight = max(1.0, set_weight)

            # RPE: realistic progression through sets
            rpe = round(random.uniform(6.5, 9.5), 1)
            if s_idx == num_sets - 1:
                rpe = min(10.0, rpe + 0.5)  # last set harder

            # Is this a PR? Small chance on heavy sets in later weeks
            is_pr = False
            if week_num >= 2 and s_idx == 0 and random.random() < 0.15:
                is_pr = True
                pr_count += 1

            set_volume = set_weight * actual_reps
            total_volume += set_volume
            total_sets += 1

            sets_data.append(
                {
                    "set_number": s_idx + 1,
                    "target_reps": target_reps,
                    "actual_reps": actual_reps,
                    "weight_kg": set_weight,
                    "rpe": rpe,
                    "is_pr": is_pr,
                }
            )

        ex_data.append(
            {
                "name": ex_name,
                "muscle_group": muscle,
                "order_index": ex_idx,
                "sets": sets_data,
                "mode": mode,
                "weight": current_weight,
            }
        )

    # Duration: 35-75 minutes based on exercise count
    duration_seconds = random.randint(35, 75) * 60 + random.randint(0, 59)

    sessions.append(
        {
            "var": f"s{idx + 1}",
            "routine_name": routine["name"],
            "started_at": session_start,
            "duration_seconds": duration_seconds,
            "total_volume": round(total_volume, 2),
            "set_count": total_sets,
            "exercise_count": len(ex_data),
            "pr_count": pr_count,
            "workout_mode": map_mode(chosen_exs[0].get("mode", "Program:OldSchool"))
            if chosen_exs
            else "OLD_SCHOOL",
            "exercises": ex_data,
        }
    )

print(f"Generated {len(sessions)} workout sessions")

# ---------------------------------------------------------------------------
# Build personal records from session data
# ---------------------------------------------------------------------------
exercise_prs = {}  # exercise_name -> {weight, reps, muscle_group, achieved_at}
for session in sessions:
    for ex in session["exercises"]:
        name = ex["name"]
        muscle = ex["muscle_group"]
        for s in ex["sets"]:
            w = s["weight_kg"]
            r = s["actual_reps"]
            if name not in exercise_prs or w > exercise_prs[name]["weight"]:
                prev = exercise_prs[name]["weight"] if name in exercise_prs else None
                exercise_prs[name] = {
                    "weight": w,
                    "reps": r,
                    "muscle_group": muscle,
                    "achieved_at": session["started_at"],
                    "previous_value": prev,
                }

print(f"Personal records: {len(exercise_prs)} exercises")

# ---------------------------------------------------------------------------
# Build exercise_progress entries for trending charts
# ---------------------------------------------------------------------------
# Group sessions by exercise, generate progress entries
exercise_sessions = {}  # ex_name -> [(session, ex_data)]
for session in sessions:
    for ex in session["exercises"]:
        exercise_sessions.setdefault(ex["name"], []).append((session, ex))

progress_entries = []
for ex_name, sess_list in exercise_sessions.items():
    for session, ex in sess_list:
        max_w = max(s["weight_kg"] for s in ex["sets"])
        total_vol = sum(s["weight_kg"] * s["actual_reps"] for s in ex["sets"])
        max_reps = max(s["actual_reps"] for s in ex["sets"])
        est_1rm = estimated_1rm(max_w, max_reps)
        progress_entries.append(
            {
                "exercise_name": ex_name,
                "session_var": session["var"],
                "recorded_at": session["started_at"],
                "max_weight_kg": round(max_w, 2),
                "total_volume_kg": round(total_vol, 2),
                "estimated_1rm_kg": round(est_1rm, 2),
                "max_reps": max_reps,
                "set_count": len(ex["sets"]),
            }
        )

print(f"Exercise progress entries: {len(progress_entries)}")


# ---------------------------------------------------------------------------
# Generate SQL
# ---------------------------------------------------------------------------
lines = []
L = lines.append

L("-- =============================================================")
L("-- Phoenix Portal Seed Data (auto-generated from real export)")
L(f"-- Generated: {NOW.strftime('%Y-%m-%d %H:%M:%S UTC')}")
L("-- Source: Vitruvian Phoenix Backup")
L("-- =============================================================")
L("-- WARNING: This file is auto-generated by scripts/generate-seed.py")
L("-- Do not edit manually. Re-run the script to regenerate.")
L("-- =============================================================")
L("")
L("-- Clean existing seed data (idempotent re-seed)")
L("DO $$ DECLARE uid uuid; BEGIN")
L("  SELECT id INTO uid FROM auth.users LIMIT 1;")
L("  IF uid IS NOT NULL THEN")
L("    DELETE FROM exercise_progress WHERE user_id = uid;")
L("    DELETE FROM rep_summaries WHERE set_id IN (")
L("      SELECT s.id FROM sets s JOIN exercises e ON s.exercise_id = e.id")
L("      JOIN workout_sessions ws ON e.session_id = ws.id WHERE ws.user_id = uid);")
L("    DELETE FROM sets WHERE exercise_id IN (")
L(
    "      SELECT e.id FROM exercises e JOIN workout_sessions ws ON e.session_id = ws.id WHERE ws.user_id = uid);"
)
L(
    "    DELETE FROM exercises WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id = uid);"
)
L("    DELETE FROM workout_sessions WHERE user_id = uid;")
L("    DELETE FROM personal_records WHERE user_id = uid;")
L("    DELETE FROM challenge_participants WHERE user_id = uid;")
L("    DELETE FROM shared_routines WHERE user_id = uid;")
L("    DELETE FROM shared_cycles WHERE user_id = uid;")
L(
    "    DELETE FROM cycle_days WHERE cycle_id IN (SELECT id FROM training_cycles WHERE user_id = uid);"
)
L("    DELETE FROM training_cycles WHERE user_id = uid;")
L(
    "    DELETE FROM routine_exercises WHERE routine_id IN (SELECT id FROM routines WHERE user_id = uid);"
)
L("    DELETE FROM routines WHERE user_id = uid;")
L("    DELETE FROM user_goals WHERE user_id = uid;")
L("    DELETE FROM user_onboarding WHERE user_id = uid;")
L("  END IF;")
L("END $$;")
L("")
L("")
L("DO $$")
L("DECLARE")
L("  uid uuid;")
L("")
L("  -- Session IDs (need references for exercises)")
for i in range(len(sessions)):
    L(f"  s{i + 1} uuid := gen_random_uuid();")
L("")
L("  -- Exercise IDs (need references for sets, progress)")
# Count total exercises across all sessions
total_exercises = sum(len(s["exercises"]) for s in sessions)
for i in range(total_exercises):
    L(f"  e{i + 1} uuid;")
L("")
L("  -- Set IDs (for rep_summaries - only a subset)")
L("  set1 uuid; set2 uuid; set3 uuid; set4 uuid; set5 uuid;")
L("  set6 uuid; set7 uuid; set8 uuid; set9 uuid; set10 uuid;")
L("  set11 uuid; set12 uuid; set13 uuid; set14 uuid; set15 uuid;")
L("")
L("  -- Routine IDs")
for r_id, var in routine_vars.items():
    L(f"  {var} uuid := gen_random_uuid();")
L("")
L("  -- Training Cycle ID")
L("  tc1 uuid := gen_random_uuid();")
L("")
L("  -- Challenge IDs")
L("  ch1 uuid := gen_random_uuid();")
L("  ch2 uuid := gen_random_uuid();")
L("  ch3 uuid := gen_random_uuid();")
L("")
L("  -- Shared routine/cycle IDs")
L("  sr1 uuid := gen_random_uuid();")
L("  sr2 uuid := gen_random_uuid();")
L("  sc1 uuid := gen_random_uuid();")
L("")
L("  -- Goal IDs")
L("  g1 uuid := gen_random_uuid();")
L("  g2 uuid := gen_random_uuid();")
L("  g3 uuid := gen_random_uuid();")
L("")
L("BEGIN")
L("  -- Get the authenticated user")
L("  SELECT id INTO uid FROM auth.users LIMIT 1;")
L("  IF uid IS NULL THEN")
L("    RAISE EXCEPTION 'No user found in auth.users. Sign up first!';")
L("  END IF;")
L("")

# ------------------------------------------------------------------
# Profile
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- PROFILE")
L("  -- ============================================================")
L("  INSERT INTO profiles (id, display_name, weight_unit, avatar_url)")
L("  VALUES (uid, 'Phoenix Trainer', 'kg', NULL)")
L("  ON CONFLICT (id) DO UPDATE SET")
L("    display_name = EXCLUDED.display_name,")
L("    weight_unit = EXCLUDED.weight_unit;")
L("")

# ------------------------------------------------------------------
# Onboarding
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- ONBOARDING")
L("  -- ============================================================")
L(
    "  INSERT INTO user_onboarding (user_id, completed_at, version_seen, dismissed_whats_new)"
)
L(f"  VALUES (uid, '{sql_ts(NOW - timedelta(days=30))}', '1.2.0', true)")
L("  ON CONFLICT (user_id) DO NOTHING;")
L("")

# ------------------------------------------------------------------
# Routines + Routine Exercises
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- ROUTINES (all 25 from export)")
L("  -- ============================================================")

for routine in valid_routines:
    var = routine_vars[routine["id"]]
    name = sql_escape(routine["name"])
    desc = sql_escape(routine.get("description") or "")
    exs = exercises_by_routine[routine["id"]]
    ex_count = len(exs)
    use_count = routine.get("useCount", 0)

    # Estimate duration: ~5 min per exercise
    est_duration = ex_count * 5

    # last_used_at: if useCount > 0 or if it's one of the standalone routines
    last_used = "NULL"
    if routine.get("lastUsed"):
        ts = datetime.fromtimestamp(routine["lastUsed"] / 1000, tz=timezone.utc)
        last_used = f"'{sql_ts(ts)}'"
    elif routine["id"] in [s["id"] for s in standalone_routines]:
        # Give it a recent last_used
        ts = NOW - timedelta(days=random.randint(1, 14))
        last_used = f"'{sql_ts(ts)}'"

    # Tags based on routine name
    tags = []
    name_lower = name.lower()
    if "push" in name_lower:
        tags.extend(["push", "upper body"])
    elif "pull" in name_lower:
        tags.extend(["pull", "upper body"])
    elif "leg" in name_lower:
        tags.extend(["legs", "lower body"])
    elif "bench" in name_lower:
        tags.extend(["chest", "push"])
    elif "squat" in name_lower:
        tags.extend(["legs", "squat"])
    elif "press" in name_lower:
        tags.extend(["shoulders", "push"])
    elif "deadlift" in name_lower:
        tags.extend(["back", "pull"])
    elif "chest" in name_lower:
        tags.append("chest")
    elif "shoulder" in name_lower:
        tags.append("shoulders")
    elif "bicep" in name_lower or "tricep" in name_lower:
        tags.append("arms")
    elif "core" in name_lower:
        tags.append("core")

    tags_sql = (
        "ARRAY[" + ",".join(f"'{t}'" for t in tags) + "]::text[]"
        if tags
        else "ARRAY[]::text[]"
    )

    is_fav = "true" if routine in standalone_routines else "false"
    times_completed = max(
        use_count, random.randint(2, 8) if routine in standalone_routines else 0
    )

    L(
        f"  INSERT INTO routines (id, user_id, name, description, exercise_count, estimated_duration, times_completed, last_used_at, tags, is_favorite)"
    )
    L(
        f"  VALUES ({var}, uid, '{name}', '{desc}', {ex_count}, {est_duration}, {times_completed}, {last_used}, {tags_sql}, {is_fav});"
    )
    L("")

# Routine exercises
L("  -- ============================================================")
L("  -- ROUTINE EXERCISES")
L("  -- ============================================================")

for routine in valid_routines:
    var = routine_vars[routine["id"]]
    exs = exercises_by_routine[routine["id"]]
    L(f"  -- {routine['name']}")
    for rex in exs:
        name = sql_escape(rex["exerciseName"].strip())
        muscle = map_muscle(rex.get("exerciseMuscleGroup", "General"))
        weight = get_exercise_weight(rex)
        reps_list = parse_set_reps(rex.get("setReps", "10,10,10"))
        num_sets = len(reps_list) if reps_list else 3
        reps = reps_list[0] if reps_list else 10
        if reps == 0:
            reps = 10  # AMRAP -> default 10 for the routine template
        rest = rex.get("restSeconds", 60) or 60
        mode = map_mode(rex.get("mode", "Program:OldSchool"))
        order = rex.get("orderIndex", 0)

        L(
            f"  INSERT INTO routine_exercises (routine_id, name, muscle_group, sets, reps, weight, rest_seconds, mode, order_index)"
        )
        L(
            f"  VALUES ({var}, '{name}', '{muscle}', {num_sets}, {reps}, {weight}, {rest}, '{mode}', {order});"
        )
    L("")

# ------------------------------------------------------------------
# Training Cycle + Cycle Days
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- TRAINING CYCLE")
L("  -- ============================================================")

cycle = raw_training_cycles[0]
cycle_name = sql_escape(cycle["name"])
cycle_desc = sql_escape(
    cycle.get("description") or "Full body weekly rotation with rest days"
)
cycle_started = NOW - timedelta(days=21)

L(
    f"  INSERT INTO training_cycles (id, user_id, name, description, duration_weeks, current_week, status, workout_days, rest_days, started_at, last_used_at)"
)
L(
    f"  VALUES (tc1, uid, '{cycle_name}', '{cycle_desc}', 4, 3, 'active', 5, 2, '{sql_ts(cycle_started)}', '{sql_ts(NOW - timedelta(days=1))}');"
)
L("")

L("  -- Cycle Days")
for cd in raw_cycle_days:
    day_num = cd["dayNumber"]
    is_rest = cd["isRestDay"]
    day_type = "'rest'" if is_rest else "'training'"
    day_name = sql_escape(cd["name"])

    # Map the routine if it's a training day
    if is_rest or cd.get("routineId") is None:
        routine_ref = "NULL"
        rest_type = "'passive'" if is_rest else "NULL"
    else:
        # Find the matching routine variable
        export_rid = cd["routineId"]
        if export_rid in routine_vars:
            routine_ref = routine_vars[export_rid]
        else:
            # Skip if routine not found
            routine_ref = "NULL"
        rest_type = "NULL"

    # Add some variety to weight adjustments
    weight_adj = 0
    rep_mod = 0
    notes = f"'{day_name}'" if not is_rest else "NULL"

    L(
        f"  INSERT INTO cycle_days (cycle_id, day_number, day_type, routine_id, weight_adjustment, rep_modifier, rest_override, notes, rest_type)"
    )
    L(
        f"  VALUES (tc1, {day_num}, {day_type}, {routine_ref}, {weight_adj}, {rep_mod}, NULL, {notes}, {rest_type});"
    )

L("")

# ------------------------------------------------------------------
# Workout Sessions + Exercises + Sets
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- WORKOUT SESSIONS (spanning 4 weeks)")
L("  -- ============================================================")

ex_counter = 0  # global exercise counter for variable names

for session in sessions:
    svar = session["var"]
    name_sql = f"'{sql_escape(session['routine_name'])} Session'"
    started = sql_ts(session["started_at"])
    dur = session["duration_seconds"]
    vol = session["total_volume"]
    sc = session["set_count"]
    ec = session["exercise_count"]
    pc = session["pr_count"]
    rn = sql_escape(session["routine_name"])
    wm = session["workout_mode"]

    L(
        f"  INSERT INTO workout_sessions (id, user_id, name, started_at, duration_seconds, total_volume, set_count, exercise_count, pr_count, routine_name, workout_mode)"
    )
    L(
        f"  VALUES ({svar}, uid, {name_sql}, '{started}', {dur}, {vol}, {sc}, {ec}, {pc}, '{rn}', '{wm}');"
    )
    L("")

    # Exercises
    for ex in session["exercises"]:
        ex_counter += 1
        evar = f"e{ex_counter}"
        ename = sql_escape(ex["name"])
        emuscle = ex["muscle_group"]
        eorder = ex["order_index"]

        L(f"  INSERT INTO exercises (id, session_id, name, muscle_group, order_index)")
        L(f"  VALUES (gen_random_uuid(), {svar}, '{ename}', '{emuscle}', {eorder})")
        L(f"  RETURNING id INTO {evar};")
        L("")

        # Sets
        for s in ex["sets"]:
            sn = s["set_number"]
            tr = s["target_reps"]
            ar = s["actual_reps"]
            wk = s["weight_kg"]
            rpe = s["rpe"]
            ipr = "true" if s["is_pr"] else "false"

            L(
                f"  INSERT INTO sets (exercise_id, set_number, target_reps, actual_reps, weight_kg, rpe, is_pr)"
            )
            L(f"  VALUES ({evar}, {sn}, {tr}, {ar}, {wk}, {rpe}, {ipr});")

        L("")

# ------------------------------------------------------------------
# Rep Summaries (for biomechanics charts)
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- REP SUMMARIES (biomechanics data for select sets)")
L("  -- ============================================================")
L("  -- Generate detailed rep-level data for the most recent 5 sessions")
L("")

# Pick sets from the last 5 sessions for rep summaries
rep_summary_set_counter = 0
rep_summary_sessions = sessions[-5:]

for session in rep_summary_sessions:
    svar = session["var"]
    L(
        f"  -- Rep summaries for {session['routine_name']} ({sql_ts(session['started_at'])})"
    )

    # Pick 1-2 exercises per session for rep summaries
    summary_exs = session["exercises"][:2]
    for ex in summary_exs:
        # Get the first set for this exercise - we need a set_id reference
        first_set = ex["sets"][0]
        rep_summary_set_counter += 1
        if rep_summary_set_counter > 15:
            break

        set_var = f"set{rep_summary_set_counter}"
        ename = sql_escape(ex["name"])

        # We need to query the set_id, so we'll use a subquery approach
        # Instead, let's insert sets with RETURNING for the ones we need
        # Since sets are already inserted, we need to select them
        L(f"  SELECT s.id INTO {set_var} FROM sets s")
        L(f"    JOIN exercises e ON s.exercise_id = e.id")
        L(f"    WHERE e.session_id = {svar} AND e.name = '{ename}'")
        L(f"    AND s.set_number = 1 LIMIT 1;")
        L("")

        if f"{set_var}" and rep_summary_set_counter <= 15:
            base_weight = first_set["weight_kg"]
            num_reps = first_set["actual_reps"]

            for rep_num in range(1, min(num_reps + 1, 13)):
                # Velocity decreases slightly with fatigue
                fatigue_factor = 1.0 - (rep_num - 1) * 0.03
                mean_vel = round(random.uniform(0.4, 0.8) * fatigue_factor, 3)
                peak_vel = round(mean_vel * random.uniform(1.3, 1.6), 3)

                # Force based on weight (per cable * 2 for total, * 9.81 for N)
                base_force = base_weight * 2 * 9.81
                mean_force = round(base_force * random.uniform(0.85, 1.05), 1)
                peak_force = round(base_force * random.uniform(1.1, 1.4), 1)

                power = round(mean_force * mean_vel, 1)
                rom = round(random.uniform(250, 650), 0)  # mm
                tut = random.randint(1800, 4500)  # ms per rep

                # Asymmetry: small percentage left/right imbalance
                left_pct = random.uniform(0.47, 0.53)
                left_force = round(mean_force * left_pct, 1)
                right_force = round(mean_force * (1 - left_pct), 1)
                asymmetry = round(abs(left_pct - 0.5) * 200, 1)

                # VBT zone based on velocity
                if mean_vel > 0.75:
                    zone = "Speed-Strength"
                elif mean_vel > 0.5:
                    zone = "Strength-Speed"
                elif mean_vel > 0.35:
                    zone = "Strength"
                else:
                    zone = "Max Strength"

                L(
                    f"  INSERT INTO rep_summaries (set_id, rep_number, mean_velocity_mps, peak_velocity_mps, mean_force_n, peak_force_n, power_watts, rom_mm, tut_ms, left_force_avg, right_force_avg, asymmetry_pct, vbt_zone)"
                )
                L(
                    f"  VALUES ({set_var}, {rep_num}, {mean_vel}, {peak_vel}, {mean_force}, {peak_force}, {power}, {rom}, {tut}, {left_force}, {right_force}, {asymmetry}, '{zone}');"
                )

            L("")

    if rep_summary_set_counter > 15:
        break

# ------------------------------------------------------------------
# Personal Records
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- PERSONAL RECORDS")
L("  -- ============================================================")

for ex_name, pr in exercise_prs.items():
    ename = sql_escape(ex_name)
    muscle = pr["muscle_group"]
    weight = pr["weight"]
    achieved = sql_ts(pr["achieved_at"])
    prev = pr["previous_value"]
    prev_sql = f"{prev}" if prev is not None else "NULL"
    e1rm = estimated_1rm(weight, pr["reps"])

    # MAX_WEIGHT record
    L(
        f"  INSERT INTO personal_records (user_id, exercise_name, muscle_group, record_type, value, unit, achieved_at, previous_value)"
    )
    L(
        f"  VALUES (uid, '{ename}', '{muscle}', 'MAX_WEIGHT', {weight}, 'kg', '{achieved}', {prev_sql});"
    )

    # Also add 1RM record
    L(
        f"  INSERT INTO personal_records (user_id, exercise_name, muscle_group, record_type, value, unit, achieved_at, previous_value)"
    )
    L(
        f"  VALUES (uid, '{ename}', '{muscle}', '1RM', {e1rm}, 'kg', '{achieved}', NULL);"
    )

L("")

# ------------------------------------------------------------------
# Challenges
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- CHALLENGES (3 active)")
L("  -- ============================================================")

challenge_start = NOW - timedelta(days=5)
L(
    f"  INSERT INTO challenges (id, name, description, challenge_type, target_value, target_unit, start_date, end_date, difficulty, prize, is_active)"
)
L(
    f"  VALUES (ch1, 'February Volume Blitz', 'Accumulate 25,000 kg of total training volume by end of February. Push your limits!', 'volume', 25000, 'kg', '{sql_ts(challenge_start)}', '{sql_ts(challenge_start + timedelta(days=25))}', 'medium', 'Volume King Badge', true);"
)
L("")
L(
    f"  INSERT INTO challenges (id, name, description, challenge_type, target_value, target_unit, start_date, end_date, difficulty, prize, is_active)"
)
L(
    f"  VALUES (ch2, 'Consistency Streak', 'Train at least 5 days per week for 3 consecutive weeks. Show up and grind!', 'streak', 15, 'days', '{sql_ts(challenge_start)}', '{sql_ts(challenge_start + timedelta(days=21))}', 'hard', 'Iron Will Badge', true);"
)
L("")
L(
    f"  INSERT INTO challenges (id, name, description, challenge_type, target_value, target_unit, start_date, end_date, difficulty, prize, is_active)"
)
L(
    f"  VALUES (ch3, 'PR Crusher', 'Set 3 new personal records this month across any exercises.', 'pr_count', 3, 'PRs', '{sql_ts(challenge_start)}', '{sql_ts(challenge_start + timedelta(days=30))}', 'medium', 'PR Hunter Badge', true);"
)
L("")

# Join user to challenges
L("  INSERT INTO challenge_participants (challenge_id, user_id, joined_at)")
L(f"  VALUES (ch1, uid, '{sql_ts(challenge_start + timedelta(hours=2))}');")
L("  INSERT INTO challenge_participants (challenge_id, user_id, joined_at)")
L(f"  VALUES (ch2, uid, '{sql_ts(challenge_start + timedelta(hours=3))}');")
L("  INSERT INTO challenge_participants (challenge_id, user_id, joined_at)")
L(f"  VALUES (ch3, uid, '{sql_ts(challenge_start + timedelta(hours=4))}');")
L("")

# ------------------------------------------------------------------
# Shared Routines (2 to community feed)
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- SHARED ROUTINES (2 community shares)")
L("  -- ============================================================")

# Share the Chest and Legs routines
share_candidates = [r for r in standalone_routines if r["name"] in ["Chest", "Legs"]]
if len(share_candidates) < 2:
    share_candidates = standalone_routines[:2]

for i, routine in enumerate(share_candidates[:2]):
    sr_var = f"sr{i + 1}"
    r_var = routine_vars[routine["id"]]
    name = sql_escape(routine["name"])
    exs = exercises_by_routine[routine["id"]]

    # Build exercises snapshot JSON
    snapshot = []
    for rex in exs:
        ex_name = rex["exerciseName"].strip()
        snapshot.append(
            {
                "name": ex_name,
                "muscle_group": map_muscle(rex.get("exerciseMuscleGroup", "General")),
                "sets": len(parse_set_reps(rex.get("setReps", "10,10,10"))),
                "reps": parse_set_reps(rex.get("setReps", "10,10,10"))[0] or 10,
                "weight": get_exercise_weight(rex),
                "mode": map_mode(rex.get("mode", "Program:OldSchool")),
            }
        )

    snapshot_json = sql_escape(json.dumps(snapshot))
    est_dur = len(exs) * 5
    shared_at = NOW - timedelta(days=random.randint(3, 10))
    difficulty = "Intermediate"
    tags = ["vitruvian", name.lower()]
    tags_sql = "ARRAY[" + ",".join(f"'{t}'" for t in tags) + "]::text[]"

    desc = f"My {name.lower()} routine for the Vitruvian Trainer. Tested and refined over weeks of training."
    L(
        f"  INSERT INTO shared_routines (id, user_id, routine_id, name, description, exercise_count, estimated_duration, exercises_snapshot, tags, difficulty, vote_count, save_count, hot_score, shared_at)"
    )
    L(
        f"  VALUES ({sr_var}, uid, {r_var}, '{name} - Phoenix Edition', '{sql_escape(desc)}', {len(exs)}, {est_dur}, '{snapshot_json}'::jsonb, {tags_sql}, '{difficulty}', {random.randint(3, 15)}, {random.randint(1, 8)}, {round(random.uniform(5, 25), 2)}, '{sql_ts(shared_at)}');"
    )
    L("")

# ------------------------------------------------------------------
# Shared Cycle
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- SHARED CYCLE")
L("  -- ============================================================")

L(
    f"  INSERT INTO shared_cycles (id, user_id, cycle_id, name, description, duration_weeks, tags, difficulty, vote_count, save_count, hot_score, shared_at)"
)
L(
    f"  VALUES (sc1, uid, tc1, '{cycle_name} Program', 'A full-body weekly rotation designed for the Vitruvian Trainer. Hits every muscle group with strategic rest days.', 4, ARRAY['full body', 'weekly', 'vitruvian']::text[], 'Intermediate', {random.randint(5, 20)}, {random.randint(2, 10)}, {round(random.uniform(10, 30), 2)}, '{sql_ts(NOW - timedelta(days=7))}');"
)
L("")

# ------------------------------------------------------------------
# User Goals
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- USER GOALS")
L("  -- ============================================================")

# Goal 1: Weekly workout frequency
L(
    f"  INSERT INTO user_goals (id, user_id, goal_type, target_value, target_unit, exercise_name, period, status, created_at)"
)
L(
    f"  VALUES (g1, uid, 'frequency', 5, 'workouts', NULL, 'weekly', 'active', '{sql_ts(NOW - timedelta(days=14))}');"
)
L("")

# Goal 2: PR on bench press
L(
    f"  INSERT INTO user_goals (id, user_id, goal_type, target_value, target_unit, exercise_name, period, status, created_at)"
)
L(
    f"  VALUES (g2, uid, 'pr', 20, 'kg', 'Bench Press', 'monthly', 'active', '{sql_ts(NOW - timedelta(days=10))}');"
)
L("")

# Goal 3: Volume target
L(
    f"  INSERT INTO user_goals (id, user_id, goal_type, target_value, target_unit, exercise_name, period, status, created_at)"
)
L(
    f"  VALUES (g3, uid, 'volume', 10000, 'kg', NULL, 'monthly', 'active', '{sql_ts(NOW - timedelta(days=7))}');"
)
L("")

# ------------------------------------------------------------------
# Exercise Progress (for trending charts)
# ------------------------------------------------------------------
L("  -- ============================================================")
L("  -- EXERCISE PROGRESS (trending data)")
L("  -- ============================================================")

for entry in progress_entries:
    ename = sql_escape(entry["exercise_name"])
    svar = entry["session_var"]
    recorded = sql_ts(entry["recorded_at"])
    mw = entry["max_weight_kg"]
    tv = entry["total_volume_kg"]
    e1rm = entry["estimated_1rm_kg"]
    mr = entry["max_reps"]
    sc = entry["set_count"]

    L(
        f"  INSERT INTO exercise_progress (user_id, exercise_name, session_id, recorded_at, max_weight_kg, total_volume_kg, estimated_1rm_kg, max_reps, set_count)"
    )
    L(
        f"  VALUES (uid, '{ename}', {svar}, '{recorded}', {mw}, {tv}, {e1rm}, {mr}, {sc});"
    )

L("")

# ------------------------------------------------------------------
# Close the DO block
# ------------------------------------------------------------------
L("  RAISE NOTICE 'Seed data loaded successfully for user %', uid;")
L("END $$;")
L("")
L("-- ============================================================")
L("-- Verify seed data")
L("-- ============================================================")
L("DO $$ DECLARE uid uuid; cnt int; BEGIN")
L("  SELECT id INTO uid FROM auth.users LIMIT 1;")
L("  SELECT COUNT(*) INTO cnt FROM workout_sessions WHERE user_id = uid;")
L("  RAISE NOTICE 'Workout sessions: %', cnt;")
L("  SELECT COUNT(*) INTO cnt FROM routines WHERE user_id = uid;")
L("  RAISE NOTICE 'Routines: %', cnt;")
L("  SELECT COUNT(*) INTO cnt FROM personal_records WHERE user_id = uid;")
L("  RAISE NOTICE 'Personal records: %', cnt;")
L("  SELECT COUNT(*) INTO cnt FROM exercise_progress WHERE user_id = uid;")
L("  RAISE NOTICE 'Exercise progress entries: %', cnt;")
L(
    "  SELECT COUNT(*) INTO cnt FROM sets WHERE exercise_id IN (SELECT id FROM exercises WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id = uid));"
)
L("  RAISE NOTICE 'Total sets: %', cnt;")
L(
    "  SELECT COUNT(*) INTO cnt FROM rep_summaries WHERE set_id IN (SELECT s.id FROM sets s JOIN exercises e ON s.exercise_id = e.id JOIN workout_sessions ws ON e.session_id = ws.id WHERE ws.user_id = uid);"
)
L("  RAISE NOTICE 'Rep summaries: %', cnt;")
L("END $$;")

# ---------------------------------------------------------------------------
# Write output
# ---------------------------------------------------------------------------
sql_content = "\n".join(lines)
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write(sql_content)

print(f"\nSeed SQL written to: {OUTPUT_PATH}")
print(f"Total lines: {len(lines)}")
print(f"Routines: {len(valid_routines)}")
print(f"Workout sessions: {len(sessions)}")
print(f"Total exercises across sessions: {total_exercises}")
print(
    f"Personal records: {len(exercise_prs)} exercises x 2 types = {len(exercise_prs) * 2}"
)
print(f"Exercise progress entries: {len(progress_entries)}")
print(f"Rep summary sets: {rep_summary_set_counter}")
