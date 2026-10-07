//! Actual selected-backend construction cancellation and owned cleanup.
use super::*;
use crate::workspace::worktree::test_harness::{git, TestRepo};
use std::os::unix::fs::PermissionsExt;

struct BlockedBackend {
    root: PathBuf,
    original_program: Option<std::ffi::OsString>,
    original_path: Option<std::ffi::OsString>,
}
impl BlockedBackend {
    fn new(fixture: &Fixture) -> Self {
        let root = fixture.path.parent().unwrap().to_path_buf();
        let program = root.join("podman");
        // All paths belong to this UUID fixture. No host engine is invoked.
        let script = format!(
            r#"#!/bin/sh
case "$1" in
  container)
    if [ -f '{root}/existing-container' ]; then exit 0; else exit 1; fi ;;
  image) exit 0 ;;
  run)
    shift
    cidfile=
    token=
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --cidfile) cidfile="$2"; shift ;;
        --label) token=$(printf %s "$2" | cut -d = -f2); shift ;;
      esac
      shift
    done
    printf %s "$cidfile" > '{root}/cidfile-path'
    printf %s "$token" > '{root}/creation-token'
    printf %s $$ > '{root}/backend-pid'
    while [ ! -f '{root}/release-backend' ]; do sleep 0.02; done
    printf '%064d\n' 0 > "$cidfile"
    printf 'created\n' >> '{root}/backend-events'
    exit 0 ;;
  inspect)
    if [ "$2" = --format ]; then printf 'true\n'; exit 0; fi
    if [ -f '{root}/inspection-token' ]; then
      cat '{root}/inspection-token'
    else
      cat '{root}/creation-token'
    fi
    exit 0 ;;
  rm)
    printf '%s\n' "$@" > '{root}/removed-arguments'
    printf 'removed\n' >> '{root}/backend-events'
    exit 0 ;;
esac
exit 99
"#,
            root = root.display(),
        );
        std::fs::write(&program, script).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        let original_program = std::env::var_os("NAC_TEST_PODMAN_PROGRAM");
        let original_path = std::env::var_os("PATH");
        let mut paths = vec![root.clone()];
        paths.extend(std::env::split_paths(
            original_path.as_deref().unwrap_or_default(),
        ));
        unsafe { std::env::set_var("NAC_TEST_PODMAN_PROGRAM", &program) };
        unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };
        Self {
            root,
            original_program,
            original_path,
        }
    }
    fn marker(&self) -> PathBuf {
        self.root.join("backend-pid")
    }
    fn cidfile(&self) -> PathBuf {
        PathBuf::from(std::fs::read_to_string(self.root.join("cidfile-path")).unwrap())
    }
    fn release(&self) {
        std::fs::write(self.root.join("release-backend"), "").unwrap();
    }
    async fn await_cleanup(&self, pid: i32, cidfile: &std::path::Path) {
        construction_mcp_gone(pid).await;
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if !cidfile.parent().unwrap().exists()
                    && self.root.join("removed-arguments").exists()
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(self.root.join("backend-events")).unwrap(),
            "created\nremoved\n",
            "cleanup must wait for this exact creation task to settle"
        );
        let removed = std::fs::read_to_string(self.root.join("removed-arguments")).unwrap();
        assert_eq!(
            removed,
            format!("rm\n--ignore\n-f\n--\n{}\n", "0".repeat(64))
        );
    }
}
impl Drop for BlockedBackend {
    fn drop(&mut self) {
        // Release this fixture even on assertion failure; no unowned PID kill.
        let _ = std::fs::write(self.root.join("release-backend"), "");
        unsafe {
            if let Some(original) = self.original_program.take() {
                std::env::set_var("NAC_TEST_PODMAN_PROGRAM", original);
            } else {
                std::env::remove_var("NAC_TEST_PODMAN_PROGRAM");
            }
            if let Some(original) = self.original_path.take() {
                std::env::set_var("PATH", original);
            } else {
                std::env::remove_var("PATH");
            }
        }
    }
}

async fn blocked_backend_construction(cancel_caller: bool) {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let repo = TestRepo::new("runtime-construction-backend");
    repo.commit_file("retained.txt", "retained checkout\n");
    let original_head = git(&repo.root, &["rev-parse", "HEAD"]);
    let backend = BlockedBackend::new(&fixture);
    let mut options = construction_options(&fixture);
    options.workspace_cwd = repo.root.clone();
    options.sandbox.sandbox = true;
    options.sandbox.sandbox_backend = Some("podman".into());
    options.sandbox.sandbox_image = Some("synthetic-local-image".into());
    let guard = fixture
        .guard(if cancel_caller { 20_000 } else { 1_500 })
        .await;
    let selected = Arc::clone(&guard);
    let building = tokio::spawn(async move {
        crate::runtime::build_run_config_for_runtime_operation(
            options,
            &crate::runtime::NacConfig::default(),
            None,
            crate::sessions::SessionBehavior::Direct,
            Some(selected),
        )
        .await
    });
    let pid = construction_mcp_marker(&backend.marker()).await;
    let cidfile = backend.cidfile();
    let scratch = fixture.path.parent().unwrap().join("worktrees");
    let fresh_forks = || {
        std::fs::read_dir(&scratch)
            .unwrap()
            .filter(|entry| entry.as_ref().unwrap().file_type().unwrap().is_dir())
            .count()
    };
    assert_eq!(fresh_forks(), 1);
    if cancel_caller {
        building.abort();
        assert!(building.await.err().unwrap().is_cancelled());
    } else {
        assert!(tokio::time::timeout(Duration::from_secs(3), building)
            .await
            .unwrap()
            .unwrap()
            .is_err());
    }
    assert!(guard.check_now().is_err());
    assert!(fixture.store.list_sessions().await.unwrap().is_empty());
    assert_eq!(
        fresh_forks(),
        0,
        "cancelled setup must roll back its unpersisted fresh worktree"
    );
    assert_eq!(git(&repo.root, &["rev-parse", "HEAD"]), original_head);
    assert_eq!(
        std::fs::read_to_string(repo.root.join("retained.txt")).unwrap(),
        "retained checkout\n"
    );
    assert!(
        !backend.root.join("removed-arguments").exists(),
        "removal cannot race ahead of late container registration"
    );
    assert!(cidfile.parent().unwrap().exists());
    backend.release();
    backend.await_cleanup(pid, &cidfile).await;
    assert!(matches!(
        fixture
            .store
            .reserve_managed_runtime_lease(guard.binding().unwrap(), native_clock().unwrap())
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    drop(backend);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_construction_backend_expiry_interrupts_setup_and_preserves_owned_cleanup() {
    blocked_backend_construction(false).await;
}

#[tokio::test]
async fn runtime_construction_backend_caller_cancel_rolls_back_only_its_fresh_worktree() {
    blocked_backend_construction(true).await;
}

#[tokio::test]
async fn runtime_construction_backend_completed_creation_cleanup_uses_only_recorded_identity() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let backend = BlockedBackend::new(&fixture);
    backend.release();
    let mut options = construction_options(&fixture);
    options.sandbox.sandbox = true;
    options.sandbox.no_mount_cwd = true;
    options.sandbox.sandbox_backend = Some("podman".into());
    options.sandbox.sandbox_image = Some("synthetic-local-image".into());
    let guard = fixture.guard(20_000).await;
    let mut config = crate::runtime::NacConfig::default();
    // This construction error happens after actual backend creation succeeds,
    // exercising explicit teardown as well as the pending-creation Drop path.
    config.worker.command_output_max_bytes = Some(0);
    assert!(crate::runtime::build_run_config_for_runtime_operation(
        options,
        &config,
        None,
        crate::sessions::SessionBehavior::Direct,
        Some(Arc::clone(&guard)),
    )
    .await
    .is_err());
    let pid = construction_mcp_marker(&backend.marker()).await;
    backend.await_cleanup(pid, &backend.cidfile()).await;
    assert!(guard.check_now().is_err());
    assert!(fixture.store.list_sessions().await.unwrap().is_empty());
    drop(backend);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_construction_backend_wrong_token_preserves_record_for_exact_retry() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let backend = BlockedBackend::new(&fixture);
    backend.release();
    let session = crate::sandbox::SandboxSession::create_for_durable_launch(
        crate::sandbox::SandboxSpec::default(),
        Uuid::new_v4().to_string(),
        true,
        "runtime-construction-wrong-token".into(),
        fixture.path.clone(),
    )
    .await
    .unwrap();
    let pid = construction_mcp_marker(&backend.marker()).await;
    let cidfile = backend.cidfile();
    let wrong_token = backend.root.join("inspection-token");
    std::fs::write(&wrong_token, "another-launch-token").unwrap();
    assert!(session.destroy().await.is_err());
    assert!(
        cidfile.exists(),
        "failed cleanup must retain ownership evidence"
    );
    assert!(!backend.root.join("removed-arguments").exists());
    std::fs::remove_file(wrong_token).unwrap();
    session.destroy().await.unwrap();
    backend.await_cleanup(pid, &cidfile).await;
    drop(session);
    drop(backend);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_construction_backend_unavailable_store_preserves_record_and_backend() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let backend = BlockedBackend::new(&fixture);
    backend.release();
    let session = crate::sandbox::SandboxSession::create_for_durable_launch(
        crate::sandbox::SandboxSpec::default(),
        Uuid::new_v4().to_string(),
        true,
        "runtime-construction-unavailable-store".into(),
        fixture.path.clone(),
    )
    .await
    .unwrap();
    let pid = construction_mcp_marker(&backend.marker()).await;
    let cidfile = backend.cidfile();
    let retained_store = fixture.path.with_extension("retained");
    std::fs::rename(&fixture.path, &retained_store).unwrap();
    let result = session.destroy().await;
    // Restore this exact fixture even if the cleanup expectation fails.
    std::fs::rename(&retained_store, &fixture.path).unwrap();
    assert!(result.is_err());
    assert!(cidfile.exists());
    assert!(!backend.root.join("removed-arguments").exists());
    session.destroy().await.unwrap();
    backend.await_cleanup(pid, &cidfile).await;
    drop(session);
    drop(backend);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_construction_backend_queued_store_loss_preserves_owned_resources() {
    use crate::store::coordinator::PersistenceCommand;
    struct StoreGate {
        entered: std::sync::mpsc::SyncSender<()>,
        release: std::sync::mpsc::Receiver<()>,
    }
    impl PersistenceCommand for StoreGate {
        type Output = anyhow::Result<()>;
        fn correlation(&self) -> crate::telemetry::Correlation {
            crate::telemetry::Correlation::default()
        }
        fn outcome(_output: &Self::Output) -> crate::telemetry::TelemetryOutcome {
            crate::telemetry::TelemetryOutcome::Ok
        }
        fn error_identity(_output: &Self::Output) -> Option<crate::telemetry::StoreErrorIdentity> {
            None
        }
        fn execute(self, _path: &std::path::Path) -> anyhow::Result<Self::Output> {
            self.entered.send(())?;
            self.release.recv()?;
            Ok(Ok(()))
        }
    }
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    for replace in [false, true] {
        let fixture = Fixture::new();
        let _home = ConstructionHome::new(&fixture);
        let backend = BlockedBackend::new(&fixture);
        backend.release();
        let session = crate::sandbox::SandboxSession::create_for_durable_launch(
            crate::sandbox::SandboxSpec::default(),
            Uuid::new_v4().to_string(),
            true,
            "runtime-construction-queued-store-loss".into(),
            fixture.path.clone(),
        )
        .await
        .unwrap();
        let pid = construction_mcp_marker(&backend.marker()).await;
        let cidfile = backend.cidfile();
        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
        let gate = fixture
            .store
            .submit(StoreGate {
                entered: entered_tx,
                release: release_rx,
            })
            .unwrap();
        tokio::task::spawn_blocking(move || entered_rx.recv().unwrap())
            .await
            .unwrap();
        let before = fixture.store.stats().admitted;
        let cleanup = tokio::spawn(async move {
            let result = session.destroy().await;
            (session, result)
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while fixture.store.stats().admitted == before {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let retained_store = fixture.path.with_extension("retained");
        std::fs::rename(&fixture.path, &retained_store).unwrap();
        if replace {
            std::fs::write(&fixture.path, b"replacement must remain untouched").unwrap();
        }
        release_tx.send(()).unwrap();
        gate.acknowledge().await.unwrap().unwrap();
        let (session, result) = cleanup.await.unwrap();
        if replace {
            assert_eq!(
                std::fs::read(&fixture.path).unwrap(),
                b"replacement must remain untouched"
            );
            std::fs::remove_file(&fixture.path).unwrap();
        } else {
            assert!(
                !fixture.path.exists(),
                "cleanup must not initialize a missing store"
            );
        }
        std::fs::rename(retained_store, &fixture.path).unwrap();
        assert!(result.is_err());
        assert!(cidfile.exists());
        assert!(!backend.root.join("removed-arguments").exists());
        session.destroy().await.unwrap();
        backend.await_cleanup(pid, &cidfile).await;
        drop(session);
        drop(backend);
        fixture.finish().await;
    }
}

#[tokio::test]
async fn runtime_construction_backend_committed_and_resumed_attachments_preserve_existing_data() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let backend = BlockedBackend::new(&fixture);
    backend.release();
    let session_id = Uuid::new_v4().to_string();
    let retained = backend.root.join("retained-volume");
    std::fs::create_dir(&retained).unwrap();
    std::fs::write(retained.join("keep.txt"), "retained data\n").unwrap();
    let spec = crate::sandbox::SandboxSpec {
        mounts: vec![crate::sandbox::MountSpec {
            host: retained.clone(),
            guest: PathBuf::from("/data"),
            read_only: false,
        }],
        ..Default::default()
    };
    let session = crate::sandbox::SandboxSession::create_for_durable_launch(
        spec.clone(),
        session_id.clone(),
        true,
        "runtime-construction-committed".into(),
        fixture.path.clone(),
    )
    .await
    .unwrap();
    let pid = construction_mcp_marker(&backend.marker()).await;
    let cidfile = backend.cidfile();
    let mut snapshot = construction_snapshot();
    snapshot.session_id = session_id.clone();
    snapshot.sandbox_spec = Some(spec.clone());
    snapshot.messages = vec![crate::types::Message::User {
        content: "retained transcript".into(),
    }];
    fixture.store.create_session(snapshot).await.unwrap();
    let durable_row = || {
        let connection = rusqlite::Connection::open(&fixture.path).unwrap();
        let mut query = connection
            .prepare("SELECT * FROM sessions WHERE session_id = ?1")
            .unwrap();
        let columns = query.column_count();
        query
            .query_row([&session_id], |row| {
                (0..columns)
                    .map(|column| row.get::<_, rusqlite::types::Value>(column))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap()
    };
    let before = durable_row();
    session.retain_for_durable_session();
    assert!(
        !cidfile.parent().unwrap().exists(),
        "the committed row owns cleanup now"
    );
    drop(session);
    std::fs::write(backend.root.join("existing-container"), "").unwrap();
    let resumed = crate::sandbox::SandboxSession::create_for_durable_resume(
        spec,
        session_id.clone(),
        "runtime-construction-resumed".into(),
    )
    .await
    .unwrap();
    drop(resumed);
    construction_mcp_gone(pid).await;
    assert_eq!(
        std::fs::read_to_string(backend.root.join("backend-events")).unwrap(),
        "created\n",
        "borrowed/committed attachments must neither create again nor remove the existing container"
    );
    assert!(!backend.root.join("removed-arguments").exists());
    assert_eq!(
        durable_row(),
        before,
        "session identity, transcript and persisted backend must remain unchanged"
    );
    assert_eq!(
        std::fs::read_to_string(retained.join("keep.txt")).unwrap(),
        "retained data\n"
    );
    drop(backend);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_construction_backend_lost_session_commit_reply_preserves_durable_owner() {
    use crate::store::coordinator::PersistenceCommand;
    struct GatedCreation {
        snapshot: crate::sessions::SessionSnapshot,
        committed: std::sync::mpsc::SyncSender<()>,
        release: std::sync::mpsc::Receiver<()>,
    }
    impl PersistenceCommand for GatedCreation {
        type Output = anyhow::Result<()>;
        fn correlation(&self) -> crate::telemetry::Correlation {
            crate::telemetry::Correlation::default()
        }
        fn outcome(output: &Self::Output) -> crate::telemetry::TelemetryOutcome {
            if output.is_ok() {
                crate::telemetry::TelemetryOutcome::Ok
            } else {
                crate::telemetry::TelemetryOutcome::Error
            }
        }
        fn error_identity(_output: &Self::Output) -> Option<crate::telemetry::StoreErrorIdentity> {
            None
        }
        fn execute(self, path: &std::path::Path) -> anyhow::Result<Self::Output> {
            let mut connection = crate::store::open_connection(path)?;
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            crate::sessions::insert_new_session_in_transaction(&transaction, path, &self.snapshot)?;
            transaction.commit()?;
            self.committed.send(())?;
            self.release.recv()?;
            Ok(Ok(()))
        }
    }
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let backend = BlockedBackend::new(&fixture);
    backend.release();
    let session_id = Uuid::new_v4().to_string();
    let session = crate::sandbox::SandboxSession::create_for_durable_launch(
        crate::sandbox::SandboxSpec::default(),
        session_id.clone(),
        true,
        "runtime-construction-lost-commit".into(),
        fixture.path.clone(),
    )
    .await
    .unwrap();
    let pid = construction_mcp_marker(&backend.marker()).await;
    let cidfile = backend.cidfile();
    let mut snapshot = construction_snapshot();
    snapshot.session_id = session_id.clone();
    snapshot.messages = vec![crate::types::Message::User {
        content: "committed before lost reply".into(),
    }];
    let repo = TestRepo::new("runtime-construction-lost-commit-worktree");
    repo.commit_file("retained.txt", "original checkout\n");
    let fork = crate::sandbox::session_worktree::fork(&repo.root, &session_id)
        .unwrap()
        .unwrap();
    std::fs::write(
        fork.worktree.path.join("retained-in-fork.txt"),
        "durable fork data\n",
    )
    .unwrap();
    snapshot.sandbox_spec = Some(crate::sandbox::SandboxSpec {
        worktree: Some(fork.worktree.clone()),
        ..Default::default()
    });
    let mut rollback =
        crate::sandbox::session_worktree::RollbackGuard::new(Some(fork.worktree.clone()));
    rollback.preserve_pending_commit();
    let (committed_tx, committed_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    let pending = fixture
        .store
        .submit(GatedCreation {
            snapshot,
            committed: committed_tx,
            release: release_rx,
        })
        .unwrap();
    tokio::task::spawn_blocking(move || committed_rx.recv().unwrap())
        .await
        .unwrap();
    // Drop the real acknowledgement only after the actual transaction commits.
    drop(pending);
    release_tx.send(()).unwrap();
    rollback
        .settle_failed_commit(&fixture.path, &session_id)
        .await
        .unwrap();
    drop(rollback);
    assert_eq!(
        std::fs::read_to_string(fork.worktree.path.join("retained-in-fork.txt")).unwrap(),
        "durable fork data\n",
        "lost delivery cannot authorize destruction of the committed worktree"
    );
    // This is still a provisional in-memory attachment; no retain call was
    // delivered. The actual committed row, not that missing reply, owns it.
    session.disable_drop_cleanup();
    session.destroy().await.unwrap();
    drop(session);
    construction_mcp_gone(pid).await;
    assert!(!cidfile.parent().unwrap().exists());
    assert!(!backend.root.join("removed-arguments").exists());
    assert_eq!(fixture.store.stats().acknowledgements_lost, 1);
    let retained = fixture.store.load_session(session_id).await.unwrap();
    assert_eq!(
        serde_json::to_value(retained.messages).unwrap(),
        serde_json::json!([{"role": "user", "content": "committed before lost reply"}])
    );
    assert_eq!(
        std::fs::read_to_string(backend.root.join("backend-events")).unwrap(),
        "created\n"
    );
    // Dispose of this exact fixture only after checking durable preservation.
    crate::sandbox::session_worktree::rollback(&fork.worktree);
    drop(backend);
    fixture.finish().await;
}
