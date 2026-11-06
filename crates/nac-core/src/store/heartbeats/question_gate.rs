//! A question-only schedule suspension and its separately owned goal gate.
//! The marker never admits a heartbeat or changes its visible result/state.
use super::*;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct QuestionGate {
    occurrence_id: String,
    schedule_version: i64,
    request_id: String,
    source_run_id: String,
    goal_id: String,
}

pub(super) fn remember(
    conn: &Connection,
    active: &HeartbeatOccurrence,
    question: &super::super::task_questions::QuestionRecord,
) -> Result<()> {
    let Some(goal_id) = active.spec.goal_id.as_ref() else {
        return Ok(());
    };
    if question.goal_id.as_ref() != Some(goal_id) {
        return Ok(());
    }
    let gate = QuestionGate {
        occurrence_id: active.occurrence_id.clone(),
        schedule_version: active.schedule_version,
        request_id: question.request.request_id.clone(),
        source_run_id: question.request.run_id.clone(),
        goal_id: goal_id.clone(),
    };
    conn.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$._goal_question_gate',json(?2)) WHERE schedule_id=?1 AND version=?3 AND state='suspended'",params![active.schedule_id,encode(&gate)?,active.schedule_version])?;
    Ok(())
}

pub(super) fn answered(
    conn: &Connection,
    schedule: &HeartbeatSchedule,
    goal_id: &str,
) -> Result<bool> {
    let Some(session_id) = schedule.session_id.as_deref() else {
        return Ok(false);
    };
    let raw: Option<String> = conn.query_row(
        "SELECT json_extract(binding_json,'$._goal_question_gate') FROM heartbeat_schedules WHERE schedule_id=?1 AND session_id=?2",
        params![schedule.schedule_id, session_id], |row| row.get(0),
    )?;
    let Some(raw) = raw else { return Ok(false) };
    let gate: QuestionGate = serde_json::from_str(&raw)?;
    if gate.schedule_version != schedule.version
        || gate.goal_id != goal_id
        || !current_binding(conn, session_id)?.same_target(&schedule.binding)
    {
        return Ok(false);
    }
    let exact_source: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM heartbeat_occurrences WHERE session_id=?1 AND schedule_id=?2 AND occurrence_id=?3 AND schedule_version=?4 AND run_id=?5 AND state='settled' AND outcome='needs_human_action' AND coalesce(provisional_outcome,'')!='needs_human_action')",
        params![session_id,schedule.schedule_id,gate.occurrence_id,gate.schedule_version,gate.source_run_id], |row| row.get(0),
    )?;
    Ok(exact_source
        && super::super::task_questions::delivered_answer_for_source(
            conn,
            session_id,
            &gate.request_id,
            &gate.source_run_id,
            goal_id,
        )?)
}
