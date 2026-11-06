//! The initial scheduled input uses ordinary session admission and settlement.
//! Subsequent human runs cannot be adopted as evidence for this occurrence.
use super::*;

fn save_initial_outcome(conn: &Connection, id: &str) -> Result<()> {
    let settled = conn.query_row(
        &format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE occurrence_id=?1"),
        [id],
        occurrence_row,
    )?;
    fresh_attention::capture_quiet_settlement(conn, &settled)?;
    conn.execute("UPDATE heartbeat_task_launches SET initial_outcome_json=?2 WHERE occurrence_id=?1 AND initial_outcome_json IS NULL",params![id,encode(&settled)?])?;
    Ok(())
}

pub(super) fn settle_unstarted(
    conn: &Connection,
    id: &str,
    outcome: HeartbeatOutcome,
    reason: &str,
    now: i64,
) -> Result<()> {
    let active = conn
        .query_row(
            &format!(
                "SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE occurrence_id=?1"
            ),
            [id],
            occurrence_row,
        )
        .optional()?;
    let Some(active) = active else {
        return Ok(());
    };
    if active.state != HeartbeatOccurrenceState::Admitted || active.run_id.is_some() {
        return Ok(());
    }
    ensure!(
        fresh_admission::load_reserved(conn, id)?.is_some(),
        "unstarted failure is not a fresh scheduled launch"
    );
    conn.execute("UPDATE heartbeat_occurrences SET state='settled',outcome=?2,evidence=?3,settled_at_ms=?4,tokens_used=0,expected_revision=expected_revision+1,settlement_sequence=?5 WHERE occurrence_id=?1",params![id,vocabulary(&outcome)?,reason,now,next_settlement_sequence(conn)?])?;
    if let Some(input) = active.inbox_item_id {
        conn.execute("UPDATE session_inbox SET status='cancelled',cancelled_at=?2,updated_at=?2,version=version+1 WHERE id=?1 AND status='pending'",params![input,now_utc()])?;
    }
    save_initial_outcome(conn, id)?;
    if outcome != HeartbeatOutcome::Interrupted {
        execution::suspend(conn, &active.schedule_id, reason, now)?;
    }
    prune_history(conn, &active.schedule_id)
}

coordinated_command! {
/// A preparation or unattended admission failure is visible and terminal for
/// this occurrence. It cannot alter a run that has already acquired authority.
pub fn fail_fresh_heartbeat_before_run(path:&Path,occurrence_id:&str,outcome:HeartbeatOutcome,reason:&str,now_ms:i64)->Result<()> {
    ensure!(reason.len()<=2_000 && !reason.trim().is_empty(),"fresh launch failure diagnostic exceeds bounds");
    ensure!(matches!(outcome,HeartbeatOutcome::Failed|HeartbeatOutcome::NeedsHumanAction|HeartbeatOutcome::Interrupted),"invalid pre-run fresh outcome");
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    settle_unstarted(&tx,occurrence_id,outcome,reason,now_ms)?;
    tx.commit()?;
    Ok(())
}
command FailFreshHeartbeatBeforeRunCommand {occurrence_id:String=occurrence_id.to_owned(),outcome:HeartbeatOutcome=outcome,reason:String=reason.to_owned(),now_ms:i64=now_ms}
call |c| (&c.occurrence_id,c.outcome,&c.reason,c.now_ms)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Identify only the immutable initial input. If its occurrence was already
/// admitted or removed, ordinary queue promotion must not repeat it.
pub(crate) fn fresh_heartbeat_for_inbox(path:&Path,session_id:&str,inbox_id:i64)->Result<Option<HeartbeatOccurrence>> {
    let conn=open_runtime_connection(path)?;
    let id:Option<String>=conn.query_row("SELECT occurrence_id FROM heartbeat_task_launches WHERE session_id=?1 AND first_input_id=?2",params![session_id,inbox_id],|row|row.get(0)).optional()?;
    let Some(id)=id else {return Ok(None);};
    let occurrence=conn.query_row(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE occurrence_id=?1"),[id],occurrence_row).optional()?.context("scheduled initial input has retained ownership but no occurrence; human inspection is required")?;
    ensure!(occurrence.state==HeartbeatOccurrenceState::Admitted && occurrence.run_id.is_none(),"scheduled initial input has already acquired or settled its exact run");
    Ok(Some(occurrence))
}
command FreshHeartbeatForInboxCommand {session_id:String=session_id.to_owned(),inbox_id:i64=inbox_id}
call |c| (&c.session_id,c.inbox_id)
correlation |c| crate::telemetry::Correlation::session(Some(&c.session_id));
port internal;
}

#[expect(
    clippy::too_many_arguments,
    reason = "the creation receipt and exact prepared input bind one initial run, generation, configuration and workspace"
)]
pub(super) fn admit_initial_run(
    conn: &Connection,
    pending: &HeartbeatOccurrence,
    session: &str,
    expected_revision: i64,
    run: &str,
    generation: &str,
    execution_cwd: &str,
    now: i64,
) -> Result<Option<HeartbeatOccurrence>> {
    let prepared = fresh_admission::load_reserved(conn, &pending.occurrence_id)?
        .context("fresh launch reservation is unavailable")?;
    let receipt = prepared.receipt();
    ensure!(
        pending.state == HeartbeatOccurrenceState::Admitted
            && pending.run_id.is_none()
            && pending.revision == expected_revision
            && pending.receipt_id == generation
            && receipt.session_id == session,
        "fresh scheduled initial-run authority changed before admission"
    );
    let schedule = load_schedule_by_id(conn, &pending.schedule_id)?;
    let current = current_binding(conn, session)?;
    let published:(Option<i64>,Option<String>)=conn.query_row("SELECT json_extract(launch_json,'$.published_config_version'),json_extract(launch_json,'$.published_cwd') FROM heartbeat_task_launches WHERE occurrence_id=?1",[&pending.occurrence_id],|row|Ok((row.get(0)?,row.get(1)?)))?;
    let valid_input:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM session_inbox WHERE session_id=?1 AND id=?2 AND status='pending' AND content=?3)",params![session,receipt.first_input_id,receipt.request.prompt],|row|row.get(0))?;
    let destination = current_project_binding(conn, &receipt.destination.project_id);
    let reason = if receipt.stop_requested {
        Some((
            HeartbeatOutcome::Interrupted,
            "The schedule stopped before its initial input acquired a run.",
        ))
    } else if published.0 != Some(current.config_version)
        || published.1.as_deref() != Some(execution_cwd)
        || current.cwd != execution_cwd
        || current.project_id.as_deref() != Some(receipt.destination.project_id.as_str())
        || !destination.is_ok_and(|binding| binding.same_fresh_project_target(&receipt.binding))
    {
        Some((HeartbeatOutcome::NeedsHumanAction,"The scheduled task's prepared configuration, workspace or saved project changed before its initial run."))
    } else if execution::goal_gate(conn, &pending.spec, session)?.is_some() {
        Some((HeartbeatOutcome::NeedsHumanAction,"A human-created goal owns this task's continuation; review the scheduled initial input."))
    } else if !valid_input || pending.inbox_item_id != receipt.first_input_id {
        Some((
            HeartbeatOutcome::NeedsHumanAction,
            "The scheduled initial input changed or is unavailable; it will not be recreated.",
        ))
    } else {
        None
    };
    if let Some((outcome, reason)) = reason {
        settle_unstarted(conn, &pending.occurrence_id, outcome, reason, now)?;
        return Ok(None);
    }
    ensure!(
        schedule.binding.fresh_task.is_some() && schedule.session_id.is_none(),
        "fresh initial run lost standalone ownership"
    );
    fresh_attention::capture_base(conn, &pending.occurrence_id, session)?;
    conn.execute("UPDATE heartbeat_occurrences SET run_id=?2,generation=?3,expected_revision=expected_revision+1 WHERE occurrence_id=?1",params![pending.occurrence_id,run,generation])?;
    let changed=conn.execute("UPDATE heartbeat_task_launches SET initial_run_id=?2,initial_generation=?3 WHERE occurrence_id=?1 AND initial_run_id IS NULL",params![pending.occurrence_id,run,generation])?;
    ensure!(changed == 1, "scheduled launch already owns an initial run");
    Ok(Some(conn.query_row(
        &format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE occurrence_id=?1"),
        [&pending.occurrence_id],
        occurrence_row,
    )?))
}

pub(crate) fn retain_fresh_initial_outcome(
    conn: &Connection,
    occurrence: &HeartbeatOccurrence,
) -> Result<()> {
    let belongs:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM heartbeat_task_launches WHERE occurrence_id=?1 AND initial_run_id=?2)",params![occurrence.occurrence_id,occurrence.run_id],|row|row.get(0))?;
    if belongs {
        save_initial_outcome(conn, &occurrence.occurrence_id)?;
    }
    Ok(())
}
