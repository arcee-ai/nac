//! Heartbeat persistence owns control/materialization/admission ordering.
use super::*;
use anyhow::ensure;
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};

mod attention;
mod control;
pub(crate) use attention::heartbeat_attention_with_connection;
pub use attention::*;
pub use control::control_heartbeat;
mod execution;
mod materialize;
pub use materialize::materialize_heartbeats;
mod model;
pub use execution::heartbeat_admission_unavailable;
pub(crate) use execution::heartbeat_deadline_reached;
pub(crate) use execution::mark_heartbeat_action_denied;
pub(crate) use execution::{
    admit_heartbeat, heartbeat_prompt_committed, settle_heartbeat_with_connection,
};
pub use execution::{heartbeat_report, reconcile_heartbeat_occurrences};
pub use model::*;

#[cfg(test)]
mod tests;

const SCHEDULE_COLUMNS: &str = "schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,reason,starts,tokens_used,time_used_ms,usage_unknown,created_at_ms,updated_at_ms";
const OCCURRENCE_COLUMNS: &str = "occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id,inbox_item_id,run_id,generation,expected_revision,provisional_outcome,outcome,evidence,tokens_used,started_at_ms,settled_at_ms,attempt_count,settlement_sequence";

fn encode<T: Serialize>(value: &T) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}
fn vocabulary<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_value(value)?
        .as_str()
        .map(str::to_owned)
        .context("invalid heartbeat vocabulary")
}
fn decode<T: DeserializeOwned>(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<T> {
    let json: String = row.get(index)?;
    serde_json::from_str(&json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, e.into())
    })
}
fn enum_column<T: DeserializeOwned>(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<T> {
    let value: String = row.get(index)?;
    serde_json::from_value(serde_json::Value::String(value)).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, e.into())
    })
}
fn optional_enum<T: DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<Option<T>> {
    if row.get::<_, Option<String>>(index)?.is_none() {
        return Ok(None);
    }
    enum_column(row, index).map(Some)
}
fn schedule_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HeartbeatSchedule> {
    Ok(HeartbeatSchedule {
        schedule_id: row.get(0)?,
        session_id: row.get(1)?,
        version: row.get(2)?,
        state: enum_column(row, 3)?,
        binding: decode(row, 4)?,
        spec: decode(row, 5)?,
        anchor_ms: row.get(6)?,
        next_due_ms: row.get(7)?,
        reason: row.get(8)?,
        starts: row.get(9)?,
        tokens_used: row.get(10)?,
        time_used_ms: row.get(11)?,
        usage_unknown: row.get(12)?,
        created_at_ms: row.get(13)?,
        updated_at_ms: row.get(14)?,
    })
}
fn occurrence_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HeartbeatOccurrence> {
    Ok(HeartbeatOccurrence {
        occurrence_id: row.get(0)?,
        schedule_id: row.get(1)?,
        session_id: row.get(2)?,
        schedule_version: row.get(3)?,
        due_first_ms: row.get(4)?,
        due_last_ms: row.get(5)?,
        coalesced_count: row.get(6)?,
        run_now: row.get::<_, String>(7)? == "run_now",
        state: enum_column(row, 8)?,
        spec: decode(row, 9)?,
        receipt_id: row.get(10)?,
        inbox_item_id: row.get(11)?,
        run_id: row.get(12)?,
        generation: row.get(13)?,
        revision: row.get(14)?,
        provisional_outcome: optional_enum(row, 15)?,
        outcome: optional_enum(row, 16)?,
        evidence: row.get(17)?,
        tokens_used: row.get(18)?,
        started_at_ms: row.get(19)?,
        settled_at_ms: row.get(20)?,
        attempt_count: row.get(21)?,
        settlement_sequence: row.get(22)?,
    })
}
fn load_schedule(conn: &Connection, session_id: &str, id: &str) -> Result<HeartbeatSchedule> {
    conn.query_row(&format!("SELECT {SCHEDULE_COLUMNS} FROM heartbeat_schedules WHERE session_id=?1 AND schedule_id=?2"),params![session_id,id],schedule_row).optional()?.context("heartbeat schedule was not found")
}
fn active_occurrence(conn: &Connection, id: &str) -> Result<Option<HeartbeatOccurrence>> {
    Ok(conn.query_row(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE schedule_id=?1 AND state='admitted'"),[id],occurrence_row).optional()?)
}

coordinated_command! {
pub fn active_heartbeat_occurrences(path:&Path)->Result<Vec<HeartbeatOccurrence>> {
    let conn=open_runtime_connection(path)?;
    let mut query=conn.prepare(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE state='admitted' ORDER BY started_at_ms LIMIT ?1"))?;
    let rows=query.query_map([MAX_HEARTBEAT_CONCURRENCY],occurrence_row)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}
command ActiveHeartbeatOccurrencesCommand {}
call |_command| ()
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub fn heartbeat_for_run(path:&Path,session_id:&str,run_id:&str)->Result<Option<HeartbeatOccurrence>> {
    let conn=open_runtime_connection(path)?;
    Ok(conn.query_row(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE session_id=?1 AND run_id=?2"),params![session_id,run_id],occurrence_row).optional()?)
}
command HeartbeatForRunCommand { session_id:String=session_id.to_owned(),run_id:String=run_id.to_owned() }
call |command| (&command.session_id,&command.run_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

fn prune_history(conn: &Connection, schedule_id: &str) -> Result<()> {
    conn.execute("DELETE FROM heartbeat_occurrences WHERE schedule_id=?1 AND state IN ('settled','withdrawn') AND occurrence_id NOT IN (SELECT occurrence_id FROM heartbeat_occurrences WHERE schedule_id=?1 AND state IN ('settled','withdrawn') ORDER BY settlement_sequence DESC LIMIT ?2)",params![schedule_id,HEARTBEAT_HISTORY_LIMIT])?;
    Ok(())
}

fn next_settlement_sequence(conn: &Connection) -> Result<i64> {
    let last: i64 = conn.query_row(
        "SELECT coalesce(max(settlement_sequence),0) FROM heartbeat_occurrences",
        [],
        |row| row.get(0),
    )?;
    last.checked_add(1)
        .context("heartbeat result sequence exhausted")
}

coordinated_command! {
/// Provenance only: an automation inbox row has no person request. No schedule,
/// wake, approval mode or remembered grant is changed by this read.
pub(crate) fn heartbeat_person_inbox_request(path:&Path,session_id:&str,inbox_id:i64)->Result<Option<String>> {
    let conn=open_runtime_connection(path)?;
    Ok(conn.query_row("SELECT review_intent FROM session_inbox WHERE session_id=?1 AND id=?2",params![session_id,inbox_id],|row|row.get(0)).optional()?.flatten())
}
command HeartbeatPersonInboxRequestCommand {session_id:String=session_id.to_owned(),inbox_id:i64=inbox_id}
call |command| (&command.session_id,command.inbox_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
pub(crate) fn heartbeat_person_run_request(path:&Path,session_id:&str,run_id:&str)->Result<Option<String>> {
    let conn=open_runtime_connection(path)?;
    Ok(conn.query_row("SELECT review_intent FROM session_inbox WHERE session_id=?1 AND delivered_run_id=?2 AND status='delivered' AND review_intent IS NOT NULL ORDER BY id DESC LIMIT 1",params![session_id,run_id],|row|row.get(0)).optional()?)
}
command HeartbeatPersonRunRequestCommand {session_id:String=session_id.to_owned(),run_id:String=run_id.to_owned()}
call |command| (&command.session_id,&command.run_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
/// A schedule-specific attention gate defers only its exact bound goal's
/// automatic continuation. It never substitutes a paused/blocked goal status.
pub(crate) fn heartbeat_blocks_goal_continuation(path:&Path,session_id:&str,goal_id:&str)->Result<bool> {
    let conn=open_runtime_connection(path)?;
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM heartbeat_schedules WHERE session_id=?1 AND state='suspended' AND json_extract(specification_json,'$.goal_id')=?2)",params![session_id,goal_id],|row|row.get(0))?)
}
command HeartbeatBlocksGoalContinuationCommand {session_id:String=session_id.to_owned(),goal_id:String=goal_id.to_owned()}
call |command| (&command.session_id,&command.goal_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

/// Validate exact independent direct/Local scope inside the owning transaction.
fn current_binding(conn: &Connection, session_id: &str) -> Result<HeartbeatBinding> {
    // sessions.backend names the model provider, not the execution backend.
    // Durable SSH/Podman bindings are host_id/sandbox_json; the live prepared
    // boundary independently checks the constructed ExecutionBackend::Local.
    let binding = conn.query_row("SELECT config_version,cwd,(SELECT project_id FROM session_projects WHERE session_id=?1),'local' FROM sessions WHERE session_id=?1 AND behavior='direct' AND host_id IS NULL AND sandbox_json IS NULL AND NOT EXISTS(SELECT 1 FROM traditional_children WHERE child_session_id=?1) AND NOT EXISTS(SELECT 1 FROM managed_orchestrators WHERE orchestrator_session_id=?1)", [session_id], |row| Ok(HeartbeatBinding{config_version:row.get(0)?,cwd:row.get(1)?,project_id:row.get(2)?,backend:row.get(3)?,execution_cwd:None,scheduling_request:None,seen_through_sequence:0})).optional()?;
    binding.context("heartbeats require an existing independent direct Local chat")
}

coordinated_command! {
pub fn heartbeat_binding(path:&Path,session_id:&str) -> Result<HeartbeatBinding> {
    let conn=open_runtime_connection(path)?;
    current_binding(&conn,session_id)
}
command HeartbeatBindingCommand { session_id:String=session_id.to_owned() }
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Passive inventory, bounded on the serving owner's Local store.
pub fn list_heartbeats(path:&Path,session_id:Option<&str>) -> Result<Vec<HeartbeatSchedule>> {
    let conn=open_runtime_connection(path)?;
    let mut query=conn.prepare(&format!("SELECT {SCHEDULE_COLUMNS} FROM heartbeat_schedules WHERE (?1 IS NULL OR session_id=?1) AND state!='deleted' ORDER BY created_at_ms,schedule_id LIMIT 101"))?;
    let rows=query.query_map([session_id],schedule_row)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}
command ListHeartbeatsCommand { session_id:Option<String>=session_id.map(str::to_owned) }
call |command| (command.session_id.as_deref())
correlation |command| crate::telemetry::Correlation::session(command.session_id.as_deref());
port public;
}

coordinated_command! {
pub fn read_heartbeat(path:&Path,session_id:&str,schedule_id:&str) -> Result<HeartbeatSchedule> {
    let conn=open_runtime_connection(path)?;
    load_schedule(&conn,session_id,schedule_id)
}
command ReadHeartbeatCommand {session_id:String=session_id.to_owned(),schedule_id:String=schedule_id.to_owned()}
call |command| (&command.session_id,&command.schedule_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub fn heartbeat_history(path:&Path,session_id:&str,schedule_id:&str) -> Result<Vec<HeartbeatOccurrence>> {
    let conn=open_runtime_connection(path)?;
    load_schedule(&conn,session_id,schedule_id)?;
    let mut query=conn.prepare(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE session_id=?1 AND schedule_id=?2 ORDER BY coalesce(settlement_sequence,9223372036854775807) DESC,occurrence_id DESC LIMIT ?3"))?;
    let rows=query.query_map(params![session_id,schedule_id,HEARTBEAT_HISTORY_LIMIT+2],occurrence_row)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}
command HeartbeatHistoryCommand {session_id:String=session_id.to_owned(),schedule_id:String=schedule_id.to_owned()}
call |command| (&command.session_id,&command.schedule_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}
