use super::*;
use crate::store::{self, ManagedRuntimeOperationIdentity, RuntimeLeaseReservationOutcome};
use std::path::PathBuf;
use uuid::Uuid;

#[cfg(unix)]
#[path = "construction_backend_tests.rs"]
mod construction_backend_tests;

#[path = "resume_admission_tests.rs"]
mod resume_admission_tests;

#[path = "run_admission_tests.rs"]
mod run_admission_tests;

#[path = "run_input_admission_tests.rs"]
mod run_input_admission_tests;

#[path = "lost_start_recovery_tests.rs"]
mod lost_start_recovery_tests;

struct Fixture {
    path: PathBuf,
    store: Arc<StoreCoordinator>,
}
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir()
            .join(format!("nac-runtime-live-{}", Uuid::new_v4()))
            .join("store.db");
        store::initialize(&path).unwrap();
        let store = StoreCoordinator::acquire(&path).unwrap();
        Self { path, store }
    }
    async fn active(&self, lifetime_ms: i64) -> ActiveRuntimeLease {
        self.active_with_original_lifetime(lifetime_ms, 30_000)
            .await
    }
    async fn active_with_original_lifetime(
        &self,
        lifetime_ms: i64,
        original_ms: i64,
    ) -> ActiveRuntimeLease {
        let clock = native_clock().unwrap();
        let original_expires_ms = clock.wall_ms() + original_ms;
        let binding = RuntimeLeaseBinding {
            identity: ManagedRuntimeOperationIdentity {
                operation_id: Uuid::new_v4(),
                full_input_sha256: [7; 32],
            },
            assignment_sha256: [8; 32],
            serving_lifetime_id: Uuid::new_v4(),
            original_expires_ms,
        };
        let RuntimeLeaseReservationOutcome::Fresh(fresh) = self
            .store
            .reserve_managed_runtime_lease(binding, clock)
            .await
            .unwrap()
        else {
            panic!("fixture operation must be new")
        };
        let challenge = RuntimeChallengeSpec {
            channel_id: Uuid::new_v4(),
            challenge_sha256: [9; 32],
            expires_ms: (clock.wall_ms() + 5_000).min(original_expires_ms),
        };
        let pending = self
            .store
            .challenge_managed_runtime_initial(fresh, challenge.clone(), native_clock().unwrap())
            .await
            .unwrap();
        let clock = native_clock().unwrap();
        let response = RuntimeLeaseResponse {
            channel_id: challenge.channel_id,
            challenge_sha256: challenge.challenge_sha256,
            lease: RuntimeLeaseSnapshot {
                lease_id: Uuid::new_v4(),
                sequence: 1,
                expires_ms: (clock.wall_ms() + lifetime_ms).min(original_expires_ms),
            },
            observed_ms: clock.wall_ms(),
        };
        self.store
            .consume_managed_runtime_challenge(pending, response, clock)
            .await
            .unwrap()
    }
    async fn guard(&self, lifetime_ms: i64) -> Arc<ManagedRuntimeLeaseGuard> {
        ManagedRuntimeLeaseGuard::new(Arc::clone(&self.store), self.active(lifetime_ms).await)
            .await
            .unwrap()
    }
    async fn native(&self, guard: &ManagedRuntimeLeaseGuard) -> ManagedRuntimeObservation {
        let native = ManagedRuntimeObservation::Run {
            session_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
        };
        self.store
            .acknowledge_managed_runtime_operation(
                guard.binding().unwrap().identity,
                native.clone(),
            )
            .await
            .unwrap();
        native
    }
    async fn renewal(
        &self,
        guard: &ManagedRuntimeLeaseGuard,
    ) -> (PendingRuntimeChallenge, RuntimeLeaseResponse) {
        let native = self.native(guard).await;
        let clock = native_clock().unwrap();
        let old = guard.snapshot().unwrap();
        let challenge = RuntimeChallengeSpec {
            channel_id: Uuid::new_v4(),
            challenge_sha256: [10; 32],
            expires_ms: (clock.wall_ms() + 1_000).min(old.expires_ms),
        };
        let pending = guard
            .challenge_renewal(native, challenge.clone())
            .await
            .unwrap();
        let clock = native_clock().unwrap();
        let response = RuntimeLeaseResponse {
            channel_id: challenge.channel_id,
            challenge_sha256: challenge.challenge_sha256,
            lease: RuntimeLeaseSnapshot {
                lease_id: old.lease_id,
                sequence: old.sequence + 1,
                expires_ms: clock.wall_ms() + 20_000,
            },
            observed_ms: clock.wall_ms(),
        };
        (pending, response)
    }
    fn row(&self, guard: &ManagedRuntimeLeaseGuard) -> (String, i64) {
        rusqlite::Connection::open(&self.path)
            .unwrap()
            .query_row(
                "SELECT phase, lease_sequence FROM managed_runtime_leases WHERE operation_id = ?1",
                [guard.binding().unwrap().identity.operation_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
    }
    async fn finish(&self) {
        self.store.shutdown().await.unwrap();
        std::fs::remove_dir_all(self.path.parent().unwrap()).unwrap();
    }
}

struct ConstructionHome(Option<std::ffi::OsString>);
impl ConstructionHome {
    fn new(fixture: &Fixture) -> Self {
        let previous = std::env::var_os("NAC_HOME");
        unsafe { std::env::set_var("NAC_HOME", fixture.path.parent().unwrap()) };
        Self(previous)
    }
}
impl Drop for ConstructionHome {
    fn drop(&mut self) {
        unsafe {
            if let Some(previous) = self.0.take() {
                std::env::set_var("NAC_HOME", previous);
            } else {
                std::env::remove_var("NAC_HOME");
            }
        }
    }
}
fn construction_options(fixture: &Fixture) -> crate::runtime::RunOptions {
    let cwd = fixture.path.parent().unwrap().to_path_buf();
    let key = cwd.join("synthetic-construction-key");
    std::fs::write(&key, "synthetic-public-test-key").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    crate::runtime::RunOptions {
        workspace_cwd: cwd.clone(),
        config_cwd: Some(cwd),
        store: crate::runtime::StoreOptions {
            store_path: Some(fixture.path.clone()),
        },
        model: crate::runtime::ModelOptions {
            backend: Some(crate::model::BackendKind::OpenAiResponses),
            api_model: Some("gpt-5-mini".into()),
            api_base_url: Some("https://api.openai.com/v1".into()),
            api_key_env: crate::runtime::OptionalModelOption::Clear,
            trusted_api_key_file: Some(key),
            ..Default::default()
        },
        ..Default::default()
    }
}
fn construction_snapshot() -> crate::sessions::SessionSnapshot {
    crate::sessions::new_snapshot(
        Uuid::new_v4().to_string(),
        PathBuf::from("/fixture"),
        "gpt-5-mini".into(),
        "https://api.openai.com/v1".into(),
        crate::model::BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        None,
        std::collections::BTreeMap::new(),
    )
}

#[tokio::test]
async fn runtime_construction_missing_closed_or_wrong_store_denies_before_model_resolution() {
    let fixture = Fixture::new();
    let guard = fixture.guard(10_000).await;
    let options = || crate::runtime::RunOptions {
        workspace_cwd: fixture.path.parent().unwrap().to_path_buf(),
        store: crate::runtime::StoreOptions {
            store_path: Some(fixture.path.clone()),
        },
        // Deliberately invalid settings must not be examined on denied admission.
        ..Default::default()
    };
    for selected in [None, {
        guard.deny_now();
        Some(guard.clone())
    }] {
        let error = crate::runtime::build_run_config_for_runtime_operation(
            options(),
            &crate::runtime::NacConfig::default(),
            None,
            crate::sessions::SessionBehavior::Direct,
            selected,
        )
        .await
        .err()
        .unwrap();
        assert!(error.to_string().contains("runtime"), "{error:#}");
    }
    let other = Fixture::new();
    let live = other.guard(10_000).await;
    assert!(crate::runtime::build_run_config_for_runtime_operation(
        options(),
        &crate::runtime::NacConfig::default(),
        None,
        crate::sessions::SessionBehavior::Direct,
        Some(live.clone()),
    )
    .await
    .is_err());
    assert!(
        live.check_now().is_ok(),
        "wrong-store caller cannot revoke another operation"
    );
    assert!(fixture.store.list_sessions().await.unwrap().is_empty());
    other.finish().await;
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_construction_actual_positive_pins_required_clients_and_cannot_repeat() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let guard = fixture.guard(20_000).await;
    let options = construction_options(&fixture);
    let configured = crate::runtime::build_run_config_for_runtime_operation(
        options.clone(),
        &crate::runtime::NacConfig::default(),
        None,
        crate::sessions::SessionBehavior::Direct,
        Some(guard.clone()),
    )
    .await
    .unwrap();
    assert!(configured.agent.requires_runtime_effects());
    assert!(
        configured
            .client
            .send_turn(Vec::new(), Vec::new())
            .await
            .is_err(),
        "captured client must reject its legacy unleased API before provider I/O"
    );
    assert_eq!(fixture.store.list_sessions().await.unwrap().len(), 1);
    assert!(crate::runtime::build_run_config_for_runtime_operation(
        options,
        &crate::runtime::NacConfig::default(),
        None,
        crate::sessions::SessionBehavior::Direct,
        Some(guard.clone()),
    )
    .await
    .is_err());
    assert!(
        guard.check_now().is_ok(),
        "duplicate construction is observational, not revocation"
    );
    let parts = crate::session_service::SessionService::from_orchestrator_run_config(configured);
    assert!(parts
        .service
        .try_submit_prompt("no fresh admission".into())
        .is_err());
    assert!(parts.service.active_operation().is_none());
    drop(parts);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_construction_queued_create_rechecks_the_actual_owner_after_expiry() {
    let fixture = Fixture::new();
    let guard = fixture.guard(700).await;
    guard.check().await.unwrap();
    let (release, blocked) = block(&fixture.store).await;
    let selected = guard.clone();
    let admission: Arc<crate::sessions::SessionCreationCheck> =
        Arc::new(move || selected.check_now());
    let owner = fixture.store.clone();
    let create = tokio::spawn(async move {
        owner
            .create_admitted_session(construction_snapshot(), admission)
            .await
    });
    queued(&fixture.store, 1).await;
    tokio::time::timeout(Duration::from_secs(2), guard.wait_for_denial())
        .await
        .unwrap();
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    assert!(create.await.unwrap().is_err());
    assert!(fixture.store.list_sessions().await.unwrap().is_empty());
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_construction_final_check_rolls_back_an_insert_on_native_close() {
    let fixture = Fixture::new();
    let guard = fixture.guard(10_000).await;
    guard.check().await.unwrap();
    let selected = guard.clone();
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let observed = calls.clone();
    let admission: Arc<crate::sessions::SessionCreationCheck> = Arc::new(move || {
        if observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 1 {
            selected.deny_now();
        }
        selected.check_now()
    });
    assert!(fixture
        .store
        .create_admitted_session(construction_snapshot(), admission)
        .await
        .is_err());
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
    assert!(fixture.store.list_sessions().await.unwrap().is_empty());
    fixture.finish().await;
}

#[cfg(unix)]
async fn construction_mcp_marker(path: &std::path::Path) -> i32 {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(path) {
                if let Ok(pid) = pid.parse::<i32>() {
                    return pid;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}
#[cfg(unix)]
async fn construction_mcp_gone(pid: i32) {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if unsafe { libc::kill(pid, 0) } != 0 {
                assert_eq!(
                    std::io::Error::last_os_error().raw_os_error(),
                    Some(libc::ESRCH)
                );
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
#[cfg(unix)]
fn blocked_construction_mcp(fixture: &Fixture) -> PathBuf {
    let root = fixture.path.parent().unwrap();
    let pid = root.join("owned-mcp-pid");
    // UUID fixture paths contain no shell metacharacters. The fixture records
    // its actual PID and execs one silent child, with no descendant or secret.
    let script = format!("printf %s $$ > '{}'; exec sleep 30", pid.display());
    std::fs::write(root.join("config.toml"), format!(
        "[mcp_servers.blocked]\ntransport = \"stdio\"\ncommand = \"/bin/sh\"\nargs = [\"-c\", {}]\nrequired = true\nstartup_timeout_ms = 10000\n",
        serde_json::to_string(&script).unwrap(),
    )).unwrap();
    pid
}

#[cfg(unix)]
#[tokio::test]
async fn runtime_construction_expiry_interrupts_actual_silent_mcp_startup_and_reaps_it() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let options = construction_options(&fixture);
    let marker = blocked_construction_mcp(&fixture);
    let guard = fixture.guard(1_500).await;
    let selected = guard.clone();
    let started = std::time::Instant::now();
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
    let pid = construction_mcp_marker(&marker).await;
    assert!(tokio::time::timeout(Duration::from_secs(3), building)
        .await
        .unwrap()
        .unwrap()
        .is_err());
    assert!(started.elapsed() < Duration::from_secs(4));
    construction_mcp_gone(pid).await;
    assert!(fixture.store.list_sessions().await.unwrap().is_empty());
    assert!(guard.check_now().is_err());
    fixture.finish().await;
}

#[cfg(unix)]
#[tokio::test]
async fn runtime_construction_cancelled_caller_closes_actual_mcp_without_replaying() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let options = construction_options(&fixture);
    let marker = blocked_construction_mcp(&fixture);
    let denied = crate::runtime::build_run_config_for_runtime_operation(
        options.clone(),
        &crate::runtime::NacConfig::default(),
        None,
        crate::sessions::SessionBehavior::Direct,
        None,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(
        denied.to_string(),
        "runtime construction admission required"
    );
    assert!(
        !marker.exists(),
        "required None must launch zero configured MCP subprocesses"
    );
    let guard = fixture.guard(20_000).await;
    let selected = guard.clone();
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
    let pid = construction_mcp_marker(&marker).await;
    building.abort();
    assert!(building.await.err().unwrap().is_cancelled());
    assert!(
        guard.check_now().is_err(),
        "caller Drop must synchronously close the original operation"
    );
    construction_mcp_gone(pid).await;
    assert!(fixture.store.list_sessions().await.unwrap().is_empty());
    // No scope can be reconstructed from an uncertain retained row or failed
    // construction; the same UUID remains observational after task cancellation.
    assert!(matches!(
        fixture
            .store
            .reserve_managed_runtime_lease(guard.binding().unwrap(), native_clock().unwrap())
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    fixture.finish().await;
}

struct Block {
    entered: std::sync::mpsc::SyncSender<()>,
    release: std::sync::mpsc::Receiver<()>,
}
impl crate::store::coordinator::PersistenceCommand for Block {
    type Output = ();
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::default()
    }
    fn execute(self, _: &std::path::Path) -> Result<()> {
        self.entered.send(())?;
        self.release.recv()?;
        Ok(())
    }
}
async fn block(
    store: &StoreCoordinator,
) -> (
    std::sync::mpsc::SyncSender<()>,
    crate::store::coordinator::PendingPersistence<()>,
) {
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    let pending = store
        .submit(Block {
            entered: entered_tx,
            release: release_rx,
        })
        .unwrap();
    tokio::task::spawn_blocking(move || entered_rx.recv().unwrap())
        .await
        .unwrap();
    (release_tx, pending)
}
async fn queued(store: &StoreCoordinator, count: usize) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while store.stats().queued < count {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn actual_native_clocks_expire_the_shared_port_and_cannot_reconstruct_after_restart() {
    let fixture = Fixture::new();
    let guard = fixture.guard(1_000).await;
    let port: super::super::RuntimeEffectLeaseHandle =
        Arc::<ManagedRuntimeLeaseGuard>::clone(&guard);
    assert!(port.check_current().await.is_ok());
    assert!(port.check_available().is_ok());
    tokio::time::timeout(Duration::from_secs(3), port.wait_for_denial())
        .await
        .unwrap();
    assert!(port.check_available().is_err());
    guard.terminate().await.unwrap();
    assert_eq!(fixture.row(&guard).0, "terminal");
    let mut restarted = guard.binding().unwrap();
    restarted.serving_lifetime_id = Uuid::new_v4();
    assert!(matches!(
        fixture
            .store
            .reserve_managed_runtime_lease(restarted, native_clock().unwrap())
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    fixture.finish().await;
}

#[tokio::test]
async fn selected_store_substitution_denies_before_mutating_an_unrelated_store() {
    let fixture = Fixture::new();
    let other = Fixture::new();
    let active = fixture.active(5_000).await;
    let binding = active.binding().clone();
    assert!(
        ManagedRuntimeLeaseGuard::new(Arc::clone(&other.store), active)
            .await
            .is_err()
    );
    assert!(matches!(
        fixture
            .store
            .reserve_managed_runtime_lease(binding, native_clock().unwrap())
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    assert_eq!(
        rusqlite::Connection::open(&other.path)
            .unwrap()
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM managed_runtime_leases", [], |row| row
                .get(0))
            .unwrap(),
        0
    );
    fixture.finish().await;
    other.finish().await;
}

#[tokio::test]
async fn terminal_close_is_immediate_scoped_and_clock_rollback_cannot_revive() {
    let fixture = Fixture::new();
    let guard = fixture.guard(5_000).await;
    let other = fixture.guard(5_000).await;
    let clock = native_clock().unwrap();
    guard
        .check_at(RuntimeLeaseClock::fixed(
            clock.wall_ms() + 1,
            clock.monotonic(),
        ))
        .unwrap();
    assert!(guard
        .check_at(RuntimeLeaseClock::fixed(clock.wall_ms(), clock.monotonic()))
        .is_err());
    assert!(guard.check_now().is_err());
    guard.terminate().await.unwrap();
    assert!(other.check().await.is_ok());
    other.deny_now();
    assert!(other.check_now().is_err());
    other.terminate().await.unwrap();
    fixture.finish().await;
}

#[tokio::test]
async fn blocked_persistence_does_not_hold_a_lease_or_denial_observation_open_past_expiry() {
    let fixture = Fixture::new();
    let guard = fixture.guard(1_000).await;
    let (release, blocked) = block(&fixture.store).await;
    let checking = {
        let guard = Arc::clone(&guard);
        tokio::spawn(async move { guard.check().await })
    };
    queued(&fixture.store, 1).await;
    tokio::time::timeout(Duration::from_secs(3), guard.observe_denial())
        .await
        .unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(1), checking)
        .await
        .unwrap()
        .unwrap()
        .is_err());
    assert!(guard.check_now().is_err());
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    guard.terminate().await.unwrap();
    assert_eq!(fixture.row(&guard).0, "terminal");
    fixture.finish().await;
}

#[tokio::test]
async fn renewal_commit_and_live_publication_keep_concurrent_old_checks_from_revoking_it() {
    let fixture = Fixture::new();
    let guard = fixture.guard(10_000).await;
    let (pending, response) = fixture.renewal(&guard).await;
    let before = guard.snapshot().unwrap();
    let (release, blocked) = block(&fixture.store).await;
    let renewing = {
        let guard = Arc::clone(&guard);
        tokio::spawn(async move {
            guard
                .consume_renewal(pending, response, native_clock().unwrap())
                .await
        })
    };
    queued(&fixture.store, 1).await;
    let checking = {
        let guard = Arc::clone(&guard);
        tokio::spawn(async move { guard.check().await })
    };
    queued(&fixture.store, 2).await;
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    let renewed = renewing.await.unwrap().unwrap();
    assert_eq!(renewed.lease_id, before.lease_id);
    assert_eq!(renewed.sequence, 2);
    assert!(checking.await.unwrap().is_ok());
    assert!(guard.check().await.is_ok());
    assert_eq!(fixture.row(&guard), ("active".into(), 2));
    guard.terminate().await.unwrap();
    fixture.finish().await;
}

#[tokio::test]
async fn cancelled_renewal_before_execution_is_terminal_without_advancing() {
    let fixture = Fixture::new();
    let guard = fixture.guard(10_000).await;
    let (pending, response) = fixture.renewal(&guard).await;
    let (release, blocked) = block(&fixture.store).await;
    let renewing = {
        let guard = Arc::clone(&guard);
        tokio::spawn(async move {
            guard
                .consume_renewal(pending, response, native_clock().unwrap())
                .await
        })
    };
    queued(&fixture.store, 1).await;
    renewing.abort();
    assert!(renewing.await.unwrap_err().is_cancelled());
    assert!(guard.check_now().is_err());
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    guard.terminate().await.unwrap();
    assert_eq!(fixture.row(&guard), ("terminal".into(), 1));
    fixture.finish().await;
}

#[tokio::test]
async fn queued_native_renewal_after_old_deadline_cannot_consume_or_advance_its_lease() {
    let fixture = Fixture::new();
    let guard = fixture.guard(1_000).await;
    let (pending, response) = fixture.renewal(&guard).await;
    let (release, blocked) = block(&fixture.store).await;
    let renewing = {
        let guard = Arc::clone(&guard);
        tokio::spawn(async move {
            guard
                .consume_renewal(pending, response, native_clock().unwrap())
                .await
        })
    };
    queued(&fixture.store, 1).await;
    tokio::time::timeout(Duration::from_secs(3), guard.observe_denial())
        .await
        .unwrap();
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    assert!(renewing.await.unwrap().is_err());
    guard.terminate().await.unwrap();
    assert_eq!(fixture.row(&guard), ("terminal".into(), 1));
    fixture.finish().await;
}

#[tokio::test]
async fn lost_delivery_after_actual_renewal_commit_terminates_without_reconstructing_a_capability()
{
    let fixture = Fixture::new();
    let guard = fixture.guard(10_000).await;
    let (pending, response) = fixture.renewal(&guard).await;
    let (release, blocked) = block(&fixture.store).await;
    let completed = fixture.store.stats().completed;
    let mut renewing = Box::pin(guard.consume_renewal(pending, response, native_clock().unwrap()));
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    assert!(renewing.as_mut().poll(&mut context).is_pending());
    queued(&fixture.store, 1).await;
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        while fixture.store.stats().completed < completed + 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        fixture.row(&guard),
        ("active".into(), 2),
        "lease COMMIT precedes delivery loss"
    );
    drop(renewing);
    assert!(guard.check_now().is_err());
    guard.terminate().await.unwrap();
    assert_eq!(fixture.row(&guard), ("terminal".into(), 2));
    assert!(matches!(
        fixture
            .store
            .reserve_managed_runtime_lease(guard.binding().unwrap(), native_clock().unwrap())
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    fixture.finish().await;
}

#[tokio::test]
async fn expiry_observation_retains_both_clock_ceilings_and_cannot_revive_terminal_owner() {
    let fixture = Fixture::new();
    let guard = fixture.guard(1_000).await;
    let first = guard.observe_expiry().unwrap();
    assert_eq!(
        first.operation_id,
        guard.binding().unwrap().identity.operation_id
    );
    assert_eq!(
        first.serving_lifetime_id,
        guard.binding().unwrap().serving_lifetime_id
    );
    assert_eq!(first.lease, guard.snapshot().unwrap());
    assert!(first.remaining <= Duration::from_millis(1_000));
    assert!(
        first.remaining
            <= Duration::from_millis((first.lease.expires_ms - first.sampled_at_epoch_ms) as u64)
    );
    tokio::time::sleep(Duration::from_millis(10)).await;
    let later = guard.observe_expiry().unwrap();
    assert!(
        later.remaining < first.remaining,
        "reading observations never resets accepted monotonic ceiling"
    );
    guard.terminate().await.unwrap();
    assert!(guard.observe_expiry().is_err());
    assert!(guard.check_now().is_err());
    fixture.finish().await;
}
