use super::*;

fn occurrence(conn: &Connection, session: &str, id: &str) -> Result<HeartbeatOccurrence> {
    conn.query_row(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE session_id=?1 AND occurrence_id=?2"),params![session,id],occurrence_row).optional()?.context("heartbeat occurrence was not found")
}

fn suspend(conn: &Connection, id: &str, reason: &str, now: i64) -> Result<()> {
    conn.execute("UPDATE heartbeat_schedules SET state='suspended',reason=?2,updated_at_ms=?3 WHERE schedule_id=?1 AND state='active'",params![id,reason,now])?;
    conn.execute("UPDATE heartbeat_occurrences SET state='withdrawn',outcome='needs_human_action',evidence=?2,settled_at_ms=?3,expected_revision=expected_revision+1,settlement_sequence=?4 WHERE schedule_id=?1 AND state='pending'",params![id,reason,now,next_settlement_sequence(conn)?])?;
    prune_history(conn, id)
}

coordinated_command! {
/// Retry only a bounded pre-admission failure on the same occurrence/receipt.
/// An attention gate suspends immediately. Admitted work is never replayed.
pub fn heartbeat_admission_unavailable(path:&Path,session_id:&str,occurrence_id:&str,expected_revision:i64,needs_human_action:bool,reason:&str,now_ms:i64)->Result<()> {
    ensure!(reason.len()<=2_000,"heartbeat admission diagnostic exceeds bounds");
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let pending=occurrence(&tx,session_id,occurrence_id)?;
    if pending.state!=HeartbeatOccurrenceState::Pending || pending.revision!=expected_revision {return Ok(());}
    let attempts=pending.attempt_count.checked_add(1).context("heartbeat retry allowance exhausted")?;
    tx.execute("UPDATE heartbeat_occurrences SET attempt_count=?2,evidence=?3,expected_revision=expected_revision+1 WHERE occurrence_id=?1",params![occurrence_id,attempts,reason])?;
    if needs_human_action || attempts>=3 {
        suspend(&tx,&pending.schedule_id,reason,now_ms)?;
        tx.execute("UPDATE heartbeat_occurrences SET outcome=?2 WHERE occurrence_id=?1",params![occurrence_id,if needs_human_action{"needs_human_action"}else{"failed"}])?;
        prune_history(&tx,&pending.schedule_id)?;
    }
    tx.commit()?;
    Ok(())
}
command HeartbeatAdmissionUnavailableCommand {session_id:String=session_id.to_owned(),occurrence_id:String=occurrence_id.to_owned(),expected_revision:i64=expected_revision,needs_human_action:bool=needs_human_action,reason:String=reason.to_owned(),now_ms:i64=now_ms}
call |command| (&command.session_id,&command.occurrence_id,command.expected_revision,command.needs_human_action,&command.reason,command.now_ms)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

fn goal_gate(conn: &Connection, schedule: &HeartbeatSchedule) -> Result<Option<String>> {
    let goal: Option<(String, String)> = conn
        .query_row(
            "SELECT goal_id,status FROM session_goals WHERE session_id=?1",
            [&schedule.session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(match (schedule.spec.goal_id.as_deref(),goal) {
        (Some(expected),Some((id,status))) if id==expected && status=="active" => None,
        (Some(_),_) => Some("The bound goal is missing, replaced or inactive; review the heartbeat.".into()),
        (None,Some((_,status))) if status!="complete" => Some("An unfinished goal owns this chat's continuation; review the heartbeat's exact goal binding.".into()),
        _=>None,
    })
}

coordinated_command! {
/// Called under the exact session operation lease immediately before publishing
/// the run. Schedule controls and this admission have one transactional order.
#[expect(clippy::too_many_arguments,reason="one fenced admission binds exact occurrence, revision, run, generation, payload and selected workspace")]
pub(crate) fn admit_heartbeat(path:&Path,session_id:&str,occurrence_id:&str,expected_revision:i64,run_id:&str,generation:&str,prompt:&str,execution_cwd:&str,now_ms:i64)->Result<Option<HeartbeatOccurrence>> {
    ensure!(uuid::Uuid::parse_str(run_id).is_ok() && uuid::Uuid::parse_str(generation).is_ok(),"invalid heartbeat run identity");
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let pending=occurrence(&tx,session_id,occurrence_id)?;
    let schedule=load_schedule(&tx,session_id,&pending.schedule_id)?;
    ensure!(pending.state==HeartbeatOccurrenceState::Pending && pending.revision==expected_revision,"heartbeat occurrence no longer pending at expected revision");
    ensure!(schedule.state==HeartbeatState::Active && schedule.version==pending.schedule_version,"heartbeat control invalidated this occurrence");
    let binding=current_binding(&tx,session_id);
    let reason=if !binding.as_ref().is_ok_and(|binding|binding.same_target(&schedule.binding)) || schedule.binding.execution_cwd.as_deref()!=Some(execution_cwd) {
        Some("The heartbeat target's ownership, backend or configuration changed.".to_owned())
    } else if schedule.starts>=schedule.spec.max_occurrences {
        Some("The heartbeat occurrence allowance is exhausted.".into())
    } else if schedule.spec.token_allowance.is_some_and(|limit|schedule.tokens_used>=limit || schedule.usage_unknown) {
        Some("The heartbeat usage allowance is exhausted or usage is unknown.".into())
    } else {goal_gate(&tx,&schedule)?};
    if let Some(reason)=reason { suspend(&tx,&schedule.schedule_id,&reason,now_ms)?;tx.commit()?;return Ok(None); }
    let human_pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM session_inbox WHERE session_id=?1 AND status='pending')",[session_id],|row|row.get(0))?;
    if human_pending { return Ok(None); }
    let active:i64=tx.query_row("SELECT count(*) FROM heartbeat_occurrences WHERE state='admitted'",[],|row|row.get(0))?;
    if active>=MAX_HEARTBEAT_CONCURRENCY || active_occurrence(&tx,&schedule.schedule_id)?.is_some() {return Ok(None);}
    // Includes manual Run now. No route can turn an active schedule into a
    // high-frequency executor, and stored clock regression cannot reset rate.
    let recent:i64=tx.query_row("SELECT count(*) FROM heartbeat_occurrences WHERE started_at_ms>?1",[now_ms.saturating_sub(60_000)],|row|row.get(0))?;
    let last:Option<i64>=tx.query_row("SELECT max(started_at_ms) FROM heartbeat_occurrences WHERE schedule_id=?1",[&schedule.schedule_id],|row|row.get(0))?;
    if recent>=60 || last.is_some_and(|last|now_ms.saturating_sub(last)<15_000) {return Ok(None);}
    if let Some(goal_id)=schedule.spec.goal_id.as_deref() {
        let unavailable:bool=tx.query_row("SELECT accounting_run_id IS NOT NULL OR coalesce(next_attempt_at_epoch_ms,0)>?3 OR (token_budget IS NOT NULL AND tokens_used>=token_budget) FROM session_goals WHERE session_id=?1 AND goal_id=?2",params![session_id,goal_id,now_ms],|row|row.get(0))?;
        if unavailable {return Ok(None);}
        let bound=super::super::session_goals::bind_session_goal_run_with_connection(&tx,session_id,&GoalRunBaseline{run_id:run_id.to_owned(),billable_tokens:0,started_at_epoch_ms:u64::try_from(now_ms)?,continuation:false})?;
        ensure!(bound.is_some_and(|goal|goal.goal_id==goal_id),"heartbeat exact goal accounting changed before admission");
    }
    // Preserve the pre-check unread timestamp across consecutive quiet checks.
    // Canonical result revision distinguishes ordinary runs finishing in the same
    // timestamp second. This metadata never participates in authorization.
    let updated_at:String=tx.query_row("SELECT updated_at FROM sessions WHERE session_id=?1",[session_id],|r|r.get(0))?;
    let base:Option<String>=tx.query_row("SELECT json_extract(binding_json,'$._attention_base_updated_at') FROM heartbeat_schedules WHERE session_id=?1 AND json_extract(binding_json,'$._attention_through_updated_at')=?2 AND json_extract(binding_json,'$._attention_through_run_revision')=(SELECT coalesce(max(id),0) FROM session_run_outcomes WHERE session_id=?1) LIMIT 1",params![session_id,updated_at],|r|r.get(0)).optional()?.flatten();
    tx.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$._attention_base_updated_at',?2) WHERE schedule_id=?1",params![schedule.schedule_id,base.unwrap_or(updated_at)])?;
    let now=now_utc();
    // No human-review-intent row and no terminal-selection admission fields.
    tx.execute("INSERT INTO session_inbox(session_id,delivery,content,created_at,updated_at) VALUES(?1,'queue',?2,?3,?3)",params![session_id,prompt,now])?;
    let inbox_id=tx.last_insert_rowid();
    tx.execute("UPDATE heartbeat_occurrences SET state='admitted',inbox_item_id=?2,run_id=?3,generation=?4,started_at_ms=?5,attempt_count=attempt_count+1,expected_revision=expected_revision+1 WHERE occurrence_id=?1",params![occurrence_id,inbox_id,run_id,generation,now_ms])?;
    tx.execute("UPDATE heartbeat_schedules SET starts=starts+1,updated_at_ms=?2 WHERE schedule_id=?1",params![schedule.schedule_id,now_ms])?;
    let admitted=occurrence(&tx,session_id,occurrence_id)?;
    tx.commit()?;
    Ok(Some(admitted))
}
command AdmitHeartbeatCommand {session_id:String=session_id.to_owned(),occurrence_id:String=occurrence_id.to_owned(),expected_revision:i64=expected_revision,run_id:String=run_id.to_owned(),generation:String=generation.to_owned(),prompt:String=prompt.to_owned(),execution_cwd:String=execution_cwd.to_owned(),now_ms:i64=now_ms}
call |command| (&command.session_id,&command.occurrence_id,command.expected_revision,&command.run_id,&command.generation,&command.prompt,&command.execution_cwd,command.now_ms)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

/// Ordinary queue promotion must never adopt a heartbeat's pre-prompt receipt.
pub(crate) fn heartbeat_prompt_committed(
    conn: &Connection,
    session: &str,
    inbox: i64,
    run: &str,
) -> Result<()> {
    let bound:Option<(String,String)>=conn.query_row("SELECT state,run_id FROM heartbeat_occurrences WHERE session_id=?1 AND inbox_item_id=?2",params![session,inbox],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
    if let Some((state, expected)) = bound {
        ensure!(
            state == "admitted" && expected == run,
            "heartbeat prompt does not match its exact admitted occurrence"
        );
    }
    Ok(())
}

coordinated_command! {
/// Reports are provisional and bound to exact runtime identity and revision.
#[expect(clippy::too_many_arguments,reason="a provisional report must bind exact session, occurrence, run, generation and expected revision")]
pub fn heartbeat_report(path:&Path,session_id:&str,occurrence_id:&str,run_id:&str,generation:&str,expected_revision:i64,outcome:HeartbeatOutcome,evidence:&str)->Result<HeartbeatOccurrence> {
    ensure!(!evidence.trim().is_empty() && evidence.len()<=2_000,"heartbeat evidence must contain 1..=2000 bytes");
    ensure!(matches!(outcome,HeartbeatOutcome::Unchanged|HeartbeatOutcome::Meaningful|HeartbeatOutcome::Finished|HeartbeatOutcome::NeedsHumanAction),"invalid provisional heartbeat outcome");
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let active=occurrence(&tx,session_id,occurrence_id)?;
    ensure!(active.state==HeartbeatOccurrenceState::Admitted && active.run_id.as_deref()==Some(run_id) && active.generation.as_deref()==Some(generation),"heartbeat report is not for this active occurrence/run/generation");
    if active.provisional_outcome==Some(outcome) && active.evidence.as_deref()==Some(evidence) && Some(active.revision)==expected_revision.checked_add(1) {return Ok(active);}
    ensure!(active.revision==expected_revision,"heartbeat result revision conflict");
    ensure!(active.provisional_outcome!=Some(HeartbeatOutcome::NeedsHumanAction) || outcome==HeartbeatOutcome::NeedsHumanAction,"heartbeat human attention cannot be suppressed");
    tx.execute("UPDATE heartbeat_occurrences SET provisional_outcome=?2,evidence=?3,expected_revision=expected_revision+1 WHERE occurrence_id=?1",params![occurrence_id,vocabulary(&outcome)?,evidence])?;
    let updated=occurrence(&tx,session_id,occurrence_id)?;
    tx.commit()?;
    Ok(updated)
}
command HeartbeatReportCommand {session_id:String=session_id.to_owned(),occurrence_id:String=occurrence_id.to_owned(),run_id:String=run_id.to_owned(),generation:String=generation.to_owned(),expected_revision:i64=expected_revision,outcome:HeartbeatOutcome=outcome,evidence:String=evidence.to_owned()}
call |command| (&command.session_id,&command.occurrence_id,&command.run_id,&command.generation,command.expected_revision,command.outcome,&command.evidence)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

/// Canonical terminal settlement calls this in its own transaction, before
/// terminal events or successor wake. It is idempotent by exact run identity.
pub(crate) fn settle_heartbeat_with_connection(
    conn: &Connection,
    session: &str,
    run: &str,
    terminal: HeartbeatOutcome,
    tokens: Option<i64>,
    duration_ms: i64,
    now: i64,
) -> Result<()> {
    let active=conn.query_row(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE session_id=?1 AND run_id=?2 AND state='admitted'"),params![session,run],occurrence_row).optional()?;
    let Some(active) = active else {
        return Ok(());
    };
    let outcome = if matches!(
        terminal,
        HeartbeatOutcome::Failed
            | HeartbeatOutcome::Interrupted
            | HeartbeatOutcome::NeedsHumanAction
    ) {
        terminal
    } else {
        active
            .provisional_outcome
            .unwrap_or(HeartbeatOutcome::Unknown)
    };
    conn.execute("UPDATE heartbeat_occurrences SET state='settled',outcome=?2,tokens_used=?3,settled_at_ms=?4,expected_revision=expected_revision+1,settlement_sequence=?5 WHERE occurrence_id=?1",params![active.occurrence_id,vocabulary(&outcome)?,tokens,now,next_settlement_sequence(conn)?])?;
    conn.execute("UPDATE heartbeat_schedules SET tokens_used=min(9223372036854775807-tokens_used,?2)+tokens_used,time_used_ms=min(9223372036854775807-time_used_ms,?3)+time_used_ms,usage_unknown=max(usage_unknown,?4),updated_at_ms=?5 WHERE schedule_id=?1",params![active.schedule_id,tokens.unwrap_or(0).max(0),duration_ms.max(0),tokens.is_none(),now])?;
    if outcome == HeartbeatOutcome::Unchanged {
        conn.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$._attention_through_updated_at',(SELECT updated_at FROM sessions WHERE session_id=?2),'$._attention_through_run_revision',(SELECT coalesce(max(id),0) FROM session_run_outcomes WHERE session_id=?2)) WHERE schedule_id=?1",params![active.schedule_id,session])?;
    }
    match outcome {
        HeartbeatOutcome::Finished => {
            let changed=conn.execute("UPDATE heartbeat_schedules SET state='finished',reason='End condition reported and run settled successfully.',updated_at_ms=?2 WHERE schedule_id=?1 AND version=?3 AND state='active'",params![active.schedule_id,now,active.schedule_version])?;
            if changed == 1 {
                conn.execute("UPDATE heartbeat_occurrences SET state='withdrawn',settled_at_ms=?2,expected_revision=expected_revision+1,settlement_sequence=?3 WHERE schedule_id=?1 AND state='pending'",params![active.schedule_id,now,next_settlement_sequence(conn)?])?;
            }
        }
        HeartbeatOutcome::Failed
        | HeartbeatOutcome::Interrupted
        | HeartbeatOutcome::NeedsHumanAction => suspend(
            conn,
            &active.schedule_id,
            "Heartbeat needs human review after failure, interruption or denied action.",
            now,
        )?,
        _ => {}
    }
    let schedule = load_schedule(conn, session, &active.schedule_id)?;
    if schedule.starts >= schedule.spec.max_occurrences
        || schedule
            .spec
            .token_allowance
            .is_some_and(|n| schedule.tokens_used >= n || schedule.usage_unknown)
    {
        suspend(
            conn,
            &active.schedule_id,
            "Heartbeat execution or usage allowance exhausted (unknown usage requires review).",
            now,
        )?;
    }
    prune_history(conn, &active.schedule_id)?;
    Ok(())
}

coordinated_command! {
/// A prepared denial cannot be hidden by an early model classification.
pub(crate) fn mark_heartbeat_action_denied(path:&Path,session_id:&str,run_id:&str)->Result<()> {
    let conn=open_runtime_connection(path)?;
    conn.execute("UPDATE heartbeat_occurrences SET provisional_outcome='needs_human_action',evidence='A prepared agent operation was denied; review is required.',expected_revision=expected_revision+1 WHERE session_id=?1 AND run_id=?2 AND state='admitted' AND coalesce(provisional_outcome,'')!='needs_human_action'",params![session_id,run_id])?;
    Ok(())
}
command MarkHeartbeatActionDeniedCommand {session_id:String=session_id.to_owned(),run_id:String=run_id.to_owned()}
call |command| (&command.session_id,&command.run_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
/// Fence a deadline to its original run. A delayed timer is inert after final
/// settlement and cannot suspend/cancel a successor human run.
pub(crate) fn heartbeat_deadline_reached(path:&Path,session_id:&str,run_id:&str,now_ms:i64)->Result<bool> {
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let id:Option<String>=tx.query_row("SELECT schedule_id FROM heartbeat_occurrences WHERE session_id=?1 AND run_id=?2 AND state='admitted'",params![session_id,run_id],|row|row.get(0)).optional()?;
    let Some(id)=id else{return Ok(false);};
    suspend(&tx,&id,"Heartbeat execution deadline reached; exact-run cleanup is required.",now_ms)?;
    tx.execute("UPDATE heartbeat_occurrences SET provisional_outcome='needs_human_action',evidence='Heartbeat execution deadline reached; cleanup may overrun the deadline.',expected_revision=expected_revision+1 WHERE session_id=?1 AND run_id=?2 AND state='admitted'",params![session_id,run_id])?;
    tx.commit()?;
    Ok(true)
}
command HeartbeatDeadlineReachedCommand {session_id:String=session_id.to_owned(),run_id:String=run_id.to_owned(),now_ms:i64=now_ms}
call |command| (&command.session_id,&command.run_id,command.now_ms)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
/// Recovery must hold the session operation lease. An admitted receipt without
/// a terminal settlement is uncertain even if its prompt never committed.
pub fn reconcile_heartbeat_occurrences(path:&Path,session_id:&str,now_ms:i64)->Result<()> {
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let runs={let mut query=tx.prepare("SELECT run_id,started_at_ms FROM heartbeat_occurrences WHERE session_id=?1 AND state='admitted'")?;
        let rows=query.query_map([session_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows};
    for (run,started) in runs {
        settle_heartbeat_with_connection(&tx,session_id,&run,HeartbeatOutcome::Interrupted,None,now_ms.saturating_sub(started),now_ms)?;
        tx.execute("UPDATE session_inbox SET status='cancelled',cancelled_at=?3,updated_at=?3,version=version+1 WHERE session_id=?1 AND id IN (SELECT inbox_item_id FROM heartbeat_occurrences WHERE session_id=?1 AND run_id=?2) AND status='pending'",params![session_id,run,now_utc()])?;
    }
    tx.commit()?;
    Ok(())
}
command ReconcileHeartbeatOccurrencesCommand {session_id:String=session_id.to_owned(),now_ms:i64=now_ms}
call |command| (&command.session_id,command.now_ms)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}
