//! Retained initial outcomes and human acknowledgement belong to each produced
//! task. A standalone schedule's siblings never share attention metadata.
use super::*;

pub(super) fn append_results(
    conn: &Connection,
    snapshot: &mut HeartbeatAttentionSnapshot,
) -> Result<()> {
    let mut query = conn.prepare(
        "SELECT session_id,initial_outcome_json,
                coalesce(json_extract(launch_json,'$._attention_seen_through_sequence'),0)
         FROM heartbeat_task_launches WHERE initial_outcome_json IS NOT NULL
         ORDER BY created_at_ms DESC,occurrence_id DESC LIMIT 10000",
    )?;
    let rows = query.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    for row in rows {
        let (session, json, seen) = row?;
        let result: HeartbeatOccurrence = serde_json::from_str(&json)?;
        if let (Some(outcome), Some(sequence)) = (result.outcome, result.settlement_sequence) {
            snapshot
                .results
                .entry(session)
                .or_default()
                .push(HeartbeatAttentionResult {
                    occurrence_id: result.occurrence_id,
                    schedule_id: result.schedule_id,
                    run_id: result.run_id,
                    outcome,
                    sequence,
                    seen: sequence <= seen,
                });
        }
    }
    let mut results_by_session = snapshot.results.iter_mut().collect::<Vec<_>>();
    results_by_session.sort_unstable_by_key(|(left, _)| *left);
    for (_, results) in results_by_session {
        results.sort_unstable_by_key(|result| std::cmp::Reverse(result.sequence));
        results.truncate(HEARTBEAT_HISTORY_LIMIT as usize);
    }
    let mut query=conn.prepare("SELECT s.session_id,json_extract(t.launch_json,'$._attention_base_updated_at')
        FROM sessions s JOIN heartbeat_task_launches t ON t.session_id=s.session_id
        WHERE json_extract(t.initial_outcome_json,'$.outcome')='unchanged'
        AND json_extract(t.initial_outcome_json,'$.state')='settled'
        AND json_extract(t.launch_json,'$._attention_through_updated_at')=s.updated_at
        AND json_extract(t.launch_json,'$._attention_through_run_revision')=(SELECT coalesce(max(id),0) FROM session_run_outcomes WHERE session_id=s.session_id)
        AND json_extract(t.launch_json,'$._attention_base_updated_at') IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM heartbeat_occurrences o WHERE o.session_id=s.session_id AND o.outcome IS NOT NULL AND o.settlement_sequence>json_extract(t.initial_outcome_json,'$.settlement_sequence'))")?;
    for row in query.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (session, updated) = row?;
        snapshot.quiet_updated_at.insert(session, updated);
    }
    Ok(())
}

pub(super) fn latest_sequence(conn: &Connection, session: &str) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT coalesce(max(json_extract(initial_outcome_json,'$.settlement_sequence')),0)
         FROM heartbeat_task_launches WHERE session_id=?1",
        [session],
        |row| row.get(0),
    )?)
}

pub(super) fn acknowledge(conn: &Connection, session: &str, sequence: i64) -> Result<()> {
    conn.execute(
        "UPDATE heartbeat_task_launches SET launch_json=json_set(launch_json,
          '$._attention_seen_through_sequence',max(coalesce(json_extract(launch_json,'$._attention_seen_through_sequence'),0),?2))
         WHERE session_id=?1",
        params![session, sequence],
    )?;
    Ok(())
}

pub(super) fn capture_base(conn: &Connection, occurrence: &str, session: &str) -> Result<()> {
    conn.execute(
        "UPDATE heartbeat_task_launches SET launch_json=json_set(launch_json,
          '$._attention_base_updated_at',(SELECT updated_at FROM sessions WHERE session_id=?2))
         WHERE occurrence_id=?1 AND session_id=?2 AND initial_run_id IS NULL",
        params![occurrence, session],
    )?;
    Ok(())
}

pub(super) fn capture_quiet_settlement(
    conn: &Connection,
    settled: &HeartbeatOccurrence,
) -> Result<()> {
    if settled.outcome == Some(HeartbeatOutcome::Unchanged) && settled.run_id.is_some() {
        conn.execute(
            "UPDATE heartbeat_task_launches SET launch_json=json_set(launch_json,
              '$._attention_through_updated_at',(SELECT updated_at FROM sessions WHERE session_id=?2),
              '$._attention_through_run_revision',(SELECT coalesce(max(id),0) FROM session_run_outcomes WHERE session_id=?2))
             WHERE occurrence_id=?1 AND session_id=?2 AND initial_run_id=?3 AND initial_outcome_json IS NULL",
            params![settled.occurrence_id, settled.session_id, settled.run_id],
        )?;
    }
    Ok(())
}
