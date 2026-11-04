//! Schema50 over canonical physical49: the calendar occurrence format fence.
//! The migration owner retains its single transaction, commit and rollback.
use anyhow::{ensure, Result};
use rusqlite::Connection;

const COLUMNS: &str = "occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id,inbox_item_id,run_id,generation,expected_revision,provisional_outcome,outcome,evidence,tokens_used,started_at_ms,settled_at_ms,attempt_count,settlement_sequence";

/// Extend only the internal source CHECK. Every retained value, receipt, rowid,
/// foreign key and uniqueness/retention index survives without reinterpretation.
pub(super) fn rebuild_occurrences_for_calendar(conn: &Connection) -> Result<()> {
    ensure!(
        !conn.is_autocommit(),
        "calendar format migration requires its owning transaction"
    );
    conn.execute_batch(
        "CREATE TABLE heartbeat_occurrences_calendar_upgrade (
            occurrence_id TEXT PRIMARY KEY,
            schedule_id TEXT NOT NULL REFERENCES heartbeat_schedules(schedule_id) ON DELETE CASCADE,
            session_id TEXT,
            schedule_version INTEGER NOT NULL CHECK(schedule_version >= 1),
            due_first_ms INTEGER NOT NULL,
            due_last_ms INTEGER NOT NULL,
            coalesced_count INTEGER NOT NULL CHECK(coalesced_count > 0),
            source TEXT NOT NULL CHECK(source IN ('interval','run_now','calendar')),
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
        );",
    )?;
    conn.execute_batch(&format!(
        "INSERT INTO heartbeat_occurrences_calendar_upgrade(rowid,{COLUMNS})
            SELECT rowid,{COLUMNS} FROM heartbeat_occurrences;
        DROP TABLE heartbeat_occurrences;
        ALTER TABLE heartbeat_occurrences_calendar_upgrade RENAME TO heartbeat_occurrences;
        CREATE UNIQUE INDEX idx_heartbeat_pending
            ON heartbeat_occurrences(schedule_id) WHERE state='pending';
        CREATE UNIQUE INDEX idx_heartbeat_active
            ON heartbeat_occurrences(schedule_id) WHERE state='admitted';
        CREATE INDEX idx_heartbeat_history ON heartbeat_occurrences(schedule_id,due_last_ms DESC);
        CREATE INDEX idx_heartbeat_run ON heartbeat_occurrences(session_id,run_id);"
    ))?;
    Ok(())
}

/// Reject a foreign same-version layout before calendar commands can persist a
/// new typed spec into an interval-only store. This inspects format, never row
/// origins or legacy NULL attribution, and preserves both known old lineages.
pub(super) fn verify_format(conn: &Connection) -> Result<()> {
    let sql: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='heartbeat_occurrences'",
        [],
        |row| row.get(0),
    )?;
    let compact: String = sql.split_whitespace().collect();
    ensure!(compact.contains("CHECK(sourceIN('interval','run_now','calendar'))"), "unsupported calendar store format at schema50; reconcile the actual schema lineage before use");
    let mut query =
        conn.prepare("SELECT name FROM pragma_table_info('heartbeat_occurrences') ORDER BY cid")?;
    let names = query
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ensure!(
        names.join(",") == COLUMNS,
        "unsupported calendar occurrence layout at schema50"
    );
    let nullable: bool = conn.query_row("SELECT \"notnull\"=0 FROM pragma_table_info('heartbeat_occurrences') WHERE name='session_id'",[],|row|row.get(0))?;
    let session_fk: i64 = conn.query_row("SELECT count(*) FROM pragma_foreign_key_list('heartbeat_occurrences') WHERE \"table\"='sessions'",[],|row|row.get(0))?;
    ensure!(
        nullable && session_fk == 0,
        "calendar migration must preserve schema48/49 retained occurrence ownership"
    );
    Ok(())
}
