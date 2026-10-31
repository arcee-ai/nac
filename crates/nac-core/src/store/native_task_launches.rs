//! Native launch intent identity. Git preparation remains in `task_launches`.
use super::*;
use crate::task_launch_control::{NativeTaskLaunch, NativeTaskRequest};

fn load(conn: &Connection, request_id: &str) -> Result<Option<NativeTaskLaunch>> {
    conn.query_row("SELECT request_json,caller_session_id,project_id,source_cwd,session_id,retained,phase,error,first_input_id,created_at,updated_at
        FROM native_task_launches WHERE request_id=?1", params![request_id], |row| {
            Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,bool>(5)?,row.get::<_,String>(6)?,row.get::<_,Option<String>>(7)?,row.get::<_,Option<i64>>(8)?,row.get::<_,String>(9)?,row.get::<_,String>(10)?))
        }).optional()?.map(|(request,caller_session_id,project_id,cwd,session_id,retained,phase,error,first_input_id,created_at,updated_at)| Ok(NativeTaskLaunch {
            request: serde_json::from_str(&request)?, caller_session_id,project_id,source_cwd:cwd.into(),session_id,retained,phase,error,first_input_id,created_at,updated_at
        })).transpose()
}

pub(crate) fn reserved_identity(
    conn: &Connection,
    request: &TaskLaunchRequest,
    source: &TaskLaunchSource,
) -> Result<Option<String>> {
    let Some(record) = load(conn, &request.request_id)? else {
        return Ok(None);
    };
    anyhow::ensure!(
        record.retained
            && record.source_cwd == std::fs::canonicalize(&source.project_cwd)?
            && record.project_id == request.project_id
            && request.invoking_session_id.as_deref() == Some(record.caller_session_id.as_str())
            && record.request.title == request.title
            && record.request.initial_prompt() == request.prompt
            && record.request.git_ref == request.git_ref
            && record.request.default_ref == request.default_ref,
        "conflict: retained request differs from its native intent"
    );
    Ok(Some(record.session_id))
}

pub(crate) fn publish_retained_in_transaction(
    tx: &Transaction<'_>,
    launch: &TaskLaunchRecord,
    input_id: i64,
) -> Result<()> {
    let Some(record) = load(tx, &launch.request.request_id)? else {
        return Ok(());
    };
    anyhow::ensure!(
        reserved_identity(tx, &launch.request, &launch.source)?.as_deref()
            == Some(launch.session_id.as_str())
            && record.phase != "cancelled",
        "conflict: native retained launch binding changed"
    );
    tx.execute("UPDATE native_task_launches SET phase='ready',first_input_id=?2,error=NULL,updated_at=?3 WHERE request_id=?1",params![launch.request.request_id,input_id,now_utc()])?;
    Ok(())
}

coordinated_command! {
pub fn load_native_task_launch(path: &Path, request_id: &str) -> Result<Option<NativeTaskLaunch>> {
    let conn = open_runtime_connection(path)?;
    load(&conn, request_id)
}
command LoadNativeTaskLaunchCommand { request_id: String = request_id.to_owned() }
call |c| (&c.request_id)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Restart observation changes no session/input/resource and respects live owners.
pub fn reconcile_native_task_launches(path: &Path) -> Result<()> {
    let conn = open_runtime_connection(path)?;
    let ids = conn.prepare("SELECT request_id FROM native_task_launches WHERE phase IN ('reserved','preparing_runtime')")?
        .query_map([], |row|row.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        let _lease = match crate::sessions::SessionOperationLease::try_acquire(path,&format!("native-task-launch:{id}")) {
            Ok(lease) => lease, Err(crate::sessions::SessionOperationLeaseError::Busy(_)) => continue, Err(error) => return Err(error.into()),
        };
        conn.execute("UPDATE native_task_launches SET phase='failed',error='Preparation interrupted by host restart. Retry the exact request to reconcile admission.',updated_at=?2 WHERE request_id=?1 AND phase IN ('reserved','preparing_runtime')",params![id,now_utc()])?;
    }
    Ok(())
}
command ReconcileNativeTaskLaunchesCommand {}
call |_c| ()
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub fn reserve_native_task_launch(path: &Path, caller: &str, project_id: &str, source_cwd: &Path, retained: bool, request: NativeTaskRequest) -> Result<NativeTaskLaunch> {
    request.validate()?;
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(existing) = load(&tx, &request.request_id)? {
        anyhow::ensure!(existing.caller_session_id == caller && existing.request == request,
            "conflict: native launch identity reused with different caller or arguments");
        return Ok(existing);
    }
    let occupied:bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM task_launches WHERE request_id=?1)",params![request.request_id],|r|r.get(0))?;
    anyhow::ensure!(!occupied,"conflict: launch identity already belongs to another launch request");
    let project = projects::load_project_with_connection(&tx, project_id)?;
    anyhow::ensure!(project.ssh_host.is_none() && std::fs::canonicalize(&project.cwd)? == source_cwd,
        "conflict: native launch saved Local project binding changed");
    let caller_local: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sessions s WHERE session_id=?1
        AND behavior IN ('direct','direct-with-orchestrator') AND host_id IS NULL AND sandbox_json IS NULL
        AND NOT EXISTS(SELECT 1 FROM traditional_children WHERE child_session_id=s.session_id)
        AND NOT EXISTS(SELECT 1 FROM managed_orchestrators WHERE orchestrator_session_id=s.session_id))",
        params![caller], |row| row.get(0))?;
    anyhow::ensure!(caller_local, "native launch caller is not an independent Local direct task");
    if request.project_id.is_none() {
        let bound: Option<String> = tx.query_row("SELECT project_id FROM session_projects WHERE session_id=?1", params![caller], |r|r.get(0)).optional()?.flatten();
        anyhow::ensure!(bound.as_deref() == Some(project_id), "conflict: caller saved project changed");
    } else {
        anyhow::ensure!(request.project_id.as_deref() == Some(project_id), "conflict: explicit destination changed");
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    tx.execute("INSERT INTO native_task_launches(request_id,caller_session_id,project_id,request_json,source_cwd,session_id,retained,phase,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,'reserved',?8,?8)", params![request.request_id,caller,project_id,serde_json::to_string(&request)?,source_cwd.to_string_lossy(),session_id,retained,now_utc()])?;
    let record = load(&tx, &request.request_id)?.ok_or_else(|| anyhow!("native launch insert missing"))?;
    tx.commit()?;
    Ok(record)
}
command ReserveNativeTaskLaunchCommand { caller: String = caller.to_owned(), project_id: String = project_id.to_owned(), source_cwd: PathBuf = source_cwd.to_path_buf(), retained: bool = retained, request: NativeTaskRequest = request }
call |c| (&c.caller, &c.project_id, &c.source_cwd, c.retained, c.request)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub fn update_native_task_launch(path: &Path, request_id: &str, phase: &str, error: Option<String>) -> Result<NativeTaskLaunch> {
    anyhow::ensure!(matches!(phase,"reserved"|"preparing_runtime"|"failed"|"cancelled"), "invalid native launch phase");
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.execute("UPDATE native_task_launches SET phase=CASE WHEN phase='ready' THEN phase ELSE ?2 END,error=?3,updated_at=?4 WHERE request_id=?1 AND phase!='cancelled' AND (phase!='ready' OR ?2='failed')",
        params![request_id,phase,error,now_utc()])?;
    let record = load(&tx, request_id)?.ok_or_else(|| anyhow!("native launch not found"))?;
    tx.commit()?;
    Ok(record)
}
command UpdateNativeTaskLaunchCommand { request_id: String = request_id.to_owned(), phase: String = phase.to_owned(), error: Option<String> = error }
call |c| (&c.request_id, &c.phase, c.error)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// A published preparation stays ready; this records only initial-input admission.
pub fn update_native_task_admission_error(path: &Path, request_id: &str, error: Option<String>) -> Result<NativeTaskLaunch> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let record = load(&tx,request_id)?.ok_or_else(||anyhow!("native launch not found"))?;
    anyhow::ensure!(record.phase == "ready" && record.first_input_id.is_some(),"initial-input admission requires a published native launch");
    tx.execute("UPDATE native_task_launches SET error=?2,updated_at=?3 WHERE request_id=?1",params![request_id,error,now_utc()])?;
    let record = load(&tx,request_id)?.ok_or_else(||anyhow!("native launch not found"))?;
    tx.commit()?;
    Ok(record)
}
command UpdateNativeTaskAdmissionErrorCommand { request_id: String = request_id.to_owned(), error: Option<String> = error }
call |c| (&c.request_id,c.error)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

/// Joins the existing session creation transaction; no runtime or input admission here.
pub(crate) fn publish_in_transaction(
    tx: &Transaction<'_>,
    request_id: &str,
    snapshot: &crate::sessions::SessionSnapshot,
) -> Result<()> {
    let record = load(tx, request_id)?.ok_or_else(|| anyhow!("native launch not found"))?;
    anyhow::ensure!(
        !record.retained
            && record.phase == "preparing_runtime"
            && snapshot.session_id == record.session_id
            && snapshot.project_id.as_deref() == Some(record.project_id.as_str())
            && snapshot.behavior == crate::sessions::SessionBehavior::Direct
            && snapshot.cwd == record.source_cwd
            && snapshot.ssh.is_none()
            && snapshot.sandbox_spec.is_none(),
        "conflict: native launch publication binding changed"
    );
    let project = projects::load_project_with_connection(tx, &record.project_id)?;
    anyhow::ensure!(
        project.ssh_host.is_none() && std::fs::canonicalize(&project.cwd)? == snapshot.cwd,
        "conflict: saved project moved during preparation"
    );
    tx.execute(
        "INSERT INTO session_presentations(session_id,title) VALUES (?1,?2)",
        params![record.session_id, record.request.title],
    )?;
    let now = now_utc();
    tx.execute("INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at) VALUES (?1,'queue','pending',?2,?3,?3)",params![record.session_id,record.request.initial_prompt(),now])?;
    let input_id = tx.last_insert_rowid();
    tx.execute("UPDATE native_task_launches SET phase='ready',first_input_id=?2,error=NULL,updated_at=?3 WHERE request_id=?1",params![request_id,input_id,now])?;
    Ok(())
}

#[cfg(test)]
#[path = "native_task_launches_tests.rs"]
mod tests;
