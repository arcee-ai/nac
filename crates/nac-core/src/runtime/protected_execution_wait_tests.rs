//! Stalled RAW adapters must not extend admitted work. Synthetic owners here
//! characterize Core consumption only, never actual Root/runtime authority.
use super::*;

pub(super) async fn pending_dispatch(
    context: &ProtectedExecutionContext,
    selected: &Arc<ExecutionBackend>,
    scope: ProtectedExecutionIdentity,
    shape: usize,
    deadline: Instant,
) -> Result<()> {
    let operation = match shape {
        0 => PreparedOperation::Execute(command()),
        1 => PreparedOperation::Pipe(command()),
        2 => PreparedOperation::Pty(command(), CompartmentPtySize { cols: 80, rows: 24 }),
        _ => PreparedOperation::FileIo(CompartmentFileIoCommand::from_prepared(command())),
    };
    let mut effect = permit(selected, scope, operation);
    effect.deadline = deadline;
    match shape {
        0 => {
            context.execute(effect).await?;
        }
        1 => {
            context.spawn_pipe(effect).await?;
        }
        2 => {
            context.spawn_pty(effect).await?;
        }
        _ => {
            context.native_file_io(effect).await?;
        }
    }
    Ok(())
}

fn pending_context(
    selected: &Arc<ExecutionBackend>,
    scope: ProtectedExecutionIdentity,
    started: &Arc<tokio::sync::Notify>,
) -> (ProtectedExecutionContext, Arc<AtomicBool>) {
    let denied = Arc::new(AtomicBool::new(false));
    let boundary = ProtectedExecutionBoundary::from_parts(
        Arc::clone(selected),
        scope,
        Box::new(TestResources {
            denied: Arc::clone(&denied),
            deadline: Instant::now() + Duration::from_secs(10),
        }),
        Box::new(PendingTransport(Arc::clone(started))),
        BoundaryPeer::Synthetic,
        admission(),
    )
    .unwrap();
    (
        ProtectedExecutionContext::from_boundary(Arc::clone(selected), scope, boundary).unwrap(),
        denied,
    )
}

#[tokio::test]
async fn inflight_dispatch_cannot_outlive_consumed_permit_deadline() {
    for shape in 0..4 {
        let selected = backend();
        let scope = identity();
        let started = Arc::new(tokio::sync::Notify::new());
        let (context, denied) = pending_context(&selected, scope, &started);
        let mut future = Box::pin(pending_dispatch(
            &context,
            &selected,
            scope,
            shape,
            Instant::now() + Duration::from_millis(200),
        ));
        tokio::select! {
            _ = started.notified() => {},
            _ = &mut future => panic!("adapter did not enter its pending operation"),
        }
        let result = tokio::time::timeout(Duration::from_secs(2), future).await;
        assert!(
            matches!(result, Ok(Err(_))),
            "stalled shape {shape} survived its original permit cutoff"
        );
        assert!(denied.load(Ordering::Acquire));
        assert!(context
            .check_stage(ProtectedExecutionStage::Effect)
            .is_err());
    }
}

#[tokio::test]
async fn inflight_dispatch_observes_local_denial_without_adapter_response() {
    for shape in 0..4 {
        let selected = backend();
        let scope = identity();
        let started = Arc::new(tokio::sync::Notify::new());
        let (context, denied) = pending_context(&selected, scope, &started);
        let mut future = Box::pin(pending_dispatch(
            &context,
            &selected,
            scope,
            shape,
            Instant::now() + Duration::from_secs(10),
        ));
        tokio::select! {
            _ = started.notified() => {},
            _ = &mut future => panic!("adapter did not enter its pending operation"),
        }
        context.cancellation().unwrap().clone().cancel();
        let result = tokio::time::timeout(Duration::from_secs(1), future).await;
        assert!(
            matches!(result, Ok(Err(_))),
            "stalled shape {shape} ignored local denial"
        );
        assert!(denied.load(Ordering::Acquire));
    }
}

struct ChangingDeadline {
    cutoff: Arc<std::sync::Mutex<Instant>>,
    denied: Arc<AtomicBool>,
}
impl VerifiedBoundaryResources for ChangingDeadline {
    fn check_current(&self) -> Result<()> {
        if self.denied.load(Ordering::Acquire) {
            bail!("synthetic owner denied");
        }
        Ok(())
    }
    fn original_deadline(&self) -> Instant {
        *self.cutoff.lock().unwrap()
    }
    fn poison(&self) {
        self.denied.store(true, Ordering::Release);
    }
}

#[tokio::test]
async fn inflight_dispatch_cannot_renew_an_observed_shorter_source_cutoff() {
    let selected = backend();
    let scope = identity();
    let long = Instant::now() + Duration::from_secs(10);
    let cutoff = Arc::new(std::sync::Mutex::new(long));
    let denied = Arc::new(AtomicBool::new(false));
    let started = Arc::new(tokio::sync::Notify::new());
    let boundary = ProtectedExecutionBoundary::from_parts(
        Arc::clone(&selected),
        scope,
        Box::new(ChangingDeadline {
            cutoff: Arc::clone(&cutoff),
            denied: Arc::clone(&denied),
        }),
        Box::new(PendingTransport(Arc::clone(&started))),
        BoundaryPeer::Synthetic,
        admission(),
    )
    .unwrap();
    let context =
        ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary).unwrap();
    *cutoff.lock().unwrap() = Instant::now() + Duration::from_millis(200);
    context
        .check_stage(ProtectedExecutionStage::Prepare)
        .unwrap();
    // Later source observation cannot renew the cutoff already sampled by Core.
    *cutoff.lock().unwrap() = long;
    let mut pending = Box::pin(pending_dispatch(&context, &selected, scope, 0, long));
    tokio::select! { _ = started.notified() => {}, _ = &mut pending => panic!("adapter did not enter pending dispatch") }
    let result = tokio::time::timeout(Duration::from_secs(2), pending).await;
    assert!(
        matches!(result, Ok(Err(_))),
        "later source sample renewed the observed cutoff"
    );
    assert!(denied.load(Ordering::Acquire));
}

#[tokio::test]
async fn observed_shorter_source_cutoff_wakes_already_pending_dispatches() {
    for cleanup_observation in [false, true] {
        for shape in 0..4 {
            let selected = backend();
            let scope = identity();
            let long = Instant::now() + Duration::from_secs(10);
            let cutoff = Arc::new(std::sync::Mutex::new(long));
            let denied = Arc::new(AtomicBool::new(false));
            let started = Arc::new(tokio::sync::Notify::new());
            let boundary = ProtectedExecutionBoundary::from_parts(
                Arc::clone(&selected),
                scope,
                Box::new(ChangingDeadline {
                    cutoff: Arc::clone(&cutoff),
                    denied: Arc::clone(&denied),
                }),
                Box::new(PendingTransport(Arc::clone(&started))),
                BoundaryPeer::Synthetic,
                admission(),
            )
            .unwrap();
            let context =
                ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary)
                    .unwrap();
            let mut pending = Box::pin(pending_dispatch(&context, &selected, scope, shape, long));
            tokio::select! {
                _ = started.notified() => {},
                _ = &mut pending => panic!("adapter did not enter pending dispatch"),
            }
            // Another current or cleanup check observes a tighter deadline after
            // this dispatch registered its timer. Returning a later source
            // sample must not hide or renew that shared observation.
            *cutoff.lock().unwrap() = Instant::now() + Duration::from_millis(200);
            if cleanup_observation {
                context.state().unwrap().cleanup_deadline();
            } else {
                context
                    .check_stage(ProtectedExecutionStage::Prepare)
                    .unwrap();
            }
            *cutoff.lock().unwrap() = long;
            let result = tokio::time::timeout(Duration::from_secs(2), pending).await;
            assert!(
                matches!(result, Ok(Err(_))),
                "pending shape {shape} ignored tighter cutoff (cleanup={cleanup_observation})"
            );
            assert!(denied.load(Ordering::Acquire));
        }
    }
}

struct PendingProcess {
    started: Arc<tokio::sync::Notify>,
    cleanup: Arc<AtomicUsize>,
}
impl CompartmentProcess for PendingProcess {
    fn wait(&self) -> CompartmentFuture<'_, CompartmentExit> {
        Box::pin(async {
            self.started.notify_one();
            std::future::pending().await
        })
    }
    fn terminate_and_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async {
            self.cleanup.fetch_add(1, Ordering::AcqRel);
            Ok(())
        })
    }
}
impl CompartmentPtyProcess for PendingProcess {
    fn resize(&self, _: CompartmentPtySize) -> CompartmentFuture<'_, ()> {
        Box::pin(async {
            self.started.notify_one();
            std::future::pending().await
        })
    }
}
struct HandleTransport {
    started: Arc<tokio::sync::Notify>,
    cleanup: Arc<AtomicUsize>,
}
impl HandleTransport {
    fn process(&self) -> PendingProcess {
        PendingProcess {
            started: Arc::clone(&self.started),
            cleanup: Arc::clone(&self.cleanup),
        }
    }
}
impl ExecutionCompartmentTransport for HandleTransport {
    fn execute(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { bail!("only handle paths installed in this fixture") })
    }
    fn spawn_pipe(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        Box::pin(async {
            Ok(CompartmentPipe {
                stdin: Box::new(tokio::io::sink()),
                stdout: Box::new(tokio::io::empty()),
                stderr: Box::new(tokio::io::empty()),
                process: Box::new(self.process()),
            })
        })
    }
    fn spawn_pty(
        &self,
        _: CompartmentCommand,
        _: CompartmentPtySize,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        Box::pin(async {
            Ok(CompartmentPty {
                input: Box::new(tokio::io::sink()),
                output: Box::new(tokio::io::empty()),
                process: Box::new(self.process()),
            })
        })
    }
    fn native_file_io(
        &self,
        _: CompartmentFileIoCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { bail!("only handle paths installed in this fixture") })
    }
    fn close_and_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async {
            self.cleanup.fetch_add(1, Ordering::AcqRel);
            Ok(())
        })
    }
}

#[tokio::test]
async fn inflight_process_wait_and_resize_end_on_denial_and_preserve_cleanup() {
    for shape in 0..3 {
        for expire in [false, true] {
            let selected = backend();
            let scope = identity();
            let started = Arc::new(tokio::sync::Notify::new());
            let cleanup = Arc::new(AtomicUsize::new(0));
            let boundary = ProtectedExecutionBoundary::from_parts(
                Arc::clone(&selected),
                scope,
                Box::new(TestResources {
                    denied: Arc::new(AtomicBool::new(false)),
                    deadline: Instant::now() + Duration::from_secs(10),
                }),
                Box::new(HandleTransport {
                    started: Arc::clone(&started),
                    cleanup: Arc::clone(&cleanup),
                }),
                BoundaryPeer::Synthetic,
                admission(),
            )
            .unwrap();
            let context =
                ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary)
                    .unwrap();
            let size = CompartmentPtySize { cols: 80, rows: 24 };
            let operation = if shape == 0 {
                PreparedOperation::Pipe(command())
            } else {
                PreparedOperation::Pty(command(), size)
            };
            let mut effect = permit(&selected, scope, operation);
            if expire {
                effect.deadline = Instant::now() + Duration::from_millis(200);
            }
            let process: Box<dyn CompartmentPtyProcess>;
            let pipe_process: Box<dyn CompartmentProcess>;
            let (mut pending, owner): (CompartmentFuture<'_, ()>, &dyn CompartmentProcess) =
                if shape == 0 {
                    pipe_process = context.spawn_pipe(effect).await.unwrap().process;
                    (
                        Box::pin(async { pipe_process.wait().await.map(|_| ()) }),
                        pipe_process.as_ref(),
                    )
                } else {
                    process = context.spawn_pty(effect).await.unwrap().process;
                    if shape == 1 {
                        (
                            Box::pin(async { process.wait().await.map(|_| ()) }),
                            process.as_ref(),
                        )
                    } else {
                        (process.resize(size), process.as_ref())
                    }
                };
            tokio::select! { _ = started.notified() => {}, _ = &mut pending => panic!("handle did not enter its pending operation") }
            if !expire {
                context.cancellation().unwrap().clone().cancel();
            }
            let result = tokio::time::timeout(Duration::from_secs(2), pending).await;
            assert!(
                matches!(result, Ok(Err(_))),
                "pending process shape {shape} ignored denial/cutoff (expire={expire})"
            );
            owner
                .terminate_and_reap(Instant::now() + Duration::from_secs(1))
                .await
                .unwrap();
            context
                .close_and_reap(Instant::now() + Duration::from_secs(1))
                .await
                .unwrap();
            assert_eq!(
                cleanup.load(Ordering::Acquire),
                2,
                "denial must not block explicit cleanup forwarding"
            );
        }
    }
}
