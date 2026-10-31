//! Passive list attention and invocation-only human acknowledgement metadata.
use super::*;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatAttentionResult {
    pub occurrence_id: String,
    pub schedule_id: String,
    pub run_id: Option<String>,
    pub outcome: HeartbeatOutcome,
    pub sequence: i64,
    pub seen: bool,
}

#[derive(Debug, Default)]
pub struct HeartbeatAttentionSnapshot {
    pub quiet_updated_at: HashMap<String, String>,
    pub run_revisions: HashMap<String, i64>,
    pub results: HashMap<String, Vec<HeartbeatAttentionResult>>,
}

coordinated_command! {
/// One read snapshot for all list projections. Empty/quiet checks never acquire
/// an execution lease, attach services or act as interactive approvers.
pub fn heartbeat_attention_snapshot(path:&Path)->Result<HeartbeatAttentionSnapshot> {
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction()?;
    let snapshot=heartbeat_attention_with_connection(&tx)?;
    tx.commit()?;
    Ok(snapshot)
}
command HeartbeatAttentionSnapshotCommand {}
call |_command| ()
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

pub(crate) fn heartbeat_attention_with_connection(
    tx: &Connection,
) -> Result<HeartbeatAttentionSnapshot> {
    let mut snapshot = HeartbeatAttentionSnapshot::default();
    {
        let mut query =
            tx.prepare("SELECT session_id,max(id) FROM session_run_outcomes GROUP BY session_id")?;
        for row in query.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })? {
            let (session, revision) = row?;
            snapshot.run_revisions.insert(session, revision);
        }
    }
    {
        let mut query=tx.prepare("SELECT o.session_id,o.occurrence_id,o.schedule_id,o.run_id,o.outcome,o.settlement_sequence,coalesce(json_extract(s.binding_json,'$.seen_through_sequence'),0) FROM heartbeat_occurrences o JOIN heartbeat_schedules s ON s.schedule_id=o.schedule_id WHERE o.outcome IS NOT NULL AND o.settlement_sequence IS NOT NULL ORDER BY o.settlement_sequence DESC LIMIT ?1")?;
        let rows = query.query_map([MAX_HEARTBEAT_SCHEDULES * HEARTBEAT_HISTORY_LIMIT], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?;
        for row in rows {
            let (session, occurrence_id, schedule_id, run_id, outcome, sequence, seen) = row?;
            let results = snapshot.results.entry(session).or_default();
            if results.len() < HEARTBEAT_HISTORY_LIMIT as usize {
                results.push(HeartbeatAttentionResult {
                    occurrence_id,
                    schedule_id,
                    run_id,
                    outcome: serde_json::from_value(serde_json::Value::String(outcome))
                        .unwrap_or(HeartbeatOutcome::Unknown),
                    sequence,
                    seen: sequence <= seen,
                });
            }
        }
    }
    {
        let mut query=tx.prepare("SELECT s.session_id,json_extract(h.binding_json,'$._attention_base_updated_at') FROM sessions s JOIN heartbeat_schedules h ON h.session_id=s.session_id WHERE json_extract(h.binding_json,'$._attention_through_updated_at')=s.updated_at AND json_extract(h.binding_json,'$._attention_through_run_revision')=(SELECT coalesce(max(id),0) FROM session_run_outcomes WHERE session_id=s.session_id) AND json_extract(h.binding_json,'$._attention_base_updated_at') IS NOT NULL AND EXISTS(SELECT 1 FROM heartbeat_occurrences o WHERE o.schedule_id=h.schedule_id AND o.outcome='unchanged' AND o.state='settled' AND o.settlement_sequence=(SELECT max(settlement_sequence) FROM heartbeat_occurrences WHERE session_id=s.session_id))")?;
        for row in query.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (session, updated) = row?;
            snapshot.quiet_updated_at.insert(session, updated);
        }
    }
    Ok(snapshot)
}

coordinated_command! {
/// Human presentation acknowledgement is monotonic, scoped to this chat and
/// bounded by already-observed durable results. It grants no agent authority,
/// changes no schedule version/state and never resumes scheduling.
pub fn acknowledge_heartbeat_attention(path:&Path,session_id:&str,through_sequence:i64)->Result<()> {
    ensure!(through_sequence>=0,"invalid heartbeat attention sequence");
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let latest:i64=tx.query_row("SELECT coalesce(max(settlement_sequence),0) FROM heartbeat_occurrences WHERE session_id=?1",[session_id],|row|row.get(0))?;
    ensure!(through_sequence<=latest,"heartbeat attention acknowledgement cannot cover future results");
    tx.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$.seen_through_sequence',max(coalesce(json_extract(binding_json,'$.seen_through_sequence'),0),?2)) WHERE session_id=?1",params![session_id,through_sequence])?;
    tx.commit()?;
    Ok(())
}
command AcknowledgeHeartbeatAttentionCommand {session_id:String=session_id.to_owned(),through_sequence:i64=through_sequence}
call |command| (&command.session_id,command.through_sequence)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}
