//! ALL-480's additive schema, installed by the allocated migration only.
use super::*;

pub(in crate::store) fn create_heartbeat_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS heartbeat_schedules (
            schedule_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
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
        CREATE INDEX IF NOT EXISTS idx_heartbeat_due ON heartbeat_schedules(state,next_due_ms);
        CREATE INDEX IF NOT EXISTS idx_heartbeat_session ON heartbeat_schedules(session_id);
        CREATE TABLE IF NOT EXISTS heartbeat_occurrences (
            occurrence_id TEXT PRIMARY KEY,
            schedule_id TEXT NOT NULL REFERENCES heartbeat_schedules(schedule_id) ON DELETE CASCADE,
            session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
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
        CREATE UNIQUE INDEX IF NOT EXISTS idx_heartbeat_pending
            ON heartbeat_occurrences(schedule_id) WHERE state='pending';
        CREATE UNIQUE INDEX IF NOT EXISTS idx_heartbeat_active
            ON heartbeat_occurrences(schedule_id) WHERE state='admitted';
        CREATE INDEX IF NOT EXISTS idx_heartbeat_history
            ON heartbeat_occurrences(schedule_id, due_last_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_heartbeat_run ON heartbeat_occurrences(session_id,run_id);
        CREATE TABLE IF NOT EXISTS heartbeat_commands (
            session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
            request_id TEXT NOT NULL,
            canonical_digest TEXT NOT NULL,
            schedule_id TEXT NOT NULL REFERENCES heartbeat_schedules(schedule_id) ON DELETE CASCADE,
            response_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY(session_id,request_id)
        );"
    )?;
    Ok(())
}
