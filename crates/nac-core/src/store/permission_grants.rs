use super::*;

/// Process-local authority for grant commits belonging to one agent run.
/// Closure rejects new commits immediately. Settlement waits only for a
/// transaction already inside its final commit, never for the DB writer queue.
#[derive(Debug, Default)]
pub(crate) struct PermissionGrantCommitFence {
    closed: std::sync::atomic::AtomicBool,
    commit: std::sync::Mutex<()>,
}

impl PermissionGrantCommitFence {
    pub(crate) fn close(&self) {
        self.closed
            .store(true, std::sync::atomic::Ordering::Release);
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.closed.load(std::sync::atomic::Ordering::Acquire)
    }

    pub(crate) fn settle(&self) {
        drop(
            self.commit
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
    }
}

/// One human reply's grant-commit authority. Task teardown and the prepared
/// writer race exactly once: abort first forbids persistence; commit admission
/// first lets that human Always finish even if its invocation is then aborted.
/// Drop must never wait for SQLite on an async runtime worker.
#[derive(Debug, Default)]
pub(crate) struct PermissionGrantWaiter {
    state: std::sync::atomic::AtomicU8,
}

impl PermissionGrantWaiter {
    const LIVE: u8 = 0;
    const ABORTED: u8 = 1;
    const COMMIT_ADMITTED: u8 = 2;

    pub(crate) fn abort(&self) {
        let _ = self.state.compare_exchange(
            Self::LIVE,
            Self::ABORTED,
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Acquire,
        );
    }

    fn admit_commit(&self) -> bool {
        self.state
            .compare_exchange(
                Self::LIVE,
                Self::COMMIT_ADMITTED,
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Acquire,
            )
            .is_ok()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PermissionGrantRecord {
    pub id: String,
    pub session_id: String,
    pub action: String,
    pub resource: String,
    pub backend: String,
    pub session_config_version: i64,
    pub created_at: String,
}

const COLUMNS: &str =
    "id, session_id, action, resource, backend, session_config_version, created_at";

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<PermissionGrantRecord> {
    Ok(PermissionGrantRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        action: row.get(2)?,
        resource: row.get(3)?,
        backend: row.get(4)?,
        session_config_version: row.get(5)?,
        created_at: row.get(6)?,
    })
}

coordinated_command! {
pub fn list_permission_grants(path: &Path, session_id: &str) -> Result<Vec<PermissionGrantRecord>> {
    let connection = open_runtime_connection(path)?;
    let mut statement = connection.prepare(&format!(
        "SELECT {COLUMNS} FROM permission_grants
         WHERE session_id = ?1 ORDER BY created_at ASC, id ASC"
    ))?;
    let rows = statement.query_map(params![session_id], row_to_record)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}
command ListPermissionGrantsCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub(crate) fn list_effective_permission_grants(
    path: &Path,
    session_id: &str,
    backend: &str,
    session_config_version: i64,
) -> Result<Vec<PermissionGrantRecord>> {
    let connection = open_runtime_connection(path)?;
    let mut statement = connection.prepare(&format!(
        "SELECT {COLUMNS} FROM permission_grants
         WHERE session_id = ?1 AND backend = ?2 AND session_config_version = ?3
         ORDER BY created_at ASC, id ASC"
    ))?;
    let rows = statement.query_map(
        params![session_id, backend, session_config_version],
        row_to_record,
    )?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}
command ListEffectivePermissionGrantsCommand {
    session_id: String = session_id.to_owned(),
    backend: String = backend.to_owned(),
    session_config_version: i64 = session_config_version,
}
call |command| (&command.session_id, &command.backend, command.session_config_version)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub fn insert_permission_grants(
    path: &Path,
    session_id: &str,
    action: &str,
    resources: &[String],
    backend: &str,
    session_config_version: i64,
) -> Result<Vec<PermissionGrantRecord>> {
    let grants = resources
        .iter()
        .map(|resource| (action.to_string(), resource.clone()))
        .collect::<Vec<_>>();
    insert_permission_grant_set(path, session_id, &grants, backend, session_config_version)
}
command InsertPermissionGrantsCommand {
    session_id: String = session_id.to_owned(),
    action: String = action.to_owned(),
    resources: Vec<String> = resources.to_vec(),
    backend: String = backend.to_owned(),
    session_config_version: i64 = session_config_version,
}
call |command| (&command.session_id, &command.action, &command.resources, &command.backend, command.session_config_version)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub(crate) fn insert_permission_grant_set(
    path: &Path,
    session_id: &str,
    grants: &[(String, String)],
    backend: &str,
    session_config_version: i64,
) -> Result<Vec<PermissionGrantRecord>> {
    insert_permission_grant_set_inner(
        path,
        session_id,
        grants,
        backend,
        session_config_version,
        None,
        None,
    )?
    .ok_or_else(|| anyhow!("permission grant insertion unexpectedly lost its waiter"))
}
command InsertPermissionGrantSetCommand {
    session_id: String = session_id.to_owned(),
    grants: Vec<(String, String)> = grants.to_vec(),
    backend: String = backend.to_owned(),
    session_config_version: i64 = session_config_version,
}
call |command| (&command.session_id, &command.grants, &command.backend, command.session_config_version)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
pub(crate) fn insert_permission_grant_set_if_waiter_live(
    path: &Path,
    session_id: &str,
    grants: &[(String, String)],
    backend: &str,
    session_config_version: i64,
    waiter_live: &std::sync::Arc<PermissionGrantWaiter>,
    run_fence: &std::sync::Arc<PermissionGrantCommitFence>,
) -> Result<Option<Vec<PermissionGrantRecord>>> {
    insert_permission_grant_set_inner(
        path,
        session_id,
        grants,
        backend,
        session_config_version,
        Some(waiter_live),
        Some(run_fence),
    )
}
command InsertPermissionGrantSetIfWaiterLiveCommand {
    session_id: String = session_id.to_owned(),
    grants: Vec<(String, String)> = grants.to_vec(),
    backend: String = backend.to_owned(),
    session_config_version: i64 = session_config_version,
    waiter_live: std::sync::Arc<PermissionGrantWaiter> = std::sync::Arc::clone(waiter_live),
    run_fence: std::sync::Arc<PermissionGrantCommitFence> = std::sync::Arc::clone(run_fence),
}
call |command| (&command.session_id, &command.grants, &command.backend, command.session_config_version, &command.waiter_live, &command.run_fence)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

fn insert_permission_grant_set_inner(
    path: &Path,
    session_id: &str,
    grants: &[(String, String)],
    backend: &str,
    session_config_version: i64,
    waiter_live: Option<&PermissionGrantWaiter>,
    run_fence: Option<&PermissionGrantCommitFence>,
) -> Result<Option<Vec<PermissionGrantRecord>>> {
    if session_id.trim().is_empty() || grants.iter().any(|(action, _)| action.trim().is_empty()) {
        return Err(anyhow!(
            "permission grant session and action must not be empty"
        ));
    }
    if grants.is_empty()
        || grants
            .iter()
            .any(|(_, resource)| resource.trim().is_empty())
    {
        return Err(anyhow!("permission grant resources must not be empty"));
    }
    if !matches!(backend, "local" | "podman" | "ssh") {
        return Err(anyhow!("unsupported permission grant backend '{backend}'"));
    }
    if session_config_version < 0 {
        return Err(anyhow!(
            "permission grant config version must not be negative"
        ));
    }
    #[cfg(test)]
    permission_grant_test_pause(path, PermissionGrantTestPoint::BeforeWriter);
    let mut connection = open_runtime_connection(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let now = now_utc();
    for (action, resource) in grants {
        transaction.execute(
            "INSERT OR IGNORE INTO permission_grants
             (id, session_id, action, resource, backend, session_config_version, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                uuid::Uuid::new_v4().to_string(),
                session_id,
                action,
                resource,
                backend,
                session_config_version,
                now
            ],
        )?;
    }
    let effective = {
        let mut statement = transaction.prepare(&format!(
            "SELECT {COLUMNS} FROM permission_grants
             WHERE session_id = ?1 AND backend = ?2 AND session_config_version = ?3
             ORDER BY created_at ASC, id ASC"
        ))?;
        let rows = statement.query_map(
            params![session_id, backend, session_config_version],
            row_to_record,
        )?;
        rows.collect::<std::result::Result<Vec<_>, _>>()?
    };
    #[cfg(test)]
    permission_grant_test_pause(path, PermissionGrantTestPoint::BeforeCommit);
    // Acquire this only after writer admission and SQL preparation. If close
    // wins first, uncommitted inserts roll back; if commit wins first, stop
    // settlement waits off-runtime for this short final boundary.
    let run_guard = run_fence.map(|fence| {
        fence
            .commit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    });
    if run_fence.is_some_and(PermissionGrantCommitFence::is_closed) {
        return Ok(None);
    }
    // This CAS is the abort-versus-commit linearization point. It happens
    // only after run admission, immediately before commit; no runtime Drop
    // ever waits for a writer or SQLite transaction.
    if waiter_live.is_some_and(|waiter| !waiter.admit_commit()) {
        return Ok(None);
    }
    #[cfg(test)]
    permission_grant_test_pause(path, PermissionGrantTestPoint::InsideCommit);
    transaction.commit()?;
    drop(run_guard);
    Ok(Some(effective))
}

coordinated_command! {
pub fn delete_permission_grant(path: &Path, session_id: &str, grant_id: &str) -> Result<()> {
    let connection = open_runtime_connection(path)?;
    let changed = connection.execute(
        "DELETE FROM permission_grants WHERE session_id = ?1 AND id = ?2",
        params![session_id, grant_id],
    )?;
    if changed == 0 {
        return Err(anyhow!(
            "permission grant '{grant_id}' was not found in session '{session_id}'"
        ));
    }
    Ok(())
}
command DeletePermissionGrantCommand {
    session_id: String = session_id.to_owned(),
    grant_id: String = grant_id.to_owned(),
}
call |command| (&command.session_id, &command.grant_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_are_deduplicated_scoped_and_revision_bound() {
        let path = std::env::temp_dir()
            .join(format!("nac-permission-grants-{}", uuid::Uuid::new_v4()))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::insert_test_session(&path, "session-b");

        let resources = vec!["command:[cargo][test]*".to_string()];
        insert_permission_grants(&path, "session-a", "execute", &resources, "local", 0).unwrap();
        insert_permission_grants(&path, "session-a", "execute", &resources, "local", 0).unwrap();
        assert_eq!(list_permission_grants(&path, "session-a").unwrap().len(), 1);
        assert_eq!(
            list_effective_permission_grants(&path, "session-a", "local", 0)
                .unwrap()
                .len(),
            1
        );
        assert!(
            list_effective_permission_grants(&path, "session-a", "ssh", 0)
                .unwrap()
                .is_empty()
        );
        assert!(
            list_effective_permission_grants(&path, "session-a", "local", 1)
                .unwrap()
                .is_empty()
        );
        assert!(list_permission_grants(&path, "session-b")
            .unwrap()
            .is_empty());

        let id = list_permission_grants(&path, "session-a").unwrap()[0]
            .id
            .clone();
        delete_permission_grant(&path, "session-a", &id).unwrap();
        assert!(list_permission_grants(&path, "session-a")
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn multi_action_grant_set_commits_atomically() {
        let path = std::env::temp_dir()
            .join(format!("nac-permission-grant-set-{}", uuid::Uuid::new_v4()))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        insert_permission_grant_set(
            &path,
            "session-a",
            &[
                ("execute".to_string(), "command:[cargo][test]*".to_string()),
                ("read".to_string(), "/outside/Cargo.toml".to_string()),
            ],
            "local",
            0,
        )
        .unwrap();
        let grants = list_permission_grants(&path, "session-a").unwrap();
        assert_eq!(grants.len(), 2);
        assert!(grants.iter().any(|grant| grant.action == "execute"));
        assert!(grants.iter().any(|grant| grant.action == "read"));

        let error = insert_permission_grant_set(
            &path,
            "session-a",
            &[
                ("edit".to_string(), "/outside/a".to_string()),
                (String::new(), "/outside/b".to_string()),
            ],
            "local",
            0,
        )
        .unwrap_err();
        assert!(error.to_string().contains("must not be empty"));
        assert_eq!(list_permission_grants(&path, "session-a").unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn grant_commit_and_result_use_one_connection() {
        let path = std::env::temp_dir()
            .join(format!(
                "nac-permission-grant-single-connection-{}",
                uuid::Uuid::new_v4()
            ))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::track_connection_opens(&path);

        let effective = insert_permission_grant_set(
            &path,
            "session-a",
            &[("execute".to_string(), "command:[cargo][test]*".to_string())],
            "local",
            0,
        )
        .unwrap();

        assert_eq!(effective.len(), 1);
        assert_eq!(crate::store::tracked_connection_opens(&path), 1);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

#[cfg(test)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum PermissionGrantTestPoint {
    BeforeWriter,
    BeforeCommit,
    InsideCommit,
}
#[cfg(test)]
struct PermissionGrantTestGate {
    point: PermissionGrantTestPoint,
    entered: tokio::sync::oneshot::Sender<()>,
    resume: std::sync::mpsc::Receiver<()>,
}
#[cfg(test)]
static PERMISSION_GRANT_TEST_GATES: std::sync::LazyLock<
    std::sync::Mutex<HashMap<PathBuf, PermissionGrantTestGate>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));
#[cfg(test)]
pub(crate) fn permission_grant_test_gate(
    path: PathBuf,
    point: PermissionGrantTestPoint,
) -> (
    tokio::sync::oneshot::Receiver<()>,
    std::sync::mpsc::Sender<()>,
) {
    let (entered, reached) = tokio::sync::oneshot::channel();
    let (release, resume) = std::sync::mpsc::channel();
    assert!(PERMISSION_GRANT_TEST_GATES
        .lock()
        .unwrap()
        .insert(
            path,
            PermissionGrantTestGate {
                point,
                entered,
                resume
            }
        )
        .is_none());
    (reached, release)
}
#[cfg(test)]
fn permission_grant_test_pause(path: &Path, point: PermissionGrantTestPoint) {
    let gate = {
        let mut gates = PERMISSION_GRANT_TEST_GATES.lock().unwrap();
        if gates.get(path).is_some_and(|gate| gate.point == point) {
            gates.remove(path)
        } else {
            None
        }
    };
    if let Some(gate) = gate {
        let _ = gate.entered.send(());
        let _ = gate.resume.recv_timeout(std::time::Duration::from_secs(10));
    }
}
