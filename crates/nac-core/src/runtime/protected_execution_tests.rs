use super::*;
use crate::runtime::protected_execution_resources::{
    CompartmentResourceDeclaration, HostAdmission, ScopeLimits,
};
use std::{collections::BTreeMap, path::PathBuf, sync::atomic::AtomicUsize, time::Duration};

fn admission() -> BoundaryAdmission {
    // Explicit fixture policy only, never a production resource default.
    let limits = ScopeLimits {
        endpoints: 2,
        live_jobs: 2,
        native_payload_bytes: 8192,
        captured_results: 8,
        captured_bytes: 16384,
    };
    let host = HostAdmission::new(limits, std::num::NonZeroUsize::new(1).unwrap());
    let session = host.session(limits).unwrap();
    let one = std::num::NonZeroUsize::new(1).unwrap();
    let (admission, _storage) = session
        .reserve_endpoint(CompartmentResourceDeclaration::from_raw_capacity(
            one, one, one, 0, 0, one,
        ))
        .unwrap()
        .begin();
    admission
}

#[cfg(target_os = "linux")]
#[path = "protected_execution_peer_tests.rs"]
mod actual_peer;

#[cfg(unix)]
#[path = "protected_execution_pair_tests.rs"]
mod paired_resource_controls;

#[path = "protected_execution_wait_tests.rs"]
mod wait_controls;

#[path = "protected_execution_cancellation_tests.rs"]
mod cancellation_controls;

#[path = "protected_execution_process_tests.rs"]
mod process_cleanup_controls;

#[path = "protected_execution_file_tests.rs"]
mod file_capture_controls;

#[path = "protected_execution_admission_tests.rs"]
mod aggregate_controls;

fn identity() -> ProtectedExecutionIdentity {
    ProtectedExecutionIdentity {
        runtime_id: Uuid::new_v4(),
        runtime_generation: 1,
        execution_owner_id: Uuid::new_v4(),
        process_generation: 1,
        trusted_key_owner_id: Uuid::new_v4(),
        key_generation: 1,
    }
}
fn backend() -> Arc<ExecutionBackend> {
    Arc::new(ExecutionBackend::Local {
        workspace_cwd: std::env::temp_dir(),
    })
}
fn command() -> CompartmentCommand {
    CompartmentCommand {
        program: PathBuf::from("not-a-host-command"),
        args: vec![],
        cwd: std::env::temp_dir(),
        environment: BTreeMap::new(),
        stdin: None,
        stdout_limit: 1024,
        stderr_limit: 1024,
    }
}
struct Effect(Arc<AtomicBool>);
impl ConsumedEffectResources for Effect {
    fn check_current(&self) -> Result<()> {
        if self.0.load(Ordering::Acquire) {
            bail!("test effect unavailable");
        }
        Ok(())
    }
    fn poison(&self) {
        self.0.store(true, Ordering::Release);
    }
}
fn permit(
    selected: &Arc<ExecutionBackend>,
    scope: ProtectedExecutionIdentity,
    operation: PreparedOperation,
) -> ProtectedExecutionPermit {
    ProtectedExecutionPermit {
        selected_backend: Arc::clone(selected),
        identity: scope,
        deadline: Instant::now() + Duration::from_secs(10),
        operation: Some(operation),
        resources: Box::new(Effect(Arc::new(AtomicBool::new(false)))),
    }
}
struct TestResources {
    denied: Arc<AtomicBool>,
    deadline: Instant,
}
impl VerifiedBoundaryResources for TestResources {
    fn check_current(&self) -> Result<()> {
        if self.denied.load(Ordering::Acquire) {
            bail!("synthetic test owner unavailable");
        }
        Ok(())
    }
    fn original_deadline(&self) -> Instant {
        self.deadline
    }
    fn poison(&self) {
        self.denied.store(true, Ordering::Release);
    }
}
struct TestTransport {
    calls: Arc<AtomicUsize>,
}
impl TestTransport {
    fn output(&self) -> CompartmentOutput {
        self.calls.fetch_add(1, Ordering::AcqRel);
        CompartmentOutput {
            exit: CompartmentExit {
                code: Some(0),
                signal: None,
            },
            stdout: b"target-only".to_vec(),
            stderr: vec![],
            stdout_truncated: false,
            stderr_truncated: false,
        }
    }
}
impl ExecutionCompartmentTransport for TestTransport {
    fn execute(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { Ok(self.output()) })
    }
    fn spawn_pipe(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        Box::pin(async {
            self.calls.fetch_add(1, Ordering::AcqRel);
            bail!("synthetic pipe not installed")
        })
    }
    fn spawn_pty(
        &self,
        _: CompartmentCommand,
        _: CompartmentPtySize,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        Box::pin(async {
            self.calls.fetch_add(1, Ordering::AcqRel);
            bail!("synthetic PTY not installed")
        })
    }
    fn native_file_io(
        &self,
        _: CompartmentFileIoCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { Ok(self.output()) })
    }
    fn close_and_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}
fn test_boundary(
    selected: &Arc<ExecutionBackend>,
    scope: ProtectedExecutionIdentity,
) -> (
    ProtectedExecutionBoundary,
    Arc<AtomicBool>,
    Arc<AtomicUsize>,
) {
    // Unit-only synthetic resource owner; never image/peer/probe qualification.
    let denied = Arc::new(AtomicBool::new(false));
    let calls = Arc::new(AtomicUsize::new(0));
    let boundary = ProtectedExecutionBoundary::from_parts(
        Arc::clone(selected),
        scope,
        Box::new(TestResources {
            denied: Arc::clone(&denied),
            deadline: Instant::now() + Duration::from_secs(10),
        }),
        Box::new(TestTransport {
            calls: Arc::clone(&calls),
        }),
        BoundaryPeer::Synthetic,
        admission(),
    )
    .unwrap();
    (boundary, denied, calls)
}

#[test]
fn protected_prepare_activation_and_effect_reject_unqualified_legacy_local() {
    let context = ProtectedExecutionContext::unqualified(backend(), identity());
    for stage in [
        ProtectedExecutionStage::Prepare,
        ProtectedExecutionStage::Activate,
        ProtectedExecutionStage::Effect,
    ] {
        assert!(context.check_stage(stage).is_err());
    }
}

#[tokio::test]
async fn all_protected_dispatch_shapes_deny_without_boundary_before_host_effects() {
    let selected = backend();
    let scope = identity();
    let c = ProtectedExecutionContext::unqualified(Arc::clone(&selected), scope);
    assert!(c
        .execute(permit(
            &selected,
            scope,
            PreparedOperation::Execute(command())
        ))
        .await
        .is_err());
    assert!(c
        .spawn_pipe(permit(&selected, scope, PreparedOperation::Pipe(command())))
        .await
        .is_err());
    assert!(c
        .spawn_pty(permit(
            &selected,
            scope,
            PreparedOperation::Pty(command(), CompartmentPtySize { cols: 80, rows: 24 })
        ))
        .await
        .is_err());
    assert!(c
        .native_file_io(permit(
            &selected,
            scope,
            PreparedOperation::FileIo(CompartmentFileIoCommand::from_prepared(command()))
        ))
        .await
        .is_err());
}

#[tokio::test]
async fn same_label_different_backend_object_cannot_rebind_private_owner() {
    let selected = backend();
    let scope = identity();
    let (boundary, denied, calls) = test_boundary(&selected, scope);
    assert!(ProtectedExecutionContext::from_boundary(backend(), scope, boundary).is_err());
    assert!(denied.load(Ordering::Acquire));
    assert_eq!(calls.load(Ordering::Acquire), 0);
}

#[tokio::test]
async fn wrong_runtime_key_or_process_generation_cannot_rebind_or_dispatch() {
    for change in 0..6 {
        let selected = backend();
        let scope = identity();
        let (boundary, denied, calls) = test_boundary(&selected, scope);
        let c = ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary)
            .unwrap();
        let mut wrong = scope;
        match change {
            0 => wrong.runtime_id = Uuid::new_v4(),
            1 => wrong.runtime_generation += 1,
            2 => wrong.execution_owner_id = Uuid::new_v4(),
            3 => wrong.process_generation += 1,
            4 => wrong.key_generation += 1,
            _ => wrong.trusted_key_owner_id = Uuid::new_v4(),
        }
        assert!(c
            .execute(permit(
                &selected,
                wrong,
                PreparedOperation::Execute(command())
            ))
            .await
            .is_err());
        assert!(denied.load(Ordering::Acquire));
        assert_eq!(calls.load(Ordering::Acquire), 0);
    }
}

#[tokio::test]
async fn wrong_operation_kind_or_expired_permit_denies_before_dispatch() {
    for expired in [false, true] {
        let selected = backend();
        let scope = identity();
        let (boundary, denied, calls) = test_boundary(&selected, scope);
        let c = ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary)
            .unwrap();
        let mut p = permit(
            &selected,
            scope,
            if expired {
                PreparedOperation::Execute(command())
            } else {
                PreparedOperation::Pipe(command())
            },
        );
        if expired {
            p.deadline = Instant::now() - Duration::from_millis(1);
        }
        assert!(c.execute(p).await.is_err());
        assert!(denied.load(Ordering::Acquire));
        assert_eq!(calls.load(Ordering::Acquire), 0);
    }
}

#[tokio::test]
async fn revoked_then_restored_resources_do_not_revive_boundary() {
    let selected = backend();
    let scope = identity();
    let (boundary, denied, calls) = test_boundary(&selected, scope);
    let c =
        ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary).unwrap();
    denied.store(true, Ordering::Release);
    assert!(c.check_stage(ProtectedExecutionStage::Activate).is_err());
    denied.store(false, Ordering::Release);
    assert!(c
        .execute(permit(
            &selected,
            scope,
            PreparedOperation::Execute(command())
        ))
        .await
        .is_err());
    assert_eq!(calls.load(Ordering::Acquire), 0);
}

#[tokio::test]
async fn synthetic_unit_resource_routes_only_its_captured_target_payload() {
    let selected = backend();
    let scope = identity();
    let (boundary, _denied, calls) = test_boundary(&selected, scope);
    let c =
        ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary).unwrap();
    let out = c
        .execute(permit(
            &selected,
            scope,
            PreparedOperation::Execute(command()),
        ))
        .await
        .unwrap();
    assert_eq!(out.stdout(), b"target-only");
    assert_eq!(calls.load(Ordering::Acquire), 1);
}

#[tokio::test]
async fn standalone_local_canary_baseline_remains_owner_wide() {
    let root = std::env::temp_dir().join(format!("nac-boundary-baseline-{}", Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let canary = root.join("synthetic-private-canary");
    std::fs::write(&canary, b"synthetic-owner-readable").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&canary, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let output = backend()
        .exec("cat", &[canary.to_str().unwrap().into()], None)
        .await
        .unwrap();
    assert_eq!(output.stdout, b"synthetic-owner-readable");
    std::fs::remove_dir_all(root).unwrap();
    // This is expected legacy behavior, not protected Linux qualification.
}

struct PendingTransport(Arc<tokio::sync::Notify>);
impl ExecutionCompartmentTransport for PendingTransport {
    fn execute(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async {
            self.0.notify_one();
            std::future::pending().await
        })
    }
    fn spawn_pipe(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        Box::pin(async {
            self.0.notify_one();
            std::future::pending().await
        })
    }
    fn spawn_pty(
        &self,
        _: CompartmentCommand,
        _: CompartmentPtySize,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        Box::pin(async {
            self.0.notify_one();
            std::future::pending().await
        })
    }
    fn native_file_io(
        &self,
        _: CompartmentFileIoCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async {
            self.0.notify_one();
            std::future::pending().await
        })
    }
    fn close_and_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::test]
async fn cancelled_dispatch_future_permanently_poisons_boundary() {
    for shape in 0..4 {
        let selected = backend();
        let scope = identity();
        let denied = Arc::new(AtomicBool::new(false));
        let started = Arc::new(tokio::sync::Notify::new());
        let boundary = ProtectedExecutionBoundary::from_parts(
            Arc::clone(&selected),
            scope,
            Box::new(TestResources {
                denied: Arc::clone(&denied),
                deadline: Instant::now() + Duration::from_secs(10),
            }),
            Box::new(PendingTransport(Arc::clone(&started))),
            BoundaryPeer::Synthetic,
            admission(),
        )
        .unwrap();
        let c = ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary)
            .unwrap();
        let mut future = Box::pin(async {
            match shape {
                0 => {
                    c.execute(permit(
                        &selected,
                        scope,
                        PreparedOperation::Execute(command()),
                    ))
                    .await?;
                }
                1 => {
                    c.spawn_pipe(permit(&selected, scope, PreparedOperation::Pipe(command())))
                        .await?;
                }
                2 => {
                    c.spawn_pty(permit(
                        &selected,
                        scope,
                        PreparedOperation::Pty(
                            command(),
                            CompartmentPtySize { cols: 80, rows: 24 },
                        ),
                    ))
                    .await?;
                }
                _ => {
                    c.native_file_io(permit(
                        &selected,
                        scope,
                        PreparedOperation::FileIo(CompartmentFileIoCommand::from_prepared(
                            command(),
                        )),
                    ))
                    .await?;
                }
            }
            Ok::<(), anyhow::Error>(())
        });
        tokio::select! { _=started.notified()=>{}, _=&mut future=>panic!("dispatch unexpectedly completed") }
        drop(future);
        assert!(denied.load(Ordering::Acquire));
        assert!(c.check_stage(ProtectedExecutionStage::Effect).is_err());
    }
}

#[test]
fn dropping_context_invalidates_retained_owner() {
    let selected = backend();
    let scope = identity();
    let (boundary, denied, _) = test_boundary(&selected, scope);
    let retained = Arc::clone(&boundary.state);
    let context =
        ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary).unwrap();
    drop(context);
    assert!(denied.load(Ordering::Acquire));
    assert!(retained.check(&selected, scope).is_err());
}
