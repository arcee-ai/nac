//! Standalone project binding and retained-resource admission. Git/preparation
//! effects are performed by the supplied inward port after this transaction.
use super::*;

#[derive(Serialize, serde::Deserialize)]
struct ReservedLaunch {
    receipt: FreshTaskLaunchReceipt,
    model_defaults: Option<ModelConfigurationRecord>,
}

type ReservedLaunchRow = (String, Option<i64>, bool, Option<String>, Option<String>);

coordinated_command! {
pub fn fresh_heartbeat_host_retained_limit(path:&Path)->Result<i64> {
    let conn=open_runtime_connection(path)?;
    Ok(conn.query_row("SELECT retained_limit FROM heartbeat_retained_allowance WHERE singleton=1",[],|row|row.get(0))?)
}
command FreshHeartbeatHostRetainedLimitCommand {}
call |_c| ()
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Bind saved project identity without attaching or waking any session.
/// Canonical filesystem identity is supplied and revalidated by the adapter.
pub fn fresh_heartbeat_binding(path:&Path,destination:&FreshTaskDestination,creator_session_id:Option<&str>,execution_cwd:&str)->Result<HeartbeatBinding> {
    destination.validate()?;
    ensure!(!execution_cwd.is_empty() && execution_cwd.len()<=8_192,"fresh schedule selected workspace is unavailable");
    let conn=open_runtime_connection(path)?;
    if let Some(creator)=creator_session_id {current_binding(&conn,creator)?;}
    let mut binding=current_project_binding(&conn,&destination.project_id)?;
    binding.execution_cwd=Some(execution_cwd.to_owned());
    binding.fresh_task=Some(destination.clone());
    binding.creator_session_id=creator_session_id.map(str::to_owned);
    Ok(binding)
}
command FreshHeartbeatBindingCommand {destination:FreshTaskDestination=destination.clone(),creator_session_id:Option<String>=creator_session_id.map(str::to_owned),execution_cwd:String=execution_cwd.to_owned()}
call |c| (&c.destination,c.creator_session_id.as_deref(),&c.execution_cwd)
correlation |c| crate::telemetry::Correlation::session(c.creator_session_id.as_deref());
port public;
}

pub(super) fn load_reserved(
    conn: &Connection,
    occurrence_id: &str,
) -> Result<Option<PreparedFreshTaskLaunch>> {
    let row:Option<ReservedLaunchRow>=conn.query_row("SELECT launch_json,first_input_id,stop_requested,initial_run_id,initial_outcome_json FROM heartbeat_task_launches WHERE occurrence_id=?1",[occurrence_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).optional()?;
    row.map(|(json, input, stop, run, outcome)| {
        let ReservedLaunch {
            mut receipt,
            model_defaults,
        } = serde_json::from_str(&json)?;
        receipt.first_input_id = input;
        receipt.stop_requested = stop;
        receipt.initial_run_id = run;
        receipt.shared_directory = conn.query_row("SELECT json_extract(launch_json,'$.shared_directory') FROM heartbeat_task_launches WHERE occurrence_id=?1",[occurrence_id],|row|row.get(0))?;
        receipt.initial_outcome = outcome
            .map(|json| serde_json::from_str(&json))
            .transpose()?;
        Ok(PreparedFreshTaskLaunch {
            receipt,
            model_defaults,
        })
    })
    .transpose()
}

coordinated_command! {
/// Reserve capacity before any source resolution/materialization. Replays
/// recover the original launch identity even if its task or history was deleted.
pub fn reserve_fresh_heartbeat_launch(path:&Path,occurrence_id:&str,expected_revision:i64,now_ms:i64)->Result<Option<PreparedFreshTaskLaunch>> {
    ensure!(now_ms>=0,"invalid heartbeat time");
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(reserved)=load_reserved(&tx,occurrence_id)? {
        return Ok(Some(reserved));
    }
    let pending=tx.query_row(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE occurrence_id=?1"),[occurrence_id],occurrence_row).optional()?.context("fresh schedule occurrence was not found")?;
    let schedule=load_schedule_by_id(&tx,&pending.schedule_id)?;
    let destination=schedule.binding.fresh_task.as_ref().context("this heartbeat is not a fresh-task destination")?;
    ensure!(schedule.session_id.is_none() && pending.session_id.is_none(),"fresh schedule cannot be rebound to an existing chat");
    if pending.state!=HeartbeatOccurrenceState::Pending || pending.revision!=expected_revision || schedule.state!=HeartbeatState::Active || schedule.version!=pending.schedule_version {return Ok(None);}
    let current=current_project_binding(&tx,&destination.project_id);
    let reason=if !current.as_ref().is_ok_and(|current|current.same_fresh_project_target(&schedule.binding)) {
        Some("The saved project is missing or its Local destination binding changed.")
    } else if schedule.starts>=schedule.spec.max_occurrences {
        Some("The fresh schedule occurrence allowance is exhausted.")
    } else if schedule.spec.token_allowance.is_some_and(|limit|schedule.tokens_used>=limit || schedule.usage_unknown) {
        Some("The fresh schedule usage allowance is exhausted or unknown.")
    } else {None};
    if let Some(reason)=reason {execution::suspend(&tx,&schedule.schedule_id,reason,now_ms)?;tx.commit()?;return Ok(None);}
    let current=current?;
    if !execution::admission_capacity(&tx,&schedule.schedule_id,now_ms)? {return Ok(None);}
    let host_limit:i64=tx.query_row("SELECT retained_limit FROM heartbeat_retained_allowance WHERE singleton=1",[],|row|row.get(0))?;
    let (host_count,schedule_count):(i64,i64)=tx.query_row("SELECT count(*),coalesce(sum(schedule_id=?1),0) FROM heartbeat_task_launches",[&schedule.schedule_id],|row|Ok((row.get(0)?,row.get(1)?)))?;
    if host_count>=host_limit || schedule_count>=destination.retained_limit {
        execution::suspend(&tx,&schedule.schedule_id,"Retained task/workspace allowance reached. Inspect the owned inventory and explicitly increase the allowance or use a separately authorized resource lifecycle; no work is automatically deleted.",now_ms)?;
        tx.commit()?;return Ok(None);
    }
    let mut prompt=format!("Scheduled fresh direct task, occurrence {} (receipt {}).\nThis is automatic input for the saved human-authorized purpose below. It grants no human-product invocation authority or new scheduling authority. Do not create a goal. Retain this task and workspace for independent human inspection/continuation. Report the outcome through report_heartbeat for this exact occurrence after reading its current revision.\nSaved instructions:\n{}\nEnd condition:\n{}\n",pending.occurrence_id,pending.receipt_id,pending.spec.instructions,pending.spec.end_condition);
    for skill in &pending.spec.skills {prompt.push_str(&format!("\nRequested skill: ${skill}\n"));}
    let request=TaskLaunchRequest {
        request_id:pending.receipt_id.clone(),project_id:destination.project_id.clone(),invoking_session_id:None,
        git_ref:destination.pinned_commit.clone(),default_ref:destination.default_ref.clone(),
        title:pending.spec.name.trim().to_owned(),prompt,
    };
    request.validate()?;
    let occupied:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM native_task_launches WHERE request_id=?1 UNION ALL SELECT 1 FROM task_launches WHERE request_id=?1)",[&request.request_id],|row|row.get(0))?;
    ensure!(!occupied,"conflict: scheduled launch identity already belongs to another launch request");
    let model_defaults=current.model_configuration_id.as_deref().map(|id| {
        tx.query_row(&format!("SELECT {} FROM model_configurations c WHERE c.config_id=?1",super::super::model_configurations::model_configuration_columns("c")),[id],|row|super::super::model_configurations::row_to_record_at(row,0)).optional()?.context("saved destination model configuration is unavailable")
    }).transpose()?;
    let mut binding=schedule.binding.clone();
    binding.model_configuration_id=current.model_configuration_id;
    let receipt=FreshTaskLaunchReceipt {
        occurrence_id:pending.occurrence_id.clone(),schedule_id:schedule.schedule_id.clone(),request,
        destination:destination.clone(),binding,session_id:uuid::Uuid::new_v4().to_string(),
        first_input_id:None,stop_requested:false,initial_run_id:None,initial_outcome:None,shared_directory:None,created_at_ms:now_ms,
    };
    let json=encode(&ReservedLaunch{receipt:receipt.clone(),model_defaults:model_defaults.clone()})?;
    tx.execute("INSERT INTO heartbeat_task_launches(occurrence_id,schedule_id,request_id,project_id,launch_json,session_id,created_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![receipt.occurrence_id,receipt.schedule_id,receipt.request.request_id,receipt.destination.project_id,json,receipt.session_id,now_ms])?;
    tx.execute("UPDATE heartbeat_occurrences SET state='admitted',session_id=?2,started_at_ms=?3,attempt_count=attempt_count+1,expected_revision=expected_revision+1 WHERE occurrence_id=?1",params![pending.occurrence_id,receipt.session_id,now_ms])?;
    tx.execute("UPDATE heartbeat_schedules SET starts=starts+1,updated_at_ms=?2 WHERE schedule_id=?1",params![schedule.schedule_id,now_ms])?;
    tx.commit()?;
    Ok(Some(PreparedFreshTaskLaunch{receipt,model_defaults}))
}
command ReserveFreshHeartbeatLaunchCommand {occurrence_id:String=occurrence_id.to_owned(),expected_revision:i64=expected_revision,now_ms:i64=now_ms}
call |c| (&c.occurrence_id,c.expected_revision,c.now_ms)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Resource inventory is separate from bounded occurrence history. It never
/// deletes ownership or uses the presence of a session row as quota evidence.
pub fn fresh_heartbeat_inventory(path:&Path,project_id:&str,schedule_id:Option<&str>)->Result<Vec<FreshTaskLaunchReceipt>> {
    let conn=open_runtime_connection(path)?;
    let ids=conn.prepare("SELECT occurrence_id FROM heartbeat_task_launches WHERE project_id=?1 AND (?2 IS NULL OR schedule_id=?2) ORDER BY created_at_ms,occurrence_id")?
        .query_map(params![project_id,schedule_id],|row|row.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    ids.iter().map(|id|load_reserved(&conn,id)?.map(|reserved|reserved.receipt).context("fresh resource inventory changed")).collect()
}
command FreshHeartbeatInventoryCommand {project_id:String=project_id.to_owned(),schedule_id:Option<String>=schedule_id.map(str::to_owned)}
call |c| (&c.project_id,c.schedule_id.as_deref())
correlation |_c| crate::telemetry::Correlation::default();
port public;
}
