//! The prepared-session publication boundary for scheduled tasks. These helpers
//! participate in the existing creation transaction; they never perform effects.
use super::*;

coordinated_command! {
/// Pin effective destination defaults when ordinary launch inheritance used a
/// sibling chat or config-file fallback. Headers remain private preparation data.
pub fn pin_fresh_heartbeat_model_defaults(path:&Path,occurrence_id:&str,model_defaults:ModelConfigurationRecord)->Result<PreparedFreshTaskLaunch> {
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let current=fresh_admission::load_reserved(&tx,occurrence_id)?.context("fresh launch reservation was not found")?;
    ensure!(!current.receipt().stop_requested && current.receipt().first_input_id.is_none(),"scheduled model selection is cancelled or already published");
    if let Some(prior)=current.model_defaults() {
        let mut comparable=model_defaults;
        comparable.config_id=prior.config_id.clone();comparable.name=prior.name.clone();
        comparable.created_at=prior.created_at.clone();comparable.updated_at=prior.updated_at.clone();
        comparable.initial_prompt=prior.initial_prompt.clone();
        ensure!(&comparable==prior,"conflict: scheduled model defaults were resolved concurrently; retry the original reservation");
        return Ok(current);
    }
    tx.execute("UPDATE heartbeat_task_launches SET launch_json=json_set(launch_json,'$.model_defaults',json(?2)) WHERE occurrence_id=?1",params![occurrence_id,encode(&model_defaults)?])?;
    let pinned=fresh_admission::load_reserved(&tx,occurrence_id)?.context("fresh model selection disappeared")?;
    tx.commit()?;
    Ok(pinned)
}
command PinFreshHeartbeatModelDefaultsCommand {occurrence_id:String=occurrence_id.to_owned(),model_defaults:ModelConfigurationRecord=model_defaults}
call |c| (&c.occurrence_id,c.model_defaults)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

pub(crate) fn fresh_launch_for_request_with_connection(
    conn: &Connection,
    request_id: &str,
) -> Result<Option<PreparedFreshTaskLaunch>> {
    let occurrence: Option<String> = conn
        .query_row(
            "SELECT occurrence_id FROM heartbeat_task_launches WHERE request_id=?1",
            [request_id],
            |row| row.get(0),
        )
        .optional()?;
    occurrence
        .map(|id| {
            fresh_admission::load_reserved(conn, &id)?
                .context("fresh launch reservation disappeared")
        })
        .transpose()
}

fn validate_publication(
    conn: &Connection,
    launch: &FreshTaskLaunchReceipt,
    snapshot: &crate::sessions::SessionSnapshot,
) -> Result<()> {
    ensure!(
        snapshot.session_id == launch.session_id
            && snapshot.behavior == crate::sessions::SessionBehavior::Direct
            && snapshot.ssh.is_none()
            && snapshot.sandbox_spec.is_none()
            && snapshot.project_id.as_deref() == Some(launch.destination.project_id.as_str()),
        "conflict: scheduled prepared session does not match its exact reserved Local task"
    );
    ensure!(
        !launch.stop_requested && launch.first_input_id.is_none(),
        "cancelled or already-published scheduled launch cannot publish input"
    );
    let occurrence = conn
        .query_row(
            &format!(
                "SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE occurrence_id=?1"
            ),
            [&launch.occurrence_id],
            occurrence_row,
        )
        .optional()?
        .context("scheduled occurrence no longer exists; retained resource must be inspected")?;
    ensure!(
        occurrence.state == HeartbeatOccurrenceState::Admitted
            && occurrence.session_id.as_deref() == Some(launch.session_id.as_str())
            && occurrence.run_id.is_none(),
        "scheduled occurrence no longer owns unpublished preparation"
    );
    let project = current_project_binding(conn, &launch.destination.project_id)?;
    ensure!(
        project.same_fresh_project_target(&launch.binding),
        "scheduled destination changed during preparation"
    );
    Ok(())
}

pub(crate) fn link_fresh_launch_input_with_connection(
    conn: &Connection,
    request_id: &str,
    snapshot: &crate::sessions::SessionSnapshot,
    input_id: i64,
) -> Result<()> {
    let Some(prepared) = fresh_launch_for_request_with_connection(conn, request_id)? else {
        return Ok(());
    };
    let receipt = prepared.receipt();
    validate_publication(conn, receipt, snapshot)?;
    conn.execute("UPDATE heartbeat_task_launches SET first_input_id=?2,launch_json=json_set(launch_json,'$.published_config_version',?3,'$.published_cwd',?4) WHERE request_id=?1",params![request_id,input_id,snapshot.config_version,snapshot.cwd.to_string_lossy()])?;
    conn.execute("UPDATE heartbeat_occurrences SET inbox_item_id=?2,expected_revision=expected_revision+1 WHERE occurrence_id=?1",params![receipt.occurrence_id,input_id])?;
    Ok(())
}

pub(crate) fn publish_shared_fresh_launch_with_connection(
    conn: &Connection,
    request_id: &str,
    snapshot: &crate::sessions::SessionSnapshot,
) -> Result<()> {
    let prepared = fresh_launch_for_request_with_connection(conn, request_id)?
        .context("prepared launch was not found")?;
    let receipt = prepared.receipt();
    validate_publication(conn, receipt, snapshot)?;
    let shared:Option<bool>=conn.query_row("SELECT json_extract(launch_json,'$.shared_directory') FROM heartbeat_task_launches WHERE request_id=?1",[request_id],|row|row.get(0))?;
    ensure!(
        shared == Some(true)
            && snapshot.cwd.as_path()
                == Path::new(
                    receipt
                        .binding
                        .execution_cwd
                        .as_deref()
                        .context("shared directory binding is unavailable")?
                ),
        "shared scheduled launch requires its exact prepared Local directory"
    );
    ensure!(
        receipt.destination.pinned_commit.is_none(),
        "non-Git scheduled tasks cannot use a commit pin"
    );
    let now = now_utc();
    conn.execute(
        "INSERT INTO session_presentations(session_id,title) VALUES(?1,?2)",
        params![snapshot.session_id, receipt.request.title],
    )?;
    conn.execute("INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at) VALUES(?1,'queue','pending',?2,?3,?3)",params![snapshot.session_id,receipt.request.prompt,now])?;
    link_fresh_launch_input_with_connection(conn, request_id, snapshot, conn.last_insert_rowid())
}

coordinated_command! {
/// The serving scheduler recovers the already-reserved port input. A passive
/// inventory read cannot turn into a new task or a new reservation.
pub fn read_fresh_heartbeat_launch(path:&Path,occurrence_id:&str)->Result<Option<PreparedFreshTaskLaunch>> {
    let conn=open_runtime_connection(path)?;
    fresh_admission::load_reserved(&conn,occurrence_id)
}
command ReadFreshHeartbeatLaunchCommand {occurrence_id:String=occurrence_id.to_owned()}
call |c| (&c.occurrence_id)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Bind the detected workspace behavior once per intentional occurrence, before
/// preparation. Retrying cannot switch between Git isolation and a shared cwd.
pub fn pin_fresh_heartbeat_workspace_mode(path:&Path,occurrence_id:&str,shared_directory:bool)->Result<()> {
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let prepared=fresh_admission::load_reserved(&tx,occurrence_id)?.context("fresh launch reservation was not found")?;
    ensure!(!prepared.receipt().stop_requested && prepared.receipt().first_input_id.is_none(),"scheduled launch is cancelled or already published");
    let prior:Option<bool>=tx.query_row("SELECT json_extract(launch_json,'$.shared_directory') FROM heartbeat_task_launches WHERE occurrence_id=?1",[occurrence_id],|row|row.get(0))?;
    ensure!(prior.is_none_or(|prior|prior==shared_directory),"conflict: scheduled source changed between Git and non-Git preparation");
    let attempts:i64=tx.query_row("SELECT coalesce(json_extract(launch_json,'$.preparation_attempts'),0) FROM heartbeat_task_launches WHERE occurrence_id=?1",[occurrence_id],|row|row.get(0))?;
    ensure!(attempts<3,"scheduled preparation retry allowance exhausted; inspect the retained resource");
    tx.execute("UPDATE heartbeat_task_launches SET launch_json=json_set(launch_json,'$.shared_directory',json(?2),'$.preparation_attempts',?3) WHERE occurrence_id=?1",params![occurrence_id,encode(&shared_directory)?,attempts+1])?;
    tx.commit()?;
    Ok(())
}
command PinFreshHeartbeatWorkspaceModeCommand {occurrence_id:String=occurrence_id.to_owned(),shared_directory:bool=shared_directory}
call |c| (&c.occurrence_id,c.shared_directory)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}
