use super::*;

fn withdraw_pending(conn: &Connection, id: &str, now: i64) -> Result<()> {
    conn.execute("UPDATE heartbeat_occurrences SET state='withdrawn',settled_at_ms=?2,expected_revision=expected_revision+1,settlement_sequence=?3 WHERE schedule_id=?1 AND state='pending'",params![id,now,next_settlement_sequence(conn)?])?;
    Ok(())
}

coordinated_command! {
/// A control command and its original response commit together. Replay is
/// receipt-first, including after deletion, configuration change or stop.
pub fn control_heartbeat(path:&Path,session_id:&str,request_id:&str,action:&HeartbeatAction,scheduling_request:&str,expected_binding:&HeartbeatBinding,now_ms:i64) -> Result<HeartbeatReceipt> {
    ensure!(uuid::Uuid::parse_str(request_id).is_ok_and(|id| id.to_string()==request_id),"heartbeat request identity must be a canonical UUID");
    ensure!(now_ms>=0,"invalid heartbeat time");
    let digest=format!("{:x}",Sha256::digest(encode(action)?.as_bytes()));
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let prior:Option<(String,String)>=tx.query_row("SELECT canonical_digest,response_json FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2",params![session_id,request_id],|row| Ok((row.get(0)?,row.get(1)?))).optional()?;
    if let Some((prior_digest,response))=prior {
        ensure!(prior_digest==digest,"heartbeat request identity conflicts with its original arguments");
        return Ok(serde_json::from_str(&response)?);
    }
    let current=current_binding(&tx,session_id)?;
    ensure!(expected_binding.same_target(&current),"heartbeat control target configuration/ownership changed before commit");
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
            ensure!(!scheduling_request.trim().is_empty() && scheduling_request.len()<=65_536,"heartbeat creation requires a bounded human scheduling request");
            let mut binding=current_binding(&tx,session_id)?;
            binding.scheduling_request=Some(scheduling_request.to_owned());
            ensure!(!execution_cwd.is_empty() && execution_cwd.len()<=8_192,"heartbeat workspace binding is unavailable");
            binding.execution_cwd=Some(execution_cwd.to_owned());
            let count:i64=tx.query_row("SELECT count(*) FROM heartbeat_schedules",[],|row| row.get(0))?;
            ensure!(count<MAX_HEARTBEAT_SCHEDULES,"heartbeat schedule capacity exhausted (including retained tombstones)");
            let due=model::future_due(now_ms,spec.interval_ms,now_ms)?;
            let id=uuid::Uuid::new_v4().to_string();
            tx.execute("INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms) VALUES(?1,?2,1,'active',?3,?4,?5,?6,?5,?5)",params![id,session_id,encode(&binding)?,encode(spec)?,now_ms,due])?;
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
                    binding=current_binding(&tx,session_id)?;
                    binding.seen_through_sequence=schedule.binding.seen_through_sequence;
                    ensure!(!scheduling_request.trim().is_empty() && scheduling_request.len()<=65_536,"heartbeat editing requires a bounded human scheduling request");
                    binding.scheduling_request=Some(scheduling_request.to_owned());
                    ensure!(!execution_cwd.is_empty() && execution_cwd.len()<=8_192,"heartbeat workspace binding is unavailable");
                    binding.execution_cwd=Some(execution_cwd.to_owned());
                    if replacement.interval_ms!=spec.interval_ms {
                        anchor=now_ms;
                        due=model::future_due(anchor,replacement.interval_ms,now_ms)?;
                    }
                    spec=replacement.clone();
                }
                HeartbeatAction::Pause{..} => {
                    ensure!(matches!(state,HeartbeatState::Active|HeartbeatState::Paused|HeartbeatState::Suspended),"terminal heartbeats cannot be reopened by pausing");
                    state=HeartbeatState::Paused;
                }
                HeartbeatAction::Resume{..} => {
                    ensure!(matches!(state,HeartbeatState::Paused|HeartbeatState::Suspended),"only paused or suspended heartbeats can resume");
                    ensure!(current_binding(&tx,session_id)?.same_target(&binding) && binding.execution_cwd.as_deref()==Some(execution_cwd),"heartbeat target configuration/workspace changed; edit after review");
                    ensure!(schedule.starts<spec.max_occurrences,"heartbeat occurrence allowance exhausted");
                    ensure!(spec.token_allowance.is_none_or(|n| schedule.tokens_used<n && !schedule.usage_unknown),"heartbeat usage allowance exhausted or unknown");
                    due=due.max(model::future_due(anchor,spec.interval_ms,now_ms)?);
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
                // Typed target binding does not carry private presentation keys.
                // Preserve them across controls while canonical run revision fences reuse.
                let version=schedule.version.checked_add(1).context("heartbeat revision exhausted")?;
                tx.execute("UPDATE heartbeat_schedules SET version=?2,state=?3,binding_json=json_set(?4,'$._attention_base_updated_at',json_extract(binding_json,'$._attention_base_updated_at'),'$._attention_through_updated_at',json_extract(binding_json,'$._attention_through_updated_at'),'$._attention_through_run_revision',json_extract(binding_json,'$._attention_through_run_revision')),specification_json=?5,anchor_ms=?6,next_due_ms=?7,reason=NULL,updated_at_ms=?8 WHERE schedule_id=?1",params![id,version,vocabulary(&state)?,encode(&binding)?,encode(&spec)?,anchor,due,now_ms])?;
            }
            id.to_owned()
        }
    };
    let receipt=HeartbeatReceipt{request_id:request_id.to_owned(),schedule:load_schedule(&tx,session_id,&schedule_id)?,occurrence,active_occurrence:active_occurrence(&tx,&schedule_id)?};
    tx.execute("INSERT INTO heartbeat_commands(session_id,request_id,canonical_digest,schedule_id,response_json,created_at_ms) VALUES(?1,?2,?3,?4,?5,?6)",params![session_id,request_id,digest,schedule_id,encode(&receipt)?,now_ms])?;
    prune_history(&tx,&schedule_id)?;
    tx.commit()?;
    Ok(receipt)
}
command ControlHeartbeatCommand {session_id:String=session_id.to_owned(),request_id:String=request_id.to_owned(),action:HeartbeatAction=action.clone(),scheduling_request:String=scheduling_request.to_owned(),expected_binding:HeartbeatBinding=expected_binding.clone(),now_ms:i64=now_ms}
call |command| (&command.session_id,&command.request_id,&command.action,&command.scheduling_request,&command.expected_binding,command.now_ms)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}
