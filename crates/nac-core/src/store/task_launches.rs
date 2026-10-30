//! Durable identity and retained inventory for prepared direct task launches.
//! Git effects belong to the workspace adapter, outside these transactions.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TaskLaunchRequest {
    pub request_id: String,
    pub project_id: String,
    pub invoking_session_id: Option<String>,
    pub git_ref: Option<String>,
    /// Required when initially binding a project without an invoking task.
    /// The binding persists independently of the ref selected for this launch.
    pub default_ref: Option<String>,
    pub title: String,
    pub prompt: String,
}

impl TaskLaunchRequest {
    pub fn validate(&self) -> Result<()> {
        anyhow::ensure!(
            uuid::Uuid::parse_str(&self.request_id)
                .is_ok_and(|id| id.to_string() == self.request_id),
            "invalid request: launch request_id must be a canonical UUID"
        );
        anyhow::ensure!(
            !self.project_id.is_empty()
                && self.project_id.len() <= 256
                && !self.prompt.trim().is_empty()
                && self.prompt.len() <= 131072,
            "invalid request: project, title and initial prompt are required and bounded"
        );
        let title = crate::sessions::normalize_presentation_title(&self.title)
            .map_err(|error| anyhow!("invalid request: {error}"))?;
        anyhow::ensure!(
            title.as_deref() == Some(self.title.as_str()),
            "invalid request: task title must be nonblank and trimmed"
        );
        for value in [&self.git_ref, &self.default_ref, &self.invoking_session_id]
            .into_iter()
            .flatten()
        {
            anyhow::ensure!(
                !value.trim().is_empty() && value.len() <= 1024 && !value.contains('\0'),
                "invalid request: launch references must be nonblank and bounded"
            );
        }
        for reference in [&self.git_ref, &self.default_ref].into_iter().flatten() {
            anyhow::ensure!(
                !reference.starts_with('-'),
                "invalid request: Git references cannot begin with an option prefix"
            );
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TaskLaunchSource {
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub project_cwd: PathBuf,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub source_cwd: PathBuf,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub repo_root: PathBuf,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub common_git_dir: PathBuf,
    pub repository_identity: String,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub subdirectory: PathBuf,
    pub default_ref: String,
    pub selected_ref: String,
    pub commit: String,
    /// Source-selection policy, not the result of scanning dirty contents.
    pub excluded_source_edits: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum TaskLaunchPhase {
    Pinned,
    PreparingWorkspace,
    PreparingRuntime,
    Ready,
    Failed,
    Cancelled,
}

impl TaskLaunchPhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pinned => "pinned",
            Self::PreparingWorkspace => "preparing_workspace",
            Self::PreparingRuntime => "preparing_runtime",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TaskLaunchRecord {
    pub request: TaskLaunchRequest,
    pub source: TaskLaunchSource,
    pub session_id: String,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub workspace_path: PathBuf,
    pub phase: TaskLaunchPhase,
    pub error: Option<String>,
    pub first_input_id: Option<i64>,
    /// Passive projection; inventory survives deletion of its published session.
    pub session_present: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub(super) fn create_tables(conn: &Connection) -> Result<()> {
    // Intentionally no cascading foreign keys: this inventory outlives project
    // and session deletion, which must never imply deleting retained files.
    conn.execute_batch("CREATE TABLE IF NOT EXISTS project_git_sources (
        project_id TEXT PRIMARY KEY, source_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_launches (
        request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE, request_json TEXT NOT NULL,
        source_json TEXT NOT NULL, workspace_path TEXT NOT NULL UNIQUE,
        phase TEXT NOT NULL CHECK(phase IN ('pinned','preparing_workspace','preparing_runtime','ready','failed','cancelled')),
        error TEXT, first_input_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );")?;
    Ok(())
}

fn load(conn: &Connection, request_id: &str) -> Result<Option<TaskLaunchRecord>> {
    let row = conn.query_row(
        "SELECT request_json,source_json,session_id,workspace_path,phase,error,first_input_id,created_at,updated_at
         FROM task_launches WHERE request_id=?1", params![request_id],
        |row| Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,String>(2)?,
            row.get::<_,String>(3)?, row.get::<_,String>(4)?, row.get::<_,Option<String>>(5)?,
            row.get::<_,Option<i64>>(6)?, row.get::<_,String>(7)?, row.get::<_,String>(8)?))
    ).optional()?;
    row.map(
        |(
            request,
            source,
            session_id,
            path,
            phase,
            error,
            first_input_id,
            created_at,
            updated_at,
        )| {
            Ok(TaskLaunchRecord {
                request: serde_json::from_str(&request)?,
                source: serde_json::from_str(&source)?,
                session_id: session_id.clone(),
                workspace_path: path.into(),
                phase: serde_json::from_value(serde_json::Value::String(phase))?,
                error,
                first_input_id,
                session_present: conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id=?1)",
                    params![session_id],
                    |row| row.get(0),
                )?,
                created_at,
                updated_at,
            })
        },
    )
    .transpose()
}

coordinated_command! {
pub fn load_task_launch(path: &Path, request_id: &str) -> Result<Option<TaskLaunchRecord>> {
    let conn = open_runtime_connection(path)?;
    load(&conn, request_id)
}
command LoadTaskLaunchCommand { request_id: String = request_id.to_owned() }
call |c| (&c.request_id)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub fn load_project_git_source(path: &Path, project_id: &str) -> Result<Option<TaskLaunchSource>> {
    let conn = open_runtime_connection(path)?;
    let raw: Option<String> = conn.query_row("SELECT source_json FROM project_git_sources WHERE project_id=?1",
        params![project_id], |row| row.get(0)).optional()?;
    raw.map(|raw| serde_json::from_str(&raw).map_err(Into::into)).transpose()
}
command LoadProjectGitSourceCommand { project_id: String = project_id.to_owned() }
call |c| (&c.project_id)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub fn list_task_launches(path: &Path, project_id: &str) -> Result<Vec<TaskLaunchRecord>> {
    let conn = open_runtime_connection(path)?;
    let ids = conn.prepare("SELECT request_id FROM task_launches WHERE project_id=?1 ORDER BY created_at,request_id")?
        .query_map(params![project_id], |row| row.get::<_,String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.into_iter().map(|id| load(&conn, &id)?.ok_or_else(|| anyhow!("launch inventory changed"))).collect()
}
command ListTaskLaunchesCommand { project_id: String = project_id.to_owned() }
call |c| (&c.project_id)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub fn reserve_task_launch(path: &Path, request: TaskLaunchRequest, source: TaskLaunchSource) -> Result<TaskLaunchRecord> {
    request.validate()?;
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(existing) = load(&tx, &request.request_id)? {
        anyhow::ensure!(existing.request == request, "conflict: launch request identity was reused with different arguments");
        return Ok(existing);
    }
    let project = projects::load_project_with_connection(&tx, &request.project_id)?;
    anyhow::ensure!(project.cwd == source.project_cwd && project.ssh_host.is_none(),
        "conflict: launch source does not match the saved Local project");
    anyhow::ensure!(source.source_cwd == source.repo_root.join(&source.subdirectory)
        && source.subdirectory.components().all(|c| matches!(c, std::path::Component::Normal(_)))
        && source.commit.len() >= 40 && source.commit.len() <= 64 && source.commit.bytes().all(|b| b.is_ascii_hexdigit()),
        "invalid request: invalid derived source binding");
    let bound: Option<String> = tx.query_row("SELECT source_json FROM project_git_sources WHERE project_id=?1",
        params![request.project_id], |row| row.get(0)).optional()?;
    if let Some(bound) = bound {
        let mut bound: TaskLaunchSource = serde_json::from_str(&bound)?;
        // Older named bindings stored Git's short spelling. The adapter has
        // validated its direct branch identity outside this transaction. Anchor
        // that representation once; historical launch receipts/checkpoints stay
        // byte-for-byte unchanged so exact retries retain their original proof.
        let same_default = bound.default_ref == source.default_ref
            || ["refs/heads/", "refs/remotes/"].iter().any(|prefix| {
                source.default_ref.strip_prefix(prefix) == Some(bound.default_ref.as_str())
            });
        anyhow::ensure!(bound.project_cwd == source.project_cwd && bound.source_cwd == source.source_cwd
            && bound.repo_root == source.repo_root && bound.common_git_dir == source.common_git_dir
            && bound.repository_identity == source.repository_identity
            && bound.subdirectory == source.subdirectory && same_default,
            "conflict: saved project Git binding changed");
        if bound.default_ref != source.default_ref {
            bound.default_ref = source.default_ref.clone();
            tx.execute("UPDATE project_git_sources SET source_json=?2 WHERE project_id=?1",
                params![request.project_id,serde_json::to_string(&bound)?])?;
        }
    } else {
        tx.execute("INSERT INTO project_git_sources(project_id,source_json) VALUES (?1,?2)",
            params![request.project_id,serde_json::to_string(&source)?])?;
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    let canonical_store = std::fs::canonicalize(path)?;
    let workspace_path = canonical_store.parent().ok_or_else(|| anyhow!("store has no parent"))?
        .join("task-worktrees").join(&session_id);
    tx.execute("INSERT INTO task_launches(request_id,project_id,session_id,request_json,source_json,workspace_path,phase,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,'pinned',?7,?7)",
        params![request.request_id,request.project_id,session_id,serde_json::to_string(&request)?,
            serde_json::to_string(&source)?, workspace_path.to_string_lossy(),now_utc()])?;
    let record = load(&tx, &request.request_id)?.ok_or_else(|| anyhow!("launch insert missing"))?;
    tx.commit()?;
    Ok(record)
}
command ReserveTaskLaunchCommand { request: TaskLaunchRequest = request, source: TaskLaunchSource = source }
call |c| (c.request, c.source)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub fn update_task_launch(path: &Path, request_id: &str, phase: TaskLaunchPhase, error: Option<String>) -> Result<TaskLaunchRecord> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let existing = load(&tx, request_id)?.ok_or_else(|| anyhow!("launch not found"))?;
    // Cancellation wins over late preparation/error responses. Publication is
    // only performed by the session creation transaction below.
    if existing.phase != TaskLaunchPhase::Cancelled && (existing.phase != TaskLaunchPhase::Ready || phase == TaskLaunchPhase::Cancelled) {
        if phase == TaskLaunchPhase::Cancelled {
            if let Some(input_id) = existing.first_input_id {
                tx.execute("UPDATE session_inbox SET status='cancelled',cancelled_at=?2,updated_at=?2,version=version+1 WHERE id=?1 AND status='pending'",
                    params![input_id,now_utc()])?;
            }
        }
        anyhow::ensure!(phase != TaskLaunchPhase::Ready, "ready requires committed session creation");
        tx.execute("UPDATE task_launches SET phase=?2,error=?3,updated_at=?4 WHERE request_id=?1",
            params![request_id,phase.as_str(),error,now_utc()])?;
    }
    let record = load(&tx, request_id)?.ok_or_else(|| anyhow!("launch not found"))?;
    tx.commit()?;
    Ok(record)
}
command UpdateTaskLaunchCommand { request_id: String = request_id.to_owned(), phase: TaskLaunchPhase = phase, error: Option<String> = error }
call |c| (&c.request_id,c.phase,c.error)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Reconcile only preparations whose OS owner disappeared. This never runs Git,
/// creates a session, admits input, or deletes a retained resource.
pub fn reconcile_task_launches(path: &Path) -> Result<()> {
    let conn = open_runtime_connection(path)?;
    let ids = conn.prepare("SELECT request_id FROM task_launches WHERE phase IN ('pinned','preparing_workspace','preparing_runtime')")?
        .query_map([], |row| row.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        match crate::sessions::SessionOperationLease::try_acquire(path, &format!("task-launch:{id}")) {
            Ok(_lease) => {
                conn.execute("UPDATE task_launches SET phase='failed',error='Preparation interrupted by host restart. Resume this request to reconcile its retained checkout.',updated_at=?2 WHERE request_id=?1 AND phase IN ('pinned','preparing_workspace','preparing_runtime')", params![id,now_utc()])?;
            }
            Err(crate::sessions::SessionOperationLeaseError::Busy(_)) => {},
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
command ReconcileTaskLaunchesCommand {}
call |_c| ()
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

/// Called inside the existing creation transaction, never a second commit.
pub(crate) fn publish_in_transaction(
    tx: &Transaction<'_>,
    request_id: &str,
    snapshot: &crate::sessions::SessionSnapshot,
) -> Result<()> {
    let launch = load(tx, request_id)?.ok_or_else(|| anyhow!("launch not found"))?;
    launch.request.validate()?;
    anyhow::ensure!(
        launch.phase == TaskLaunchPhase::PreparingRuntime,
        "conflict: launch is not preparing runtime"
    );
    anyhow::ensure!(
        snapshot.behavior == crate::sessions::SessionBehavior::Direct
            && snapshot.session_id == launch.session_id
            && snapshot.ssh.is_none()
            && snapshot.sandbox_spec.is_none()
            && snapshot.project_id.as_deref() == Some(launch.request.project_id.as_str())
            && snapshot.cwd == launch.workspace_path.join(&launch.source.subdirectory),
        "conflict: prepared session does not match retained launch"
    );
    let now = now_utc();
    tx.execute("INSERT INTO session_presentations(session_id,title) VALUES (?1,?2) ON CONFLICT(session_id) DO UPDATE SET title=excluded.title",
        params![launch.session_id, launch.request.title])?;
    tx.execute(
        "INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at)
        VALUES (?1,'queue','pending',?2,?3,?3)",
        params![launch.session_id, launch.request.prompt, now],
    )?;
    let input_id = tx.last_insert_rowid();
    tx.execute("UPDATE task_launches SET phase='ready',first_input_id=?2,error=NULL,updated_at=?3 WHERE request_id=?1",
        params![request_id,input_id,now])?;
    Ok(())
}

#[cfg(test)]
#[path = "task_launches_tests.rs"]
mod tests;
