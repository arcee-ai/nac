//! ALL-483's allocated physical migration 48. The caller owns one migration
//! transaction with foreign keys enabled. No filesystem effects occur here.
use super::*;

pub(super) fn migrate(conn: &Connection) -> Result<()> {
    let installed: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='heartbeat_fresh_destinations')",
        [],
        |row| row.get(0),
    )?;
    if installed {
        let nullable: bool = conn.query_row("SELECT \"notnull\"=0 FROM pragma_table_info('heartbeat_schedules') WHERE name='session_id'", [], |row|row.get(0))?;
        anyhow::ensure!(
            nullable,
            "fresh schedule schema marker has an incompatible session ownership layout"
        );
        let allowance: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('heartbeat_retained_allowance') WHERE name='revision') AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='heartbeat_retained_commands')", [], |row|row.get(0))?;
        anyhow::ensure!(
            allowance,
            "fresh schedule schema marker has an incompatible host allowance layout"
        );
        return Ok(());
    }
    // Copy the parent and both children before removing any original table.
    // Dropping an original parent while its children still refer to it would
    // cascade historical receipts even inside a migration transaction.
    conn.execute_batch(
        "CREATE TABLE heartbeat_schedules_v48 (
            schedule_id TEXT PRIMARY KEY,
            session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
            version INTEGER NOT NULL CHECK(version >= 1),
            state TEXT NOT NULL CHECK(state IN ('active','paused','suspended','stopped','finished','deleted')),
            binding_json TEXT NOT NULL,
            specification_json TEXT NOT NULL,
            anchor_ms INTEGER NOT NULL CHECK(anchor_ms >= 0),
            next_due_ms INTEGER NOT NULL CHECK(next_due_ms >= 0),
            reason TEXT,
            starts INTEGER NOT NULL DEFAULT 0 CHECK(starts >= 0),
            tokens_used INTEGER NOT NULL DEFAULT 0 CHECK(tokens_used >= 0),
            time_used_ms INTEGER NOT NULL DEFAULT 0 CHECK(time_used_ms >= 0),
            usage_unknown INTEGER NOT NULL DEFAULT 0 CHECK(usage_unknown IN (0,1)),
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        INSERT INTO heartbeat_schedules_v48 SELECT * FROM heartbeat_schedules;
        CREATE TABLE heartbeat_occurrences_v48 (
            occurrence_id TEXT PRIMARY KEY,
            schedule_id TEXT NOT NULL REFERENCES heartbeat_schedules_v48(schedule_id) ON DELETE CASCADE,
            session_id TEXT,
            schedule_version INTEGER NOT NULL CHECK(schedule_version >= 1),
            due_first_ms INTEGER NOT NULL,
            due_last_ms INTEGER NOT NULL,
            coalesced_count INTEGER NOT NULL CHECK(coalesced_count > 0),
            source TEXT NOT NULL CHECK(source IN ('interval','run_now')),
            state TEXT NOT NULL CHECK(state IN ('pending','admitted','settled','withdrawn')),
            specification_json TEXT NOT NULL,
            receipt_id TEXT NOT NULL UNIQUE,
            inbox_item_id INTEGER UNIQUE REFERENCES session_inbox(id) ON DELETE SET NULL,
            run_id TEXT UNIQUE,
            generation TEXT,
            expected_revision INTEGER NOT NULL DEFAULT 1 CHECK(expected_revision >= 1),
            provisional_outcome TEXT,
            outcome TEXT,
            evidence TEXT,
            tokens_used INTEGER,
            started_at_ms INTEGER,
            settled_at_ms INTEGER,
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
            settlement_sequence INTEGER UNIQUE CHECK(settlement_sequence > 0),
            CHECK ((state IN ('settled','withdrawn')) = (settlement_sequence IS NOT NULL))
        );
        INSERT INTO heartbeat_occurrences_v48 SELECT * FROM heartbeat_occurrences;
        CREATE TABLE heartbeat_commands_v48 (
            session_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            canonical_digest TEXT NOT NULL,
            schedule_id TEXT NOT NULL REFERENCES heartbeat_schedules_v48(schedule_id) ON DELETE CASCADE,
            response_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY(session_id,request_id)
        );
        INSERT INTO heartbeat_commands_v48 SELECT * FROM heartbeat_commands;
        DROP TABLE heartbeat_commands;
        DROP TABLE heartbeat_occurrences;
        DROP TABLE heartbeat_schedules;
        ALTER TABLE heartbeat_schedules_v48 RENAME TO heartbeat_schedules;
        ALTER TABLE heartbeat_occurrences_v48 RENAME TO heartbeat_occurrences;
        ALTER TABLE heartbeat_commands_v48 RENAME TO heartbeat_commands;
        CREATE INDEX idx_heartbeat_due ON heartbeat_schedules(state,next_due_ms);
        CREATE INDEX idx_heartbeat_session ON heartbeat_schedules(session_id);
        CREATE UNIQUE INDEX idx_heartbeat_pending ON heartbeat_occurrences(schedule_id) WHERE state='pending';
        CREATE UNIQUE INDEX idx_heartbeat_active ON heartbeat_occurrences(schedule_id) WHERE state='admitted';
        CREATE INDEX idx_heartbeat_history ON heartbeat_occurrences(schedule_id,due_last_ms DESC);
        CREATE INDEX idx_heartbeat_run ON heartbeat_occurrences(session_id,run_id);
        CREATE TABLE heartbeat_fresh_destinations (
            schedule_id TEXT PRIMARY KEY REFERENCES heartbeat_schedules(schedule_id) ON DELETE CASCADE,
            project_id TEXT NOT NULL,
            creator_session_id TEXT,
            destination_json TEXT NOT NULL,
            binding_json TEXT NOT NULL
        );
        CREATE INDEX idx_heartbeat_fresh_project ON heartbeat_fresh_destinations(project_id);
        CREATE TABLE heartbeat_task_launches (
            occurrence_id TEXT PRIMARY KEY,
            schedule_id TEXT NOT NULL,
            request_id TEXT NOT NULL UNIQUE,
            project_id TEXT NOT NULL,
            launch_json TEXT NOT NULL,
            session_id TEXT UNIQUE,
            first_input_id INTEGER,
            stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN (0,1)),
            initial_run_id TEXT UNIQUE,
            initial_generation TEXT,
            initial_outcome_json TEXT,
            created_at_ms INTEGER NOT NULL,
            CHECK((initial_run_id IS NULL)=(initial_generation IS NULL))
        );
        CREATE INDEX idx_heartbeat_retained_schedule ON heartbeat_task_launches(schedule_id);
        CREATE TABLE heartbeat_retained_allowance (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1),
            retained_limit INTEGER NOT NULL CHECK(retained_limit BETWEEN 1 AND 10000),
            revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1)
        );
        INSERT INTO heartbeat_retained_allowance(singleton,retained_limit) VALUES(1,100);
        CREATE TABLE heartbeat_retained_commands (
            request_id TEXT PRIMARY KEY,
            canonical_digest TEXT NOT NULL,
            response_json TEXT NOT NULL
        );",
    )?;
    let violations: i64 =
        conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    anyhow::ensure!(
        violations == 0,
        "fresh task migration violates foreign keys"
    );
    Ok(())
}
