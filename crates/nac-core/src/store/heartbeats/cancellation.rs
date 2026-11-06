//! Durable exact-run Stop intent, independent of later schedule controls.
use super::*;

pub(super) fn retain_stop_request(conn: &Connection, schedule_id: &str) -> Result<()> {
    let Some(active) = active_occurrence(conn, schedule_id)? else {
        return Ok(());
    };
    let request = serde_json::json!({
        "occurrence_id": active.occurrence_id,
        "run_id": active.run_id.context("admitted heartbeat has no run")?,
        "generation": active.generation.context("admitted heartbeat has no generation")?,
    });
    conn.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$._stop_request',json(?2)) WHERE schedule_id=?1", params![schedule_id, encode(&request)?])?;
    Ok(())
}

pub(super) fn consume_stop_request(conn: &Connection, active: &HeartbeatOccurrence) -> Result<()> {
    conn.execute("UPDATE heartbeat_schedules SET binding_json=json_remove(binding_json,'$._stop_request') WHERE schedule_id=?1 AND json_extract(binding_json,'$._stop_request.occurrence_id')=?2 AND json_extract(binding_json,'$._stop_request.run_id')=?3 AND json_extract(binding_json,'$._stop_request.generation')=?4",params![active.schedule_id,active.occurrence_id,active.run_id,active.generation])?;
    Ok(())
}

coordinated_command! {
/// Passive exact-admitted-run lookup. Delete alone never requests cancellation.
/// The stopped-state fallback retains pre-marker Stop behavior; old receipts
/// cannot address a settled occurrence or a successor run/generation.
pub fn heartbeat_stop_requested(path:&Path,session_id:&str,occurrence_id:&str,run_id:&str,generation:&str)->Result<bool> {
    let conn=open_runtime_connection(path)?;
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM heartbeat_occurrences o JOIN heartbeat_schedules s ON s.schedule_id=o.schedule_id AND s.session_id=o.session_id WHERE o.session_id=?1 AND o.occurrence_id=?2 AND o.run_id=?3 AND o.generation=?4 AND o.state='admitted' AND (s.state='stopped' OR (json_extract(s.binding_json,'$._stop_request.occurrence_id')=o.occurrence_id AND json_extract(s.binding_json,'$._stop_request.run_id')=o.run_id AND json_extract(s.binding_json,'$._stop_request.generation')=o.generation)))",params![session_id,occurrence_id,run_id,generation],|row|row.get(0))?)
}
command HeartbeatStopRequestedCommand {session_id:String=session_id.to_owned(),occurrence_id:String=occurrence_id.to_owned(),run_id:String=run_id.to_owned(),generation:String=generation.to_owned()}
call |command| (&command.session_id,&command.occurrence_id,&command.run_id,&command.generation)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}
