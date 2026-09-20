"""Deterministic concurrent-client checks for the sync reliability RPC locks.

This test is intentionally separate from the transaction-rolled-back SQL
regression. It runs two real psql clients against the isolated local fixture
container and observes the second client waiting on an advisory lock before
allowing the first transaction to commit.
"""

from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass


CONTAINER = "phoenix-reliability-postgres-20260920"
EXPECTED_IMAGE = "postgres:17-alpine"
DATABASE = "phoenix_reliability"
DATABASE_USER = "postgres"
FIXTURE_USER = "00000000-0000-4000-8000-0000000000c0"


def cleanup_sql() -> str:
    # Production workout_sessions.user_id is RESTRICT rather than CASCADE, so
    # remove owned roots explicitly before deleting the disposable auth user.
    return f"""
      DELETE FROM public.workout_sessions WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.training_cycles WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.routines WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.personal_records WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.exercise_progress WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.workout_deletion_tombstones WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.training_cycle_deletion_tombstones WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.profile_ownership_claims WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.profile_ownership_events WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.profile_ownership_transfers WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM public.local_profiles WHERE user_id = '{FIXTURE_USER}'::uuid;
      DELETE FROM auth.users WHERE id = '{FIXTURE_USER}'::uuid;
    """


def docker_psql(sql: str, *, app_name: str = "phoenix-reliability-control") -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "docker",
            "exec",
            "-e",
            f"PGAPPNAME={app_name}",
            CONTAINER,
            "psql",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            DATABASE_USER,
            "-d",
            DATABASE,
            "-Atq",
            "-c",
            sql,
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )


def start_psql(sql: str, app_name: str) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [
            "docker",
            "exec",
            "-e",
            f"PGAPPNAME={app_name}",
            CONTAINER,
            "psql",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            DATABASE_USER,
            "-d",
            DATABASE,
            "-Atq",
            "-c",
            sql,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def require_success(result: subprocess.CompletedProcess[str], label: str) -> str:
    if result.returncode != 0:
        raise AssertionError(f"{label} failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout.strip()


def activity(app_name: str) -> str:
    result = docker_psql(
        "SELECT COALESCE(wait_event_type,'') || '|' || COALESCE(wait_event,'') "
        "FROM pg_catalog.pg_stat_activity "
        f"WHERE application_name = '{app_name}'"
    )
    return require_success(result, f"inspect {app_name}")


def wait_for_activity(app_name: str, expected_prefix: str, timeout_seconds: float = 8.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    last = ""
    while time.monotonic() < deadline:
        last = activity(app_name)
        if last.startswith(expected_prefix):
            return
        time.sleep(0.05)
    raise AssertionError(
        f"{app_name} never reached {expected_prefix!r}; last pg_stat_activity value was {last!r}"
    )


@dataclass
class ClientResult:
    returncode: int
    stdout: str
    stderr: str


def finish(client: subprocess.Popen[str], label: str, timeout_seconds: float = 12.0) -> ClientResult:
    try:
        stdout, stderr = client.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        client.kill()
        stdout, stderr = client.communicate()
        raise AssertionError(f"{label} timed out: {stdout}\n{stderr}")
    return ClientResult(client.returncode, stdout, stderr)


def assert_blocked_pair(
    first_sql: str,
    first_app: str,
    second_sql: str,
    second_app: str,
    *,
    second_must_succeed: bool,
) -> tuple[ClientResult, ClientResult]:
    first = start_psql(first_sql, first_app)
    try:
        wait_for_activity(first_app, "Timeout|PgSleep")
        second = start_psql(second_sql, second_app)
        try:
            wait_for_activity(second_app, "Lock|advisory")
            first_result = finish(first, first_app)
            second_result = finish(second, second_app)
        except BaseException:
            second.kill()
            second.communicate()
            raise
    except BaseException:
        first.kill()
        first.communicate()
        raise

    if first_result.returncode != 0:
        raise AssertionError(f"{first_app} failed: {first_result.stderr.strip()}")
    if second_must_succeed and second_result.returncode != 0:
        raise AssertionError(f"{second_app} failed: {second_result.stderr.strip()}")
    if not second_must_succeed and second_result.returncode == 0:
        raise AssertionError(f"{second_app} unexpectedly succeeded")
    return first_result, second_result


def main() -> int:
    inspected = subprocess.run(
        ["docker", "inspect", "--format", "{{.Name}}|{{.Config.Image}}", CONTAINER],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    identity = require_success(inspected, "inspect isolated PostgreSQL container")
    if identity != f"/{CONTAINER}|{EXPECTED_IMAGE}":
        raise AssertionError(f"refusing unexpected container identity: {identity!r}")

    setup = cleanup_sql() + f"""
      INSERT INTO auth.users(id) VALUES ('{FIXTURE_USER}'::uuid);
      INSERT INTO public.local_profiles(user_id,id,name,color_index) VALUES
        ('{FIXTURE_USER}'::uuid,'source','Source',1),
        ('{FIXTURE_USER}'::uuid,'default','Default',2),
        ('{FIXTURE_USER}'::uuid,'other','Other',3);
      INSERT INTO public.training_cycles(id,user_id,local_profile_id,name,updated_at) VALUES
        ('c0000000-0000-4000-8000-000000000001','{FIXTURE_USER}'::uuid,'source','Base','2030-01-01T00:00:00Z');
      INSERT INTO public.workout_sessions(id,user_id,local_profile_id,name,updated_at) VALUES
        ('c0000000-0000-4000-8000-000000000002','{FIXTURE_USER}'::uuid,'source','Owned','2030-01-01T00:00:00Z');
    """
    require_success(docker_psql(setup), "setup concurrency fixtures")

    try:
        # Newer structure owns the cycle lock through its full day replacement.
        # The older writer must wait, then reject without changing the new day.
        newer_cycle = f"""
          SET statement_timeout='15s'; BEGIN;
          SELECT * FROM public.upsert_training_cycles_with_days_lww(
            '{FIXTURE_USER}'::uuid,
            '[{{"id":"c0000000-0000-4000-8000-000000000001","user_id":"{FIXTURE_USER}","local_profile_id":"source","name":"Newer","updated_at":"2030-01-03T00:00:00Z"}}]'::jsonb,
            '[{{"cycle_id":"c0000000-0000-4000-8000-000000000001","day_number":1,"day_type":"workout","notes":"newer-day"}}]'::jsonb
          );
          SELECT pg_sleep(3); COMMIT;
        """
        older_cycle = f"""
          SET statement_timeout='15s';
          SELECT * FROM public.upsert_training_cycles_with_days_lww(
            '{FIXTURE_USER}'::uuid,
            '[{{"id":"c0000000-0000-4000-8000-000000000001","user_id":"{FIXTURE_USER}","local_profile_id":"source","name":"Older","updated_at":"2030-01-02T00:00:00Z"}}]'::jsonb,
            '[{{"cycle_id":"c0000000-0000-4000-8000-000000000001","day_number":1,"day_type":"workout","notes":"older-day"}}]'::jsonb
          );
        """
        _, older_result = assert_blocked_pair(
            newer_cycle,
            "phoenix-cycle-newer",
            older_cycle,
            "phoenix-cycle-older",
            second_must_succeed=True,
        )
        if "|f|" not in f"|{older_result.stdout.strip()}|":
            raise AssertionError(f"older cycle writer was not rejected: {older_result.stdout!r}")
        state = require_success(
            docker_psql(
                "SELECT c.name || '|' || d.notes FROM public.training_cycles c "
                "JOIN public.cycle_days d ON d.cycle_id=c.id "
                "WHERE c.id='c0000000-0000-4000-8000-000000000001'::uuid"
            ),
            "assert newer cycle structure",
        )
        if state != "Newer|newer-day":
            raise AssertionError(f"stale cycle structure won: {state!r}")

        # A committed delete tombstone wins against an overlapping older active
        # writer. The active writer is observed waiting on the same cycle lock.
        deleting_cycle = f"""
          SET statement_timeout='15s'; BEGIN;
          SELECT * FROM public.delete_training_cycles_lww(
            '{FIXTURE_USER}'::uuid,
            '[{{"id":"c0000000-0000-4000-8000-000000000001","updatedAt":"2030-01-05T00:00:00Z"}}]'::jsonb
          );
          SELECT pg_sleep(3); COMMIT;
        """
        stale_active = f"""
          SET statement_timeout='15s';
          SELECT * FROM public.upsert_training_cycles_with_days_lww(
            '{FIXTURE_USER}'::uuid,
            '[{{"id":"c0000000-0000-4000-8000-000000000001","user_id":"{FIXTURE_USER}","local_profile_id":"source","name":"Stale active","updated_at":"2030-01-04T00:00:00Z"}}]'::jsonb,
            '[]'::jsonb
          );
        """
        _, stale_result = assert_blocked_pair(
            deleting_cycle,
            "phoenix-cycle-delete",
            stale_active,
            "phoenix-cycle-stale-active",
            second_must_succeed=True,
        )
        if "|f|" not in f"|{stale_result.stdout.strip()}|":
            raise AssertionError(f"stale active cycle was not rejected: {stale_result.stdout!r}")
        deleted_state = require_success(
            docker_psql(
                "SELECT (NOT EXISTS(SELECT 1 FROM public.training_cycles "
                "WHERE id='c0000000-0000-4000-8000-000000000001'::uuid))::text || '|' || "
                "EXISTS(SELECT 1 FROM public.training_cycle_deletion_tombstones "
                "WHERE user_id='00000000-0000-4000-8000-0000000000c0'::uuid "
                "AND cycle_id='c0000000-0000-4000-8000-000000000001'::uuid)::text"
            ),
            "assert concurrent cycle deletion",
        )
        if deleted_state != "true|true":
            raise AssertionError(f"concurrent delete lost: {deleted_state!r}")

        # Two different mutation ids still serialize on the affected ownership
        # identity. After source -> default commits, source -> other must reject.
        first_transfer = f"""
          SET statement_timeout='15s'; BEGIN;
          SELECT * FROM public.transfer_profile_ownership(
            '{FIXTURE_USER}'::uuid,
            '[{{"mutationId":"c0000000-0000-4000-8000-000000000011","sourceProfileId":"source","targetProfileId":"default","workoutSessionIds":["c0000000-0000-4000-8000-000000000002"],"routineIds":[],"cycleIds":[],"personalRecordIds":[]}}]'::jsonb
          );
          SELECT pg_sleep(3); COMMIT;
        """
        conflicting_transfer = f"""
          SET statement_timeout='15s';
          SELECT * FROM public.transfer_profile_ownership(
            '{FIXTURE_USER}'::uuid,
            '[{{"mutationId":"c0000000-0000-4000-8000-000000000012","sourceProfileId":"source","targetProfileId":"other","workoutSessionIds":["c0000000-0000-4000-8000-000000000002"],"routineIds":[],"cycleIds":[],"personalRecordIds":[]}}]'::jsonb
          );
        """
        _, conflict_result = assert_blocked_pair(
            first_transfer,
            "phoenix-owner-first",
            conflicting_transfer,
            "phoenix-owner-conflict",
            second_must_succeed=False,
        )
        if "ownership_source_or_entity_mismatch" not in conflict_result.stderr:
            raise AssertionError(f"unexpected ownership rejection: {conflict_result.stderr!r}")
        ownership_state = require_success(
            docker_psql(
                "SELECT local_profile_id || '|' || "
                "(SELECT count(*) FROM public.profile_ownership_events "
                "WHERE user_id='00000000-0000-4000-8000-0000000000c0'::uuid)::text "
                "FROM public.workout_sessions "
                "WHERE id='c0000000-0000-4000-8000-000000000002'::uuid"
            ),
            "assert serialized ownership transfer",
        )
        if ownership_state != "default|1":
            raise AssertionError(f"ownership conflict changed the winner: {ownership_state!r}")

        print("sync reliability concurrent-client contract passed")
        return 0
    finally:
        require_success(docker_psql(cleanup_sql()), "cleanup concurrency fixtures")


if __name__ == "__main__":
    raise SystemExit(main())
