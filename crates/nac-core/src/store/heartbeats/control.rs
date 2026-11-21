use super::*;

#[cfg(test)]
pub(super) static ON_CONTROL_BUSY: std::sync::Mutex<Option<(String, std::sync::mpsc::Sender<()>)>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
fn observe_control_busy(attempt: i32) -> bool {
    let signal = ON_CONTROL_BUSY
        .lock()
        .unwrap()
        .as_ref()
        .map(|(_, signal)| signal.clone());
    if let Some(signal) = signal {
        let _ = signal.send(());
    }
    if attempt >= 5_000 {
        return false;
    }
    std::thread::sleep(std::time::Duration::from_millis(1));
    true
}

fn control_binding(
    conn: &Connection,
    scope: &str,
    expected: &HeartbeatBinding,
) -> Result<HeartbeatBinding> {
    match &expected.fresh_task {
        Some(destination) => {
            destination.validate()?;
            ensure!(
                scope == format!("project:{}", destination.project_id),
                "fresh schedule project scope conflicts"
            );
            current_project_binding(conn, &destination.project_id)
        }
        None => current_binding(conn, scope),
    }
}

fn withdraw_pending(conn: &Connection, id: &str, now: i64) -> Result<()> {
    conn.execute("UPDATE heartbeat_occurrences SET state='withdrawn',settled_at_ms=?2,expected_revision=expected_revision+1,settlement_sequence=?3 WHERE schedule_id=?1 AND state='pending'",params![id,now,next_settlement_sequence(conn)?])?;
    Ok(())
}

coordinated_command! {
/// Read a previously committed command response for reconstructing its binding.
/// The control transaction still verifies the original canonical digest.
pub fn read_heartbeat_command_receipt(path: &Path, scope: &str, request_id: &str) -> Result<Option<HeartbeatReceipt>> {
    let conn = open_runtime_connection(path)?;
    let response: Option<String> = conn.query_row(
        "SELECT response_json FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2",
        params![scope, request_id], |row| row.get(0),
    ).optional()?;
    response.map(|value| serde_json::from_str(&value).map_err(Into::into)).transpose()
}
command ReadHeartbeatCommandReceiptCommand { scope:String=scope.to_owned(), request_id:String=request_id.to_owned() }
call |c| (&c.scope,&c.request_id)
correlation |c| crate::telemetry::Correlation::session(Some(&c.scope));
port public;
}

coordinated_command! {
/// Reconstruct an edit's pre-edit destination from immutable command responses.
/// Missing or contradictory history is unknown, never the resulting binding.
pub fn read_heartbeat_destination_at_version(path: &Path, scope: &str, schedule_id: &str, version: i64) -> Result<Option<FreshTaskDestination>> {
    let conn = open_runtime_connection(path)?;
    let mut statement = conn.prepare("SELECT response_json FROM heartbeat_commands WHERE session_id=?1 AND schedule_id=?2")?;
    let rows = statement.query_map(params![scope, schedule_id], |row| row.get::<_, String>(0))?;
    let mut destination = None;
    for row in rows {
        let receipt: HeartbeatReceipt = serde_json::from_str(&row?)?;
        ensure!(receipt.schedule.schedule_id == schedule_id, "historical schedule identity mismatch");
        if receipt.schedule.version == version {
            let candidate = receipt.schedule.binding.fresh_task.context("historical fresh destination missing")?;
            if let Some(existing) = &destination {
                ensure!(existing == &candidate, "conflicting historical fresh destinations");
            } else { destination = Some(candidate); }
        }
    }
    Ok(destination)
}
command ReadHeartbeatDestinationAtVersionCommand { scope:String=scope.to_owned(), schedule_id:String=schedule_id.to_owned(), version:i64=version }
call |c| (&c.scope,&c.schedule_id,c.version)
correlation |c| crate::telemetry::Correlation::session(Some(&c.scope));
port public;
}

coordinated_command! {
/// A control command and its original response commit together. Replay is
/// receipt-first, including after deletion, configuration change or stop.
pub fn control_heartbeat(path:&Path,session_id:&str,request_id:&str,action:&HeartbeatAction,scheduling_request:&str,expected_binding:&HeartbeatBinding,now_ms:i64) -> Result<HeartbeatReceipt> {
    ensure!(uuid::Uuid::parse_str(request_id).is_ok_and(|id| id.to_string()==request_id),"heartbeat request identity must be a canonical UUID");
    ensure!(now_ms>=0,"invalid heartbeat time");
    let canonical=if let Some(destination)=expected_binding.fresh_task.as_ref().filter(|_| matches!(action,HeartbeatAction::Create{..}|HeartbeatAction::Edit{..})) {
        encode(&(action,destination))?
    } else {encode(action)?};
    let digest=format!("{:x}",Sha256::digest(canonical.as_bytes()));
    let mut conn=open_runtime_connection(path)?;
    #[cfg(test)]
    {
        let observe = ON_CONTROL_BUSY.lock().unwrap().as_ref()
            .is_some_and(|(id, _)| id == request_id);
        if observe { conn.busy_handler(Some(observe_control_busy))?; }
    }
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let prior:Option<(String,String)>=tx.query_row("SELECT canonical_digest,response_json FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2",params![session_id,request_id],|row| Ok((row.get(0)?,row.get(1)?))).optional()?;
    if let Some((prior_digest,response))=prior {
        let (receipt, legacy): (HeartbeatReceipt, bool) = crate::store::legacy_task_model::decode(&tx,crate::store::legacy_task_model::Owner::Command,session_id,request_id,&response)?;
        let legacy_matches = if legacy && matches!(action,HeartbeatAction::Create{..}|HeartbeatAction::Edit{..}) {
            expected_binding.fresh_task.as_ref().is_some_and(|destination| v54_receipt::digest(action,destination).is_ok_and(|old|old==prior_digest))
        } else { false };
        ensure!(prior_digest==digest || legacy_matches,"heartbeat request identity conflicts with its original arguments");
        return Ok(receipt);
    }
    let relinquishing=matches!(action,HeartbeatAction::Pause{..}|HeartbeatAction::Stop{..}|HeartbeatAction::Delete{..});
    if !relinquishing {
        if let Some(destination) = &expected_binding.fresh_task {
            ensure!(destination.model_selection.is_some(), "select a model for each scheduled task session");
        }
    }
    let current=if relinquishing && expected_binding.fresh_task.is_some() {
        let (id,_)=action.target().context("missing standalone control target")?;
        load_schedule(&tx,session_id,id)?.binding
    } else {control_binding(&tx,session_id,expected_binding)?};
    let same_target=if expected_binding.fresh_task.is_some() {
        expected_binding.same_fresh_project_target(&current)
    } else {expected_binding.same_target(&current)};
    ensure!(same_target,"heartbeat control target configuration/ownership changed before commit");
    let execution_cwd=expected_binding.execution_cwd.as_deref().context("heartbeat control selected workspace is unavailable")?;
    let commands:i64=tx.query_row("SELECT count(*) FROM heartbeat_commands",[],|row| row.get(0))?;
    if commands>=HEARTBEAT_COMMAND_LIMIT {
        // Reserve a finite three relinquishing transitions per retained
        // schedule. Exhausted creation/edit/restart traffic cannot prevent a
        // human from pausing, stopping and deleting existing work.
        let (id,_)=action.target().context("heartbeat command receipt capacity exhausted")?;
        let current=load_schedule(&tx,session_id,id)?;
        let relinquishes=match action {
            HeartbeatAction::Pause{..}=>matches!(current.state,HeartbeatState::Active|HeartbeatState::Suspended),
            HeartbeatAction::Stop{..}=>!matches!(current.state,HeartbeatState::Stopped|HeartbeatState::Deleted),
            HeartbeatAction::Delete{..}=>current.state!=HeartbeatState::Deleted,
            _=>false,
        };
        ensure!(relinquishes && commands<HEARTBEAT_COMMAND_LIMIT+3*MAX_HEARTBEAT_SCHEDULES,"heartbeat command receipt capacity exhausted; only remaining pause/stop/delete transitions are available");
    }
    let mut occurrence=None;
    let schedule_id=match action {
        HeartbeatAction::Create{spec} => {
            spec.validate()?;
            ensure!(expected_binding.fresh_task.is_none() || matches!(&spec.cadence,HeartbeatCadence::Interval{..}),"fresh task schedules currently require interval cadence");
            ensure!(expected_binding.fresh_task.is_none() || spec.goal_id.is_none(),"fresh scheduled tasks cannot bind or create a goal");
            ensure!(!scheduling_request.trim().is_empty() && scheduling_request.len()<=65_536,"heartbeat creation requires a bounded human scheduling request");
            let mut binding=control_binding(&tx,session_id,expected_binding)?;
            binding.fresh_task=expected_binding.fresh_task.clone();
            binding.creator_session_id=expected_binding.creator_session_id.clone();
            binding.scheduling_request=Some(scheduling_request.to_owned());
            ensure!(!execution_cwd.is_empty() && execution_cwd.len()<=8_192,"heartbeat workspace binding is unavailable");
            binding.execution_cwd=Some(execution_cwd.to_owned());
            let count:i64=tx.query_row("SELECT count(*) FROM heartbeat_schedules",[],|row| row.get(0))?;
            ensure!(count<MAX_HEARTBEAT_SCHEDULES,"heartbeat schedule capacity exhausted (including retained tombstones)");
            let due=spec.cadence.future_due(now_ms,now_ms,None)?;
            let id=uuid::Uuid::new_v4().to_string();
            let owning_session=if binding.fresh_task.is_some(){None}else{Some(session_id)};
            tx.execute("INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms) VALUES(?1,?2,1,'active',?3,?4,?5,?6,?5,?5)",params![id,owning_session,encode(&binding)?,encode(spec)?,now_ms,due])?;
            if let Some(destination)=&binding.fresh_task {
                tx.execute("INSERT INTO heartbeat_fresh_destinations(schedule_id,project_id,creator_session_id,destination_json,binding_json) VALUES(?1,?2,?3,?4,?5)",params![id,destination.project_id,binding.creator_session_id,encode(destination)?,encode(&binding)?])?;
            }
            id
        }
        _ => {
            let (id,expected)=action.target().context("missing heartbeat target")?;
            let schedule=load_schedule(&tx,session_id,id)?;
            ensure!(schedule.version==expected,"heartbeat schedule revision conflict");
            ensure!(schedule.state!=HeartbeatState::Deleted,"heartbeat schedule was deleted");
            let mut state=schedule.state;
            let mut spec=schedule.spec.clone();
            let mut anchor=schedule.anchor_ms;
            let mut due=schedule.next_due_ms;
            let mut binding=schedule.binding.clone();
            match action {
                HeartbeatAction::Edit{spec:replacement,..} => {
                    replacement.validate()?;
                    ensure!(schedule.binding.fresh_task.is_none() || matches!(&replacement.cadence,HeartbeatCadence::Interval{..}),"fresh task schedules currently require interval cadence");
                    ensure!(schedule.binding.fresh_task.is_none() || replacement.goal_id.is_none(),"fresh scheduled tasks cannot bind or create a goal");
                    binding=control_binding(&tx,session_id,expected_binding)?;
                    binding.fresh_task=expected_binding.fresh_task.clone();
                    binding.creator_session_id=schedule.binding.creator_session_id.clone();
                    binding.seen_through_sequence=schedule.binding.seen_through_sequence;
                    ensure!(!scheduling_request.trim().is_empty() && scheduling_request.len()<=65_536,"heartbeat editing requires a bounded human scheduling request");
                    binding.scheduling_request=Some(scheduling_request.to_owned());
                    ensure!(!execution_cwd.is_empty() && execution_cwd.len()<=8_192,"heartbeat workspace binding is unavailable");
                    binding.execution_cwd=Some(execution_cwd.to_owned());
                    if replacement.cadence!=spec.cadence {
                        anchor=now_ms;
                        due=replacement.cadence.future_due(anchor,now_ms,None)?;
                    }
                    spec=replacement.clone();
                }
                HeartbeatAction::Pause{..} => {
                    ensure!(matches!(state,HeartbeatState::Active|HeartbeatState::Paused|HeartbeatState::Suspended),"terminal heartbeats cannot be reopened by pausing");
                    state=HeartbeatState::Paused;
                }
                HeartbeatAction::Resume{..} => {
                    ensure!(matches!(state,HeartbeatState::Paused|HeartbeatState::Suspended),"only paused or suspended heartbeats can resume");
                    let current=control_binding(&tx,session_id,expected_binding)?;
                    let same_target=if binding.fresh_task.is_some() {
                        current.same_fresh_project_target(&binding)
                    } else {current.same_target(&binding)};
                    ensure!(same_target && binding.execution_cwd.as_deref()==Some(execution_cwd),"heartbeat target configuration/workspace changed; edit after review");
                    ensure!(schedule.starts<spec.max_occurrences,"heartbeat occurrence allowance exhausted");
                    ensure!(spec.token_allowance.is_none_or(|n| schedule.tokens_used<n && !schedule.usage_unknown),"heartbeat usage allowance exhausted or unknown");
                    due=spec.cadence.future_due(anchor,now_ms,Some(due))?;
                    state=HeartbeatState::Active;
                }
                HeartbeatAction::Stop{..} => state=HeartbeatState::Stopped,
                HeartbeatAction::Delete{..} => state=HeartbeatState::Deleted,
                HeartbeatAction::RunNow{..} => {
                    ensure!(state==HeartbeatState::Active,"heartbeat must be active to run now");
                    // A separate identity joins an existing pending check rather
                    // than creating overlapping input or moving the anchor.
                    occurrence=Some(materialize::pending_occurrence(&tx,&schedule,now_ms,now_ms,1,true)?);
                }
                HeartbeatAction::Create{..} => unreachable!(),
            }
            if !matches!(action,HeartbeatAction::RunNow{..}) {
                withdraw_pending(&tx,id,now_ms)?;
                // Capture Stop in this transaction, including a legacy stopped
                // active run before a later control can overwrite its state.
                // Fresh reservations have no run yet; their launch ledger owns Stop.
                if binding.fresh_task.is_none() && (matches!(action,HeartbeatAction::Stop{..}) || schedule.state==HeartbeatState::Stopped) {
                    cancellation::retain_stop_request(&tx,id)?;
                }
                // Typed bindings omit private attention and cancellation facts.
                // Controls must preserve both across re-encoding, including Delete.
                let version=schedule.version.checked_add(1).context("heartbeat revision exhausted")?;
                tx.execute("UPDATE heartbeat_schedules SET version=?2,state=?3,binding_json=json_set(?4,'$._attention_base_updated_at',json_extract(binding_json,'$._attention_base_updated_at'),'$._attention_through_updated_at',json_extract(binding_json,'$._attention_through_updated_at'),'$._attention_through_run_revision',json_extract(binding_json,'$._attention_through_run_revision'),'$._stop_request',json_extract(binding_json,'$._stop_request')),specification_json=?5,anchor_ms=?6,next_due_ms=?7,reason=NULL,updated_at_ms=?8 WHERE schedule_id=?1",params![id,version,vocabulary(&state)?,encode(&binding)?,encode(&spec)?,anchor,due,now_ms])?;
                if let Some(destination)=&binding.fresh_task {
                    tx.execute("UPDATE heartbeat_fresh_destinations SET destination_json=?2,binding_json=?3 WHERE schedule_id=?1",params![id,encode(destination)?,encode(&binding)?])?;
                    if matches!(action,HeartbeatAction::Stop{..}) {
                        tx.execute("UPDATE heartbeat_task_launches SET stop_requested=1 WHERE occurrence_id IN (SELECT occurrence_id FROM heartbeat_occurrences WHERE schedule_id=?1 AND state='admitted')",[id])?;
                    }
                }
            }
            id.to_owned()
        }
    };
    let receipt=HeartbeatReceipt{request_id:request_id.to_owned(),schedule:load_schedule(&tx,session_id,&schedule_id)?,occurrence,active_occurrence:active_occurrence(&tx,&schedule_id)?};
    tx.execute("INSERT INTO heartbeat_commands(session_id,request_id,canonical_digest,schedule_id,response_json,created_at_ms) VALUES(?1,?2,?3,?4,?5,?6)",params![session_id,request_id,digest,schedule_id,encode(&receipt)?,now_ms])?;
    prune_history(&tx, &schedule_id)?;
    tx.commit()?;
    Ok(receipt)
}
command ControlHeartbeatCommand {session_id:String=session_id.to_owned(),request_id:String=request_id.to_owned(),action:HeartbeatAction=action.clone(),scheduling_request:String=scheduling_request.to_owned(),expected_binding:HeartbeatBinding=expected_binding.clone(),now_ms:i64=now_ms}
call |command| (&command.session_id,&command.request_id,&command.action,&command.scheduling_request,&command.expected_binding,command.now_ms)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}
