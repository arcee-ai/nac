//! Actual Core dispatch accounting with synthetic RAW/source owners only.
use super::*;
use crate::runtime::protected_execution_resources::SessionAdmission;
use crate::runtime::CompartmentStorageHold;

#[derive(Clone, Copy)]
enum Oversized {
    Stdout,
    Stderr,
}

struct ResourceTransport {
    inner: TestTransport,
    pending: Option<Arc<tokio::sync::Notify>>,
    oversized: Option<Oversized>,
    fail_cleanup: bool,
    close_deadlines: Arc<Mutex<Vec<Instant>>>,
    _storage: CompartmentStorageHold,
}
impl ExecutionCompartmentTransport for ResourceTransport {
    fn execute(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        if let Some(started) = &self.pending {
            started.notify_one();
            return Box::pin(std::future::pending());
        }
        Box::pin(async {
            let mut output = self.inner.output();
            if let Some(stream) = self.oversized {
                let bytes = match stream {
                    Oversized::Stdout => &mut output.stdout,
                    Oversized::Stderr => &mut output.stderr,
                };
                *bytes = Vec::with_capacity(2048);
                bytes.push(b'x');
            }
            Ok(output)
        })
    }
    fn spawn_pipe(
        &self,
        command: CompartmentCommand,
        deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        self.inner.spawn_pipe(command, deadline)
    }
    fn spawn_pty(
        &self,
        command: CompartmentCommand,
        size: CompartmentPtySize,
        deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        self.inner.spawn_pty(command, size, deadline)
    }
    fn native_file_io(
        &self,
        operation: CompartmentFileIoCommand,
        deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        self.execute(operation.into_command(), deadline)
    }
    fn close_and_reap(&self, cutoff: Instant) -> CompartmentFuture<'_, ()> {
        self.close_deadlines.lock().unwrap().push(cutoff);
        Box::pin(async {
            if self.fail_cleanup {
                bail!("synthetic cleanup unknown");
            }
            Ok(())
        })
    }
}
fn scopes() -> (Arc<SessionAdmission>, Arc<SessionAdmission>) {
    let limits = ScopeLimits {
        endpoints: 2,
        live_jobs: 2,
        native_payload_bytes: 2,
        captured_results: 1,
        captured_bytes: 2048,
    };
    let host = HostAdmission::new(limits, std::num::NonZeroUsize::new(2).unwrap());
    (host.session(limits).unwrap(), host.session(limits).unwrap())
}
fn context(
    session: &Arc<SessionAdmission>,
    pending: Option<Arc<tokio::sync::Notify>>,
    oversized: Option<Oversized>,
    fail_cleanup: bool,
) -> (ProtectedExecutionContext, Arc<AtomicUsize>) {
    let selected = backend();
    let scope = identity();
    let one = std::num::NonZeroUsize::new(1).unwrap();
    let (admission, storage) = session
        .reserve_endpoint(CompartmentResourceDeclaration::from_raw_capacity(
            one, one, one, 0, 0, one,
        ))
        .unwrap()
        .begin();
    let calls = Arc::new(AtomicUsize::new(0));
    let boundary = ProtectedExecutionBoundary::from_parts(
        Arc::clone(&selected),
        scope,
        Box::new(TestResources {
            denied: Arc::new(AtomicBool::new(false)),
            deadline: Instant::now() + Duration::from_secs(10),
        }),
        Box::new(ResourceTransport {
            inner: TestTransport {
                calls: Arc::clone(&calls),
            },
            pending,
            oversized,
            fail_cleanup,
            close_deadlines: Arc::new(Mutex::new(Vec::new())),
            _storage: storage,
        }),
        BoundaryPeer::Synthetic,
        admission,
    )
    .unwrap();
    (
        ProtectedExecutionContext::from_boundary(selected, scope, boundary).unwrap(),
        calls,
    )
}
fn effect(context: &ProtectedExecutionContext, file: bool) -> ProtectedExecutionPermit {
    permit(
        &context.selected_backend,
        context.identity,
        if file {
            PreparedOperation::FileIo(CompartmentFileIoCommand::from_prepared(command()))
        } else {
            PreparedOperation::Execute(command())
        },
    )
}

#[tokio::test]
async fn capture_is_reserved_before_raw_call_and_kept_across_concurrent_close() {
    for file in [false, true] {
        let (first, second) = scopes();
        let started = Arc::new(tokio::sync::Notify::new());
        let (pending, _) = context(&first, Some(Arc::clone(&started)), None, false);
        let (other, calls) = context(&second, None, None, false);
        let mut work = Box::pin(async {
            if file {
                pending.native_file_io(effect(&pending, true)).await
            } else {
                pending.execute(effect(&pending, false)).await
            }
        });
        tokio::select! { _ = started.notified() => {}, _ = &mut work => panic!("RAW fixture did not suspend") }
        assert!(other.execute(effect(&other, false)).await.is_err());
        assert_eq!(
            calls.load(Ordering::Acquire),
            0,
            "admission must precede RAW call creation"
        );
        other.check_stage(ProtectedExecutionStage::Effect).unwrap();
        pending
            .close_and_reap(Instant::now() + Duration::from_secs(1))
            .await
            .unwrap();
        assert!(
            other.execute(effect(&other, false)).await.is_err(),
            "an unpolled caller future still owns its destination reservation"
        );
        drop(work);
        let output = other.execute(effect(&other, false)).await.unwrap();
        assert_eq!(calls.load(Ordering::Acquire), 1);
        other
            .close_and_reap(Instant::now() + Duration::from_secs(1))
            .await
            .unwrap();
        drop(other);
        drop(pending);
        let (successor, calls) = context(&first, None, None, false);
        assert!(
            successor.execute(effect(&successor, false)).await.is_err(),
            "captured result outlives both contexts and endpoints"
        );
        assert_eq!(calls.load(Ordering::Acquire), 0);
        assert_eq!(output.stdout(), b"target-only");
        drop(output);
        assert!(successor.execute(effect(&successor, false)).await.is_ok());
        successor
            .close_and_reap(Instant::now() + Duration::from_secs(1))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn failed_cleanup_never_restores_endpoint_capacity() {
    let (first, second) = scopes();
    let (unknown, _) = context(&first, None, None, true);
    assert!(unknown
        .close_and_reap(Instant::now() + Duration::from_secs(1))
        .await
        .is_err());
    drop(unknown);
    let (known, _) = context(&second, None, None, false);
    let one = std::num::NonZeroUsize::new(1).unwrap();
    let declaration = CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, one);
    assert!(first.reserve_endpoint(declaration).is_err());
    known
        .close_and_reap(Instant::now() + Duration::from_secs(1))
        .await
        .unwrap();
    drop(known);
    let prepared = first.reserve_endpoint(declaration).unwrap();
    assert!(
        second.reserve_endpoint(declaration).is_err(),
        "unknown endpoint's host charge remains parked"
    );
    drop(prepared);
}

#[tokio::test]
async fn adapter_capacity_violation_denies_boundary_without_leaking_destination_charge() {
    for stream in [Oversized::Stdout, Oversized::Stderr] {
        for file in [false, true] {
            let (first, second) = scopes();
            let (bad, _) = context(&first, None, Some(stream), false);
            let result = if file {
                bad.native_file_io(effect(&bad, true)).await
            } else {
                bad.execute(effect(&bad, false)).await
            };
            assert!(result.is_err());
            assert!(bad.check_stage(ProtectedExecutionStage::Effect).is_err());
            let (other, _) = context(&second, None, None, false);
            assert!(other.execute(effect(&other, false)).await.is_ok());
            other
                .close_and_reap(Instant::now() + Duration::from_secs(1))
                .await
                .unwrap();
            bad.close_and_reap(Instant::now() + Duration::from_secs(1))
                .await
                .unwrap();
        }
    }
}

#[tokio::test]
async fn boundary_construction_failure_retains_partial_storage_and_unknown_charge() {
    let (first, second) = scopes();
    let (known, _) = context(&second, None, None, false);
    let one = std::num::NonZeroUsize::new(1).unwrap();
    let declaration = CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, one);
    let (admission, hold) = first.reserve_endpoint(declaration).unwrap().begin();
    let task_hold = hold.clone();
    let started = Arc::new(tokio::sync::Notify::new());
    let (retire, retirement) = tokio::sync::oneshot::channel();
    let worker = tokio::spawn({
        let started = Arc::clone(&started);
        async move {
            let _storage = task_hold;
            started.notify_one();
            let _ = retirement.await;
        }
    });
    started.notified().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let denied = Arc::new(AtomicBool::new(true));
    let result = ProtectedExecutionBoundary::from_parts(
        backend(),
        identity(),
        Box::new(TestResources {
            denied: Arc::clone(&denied),
            deadline: Instant::now() + Duration::from_secs(10),
        }),
        Box::new(ResourceTransport {
            inner: TestTransport {
                calls: Arc::clone(&calls),
            },
            pending: None,
            oversized: None,
            fail_cleanup: false,
            close_deadlines: Arc::new(Mutex::new(Vec::new())),
            _storage: hold,
        }),
        BoundaryPeer::Synthetic,
        admission,
    );
    assert!(result.is_err());
    assert_eq!(calls.load(Ordering::Acquire), 0);
    assert!(first.reserve_endpoint(declaration).is_err());
    retire.send(()).unwrap();
    worker.await.unwrap();
    // Joining a storage fixture task is not a joint Native-driver cleanup proof.
    assert!(first.reserve_endpoint(declaration).is_err());
    known
        .close_and_reap(Instant::now() + Duration::from_secs(1))
        .await
        .unwrap();
    drop(known);
    let preparation = first.reserve_endpoint(declaration).unwrap();
    assert!(second.reserve_endpoint(declaration).is_err());
    drop(preparation);
}

struct CloseWake {
    state: std::sync::Weak<BoundaryState>,
    cutoff: Instant,
    calls: AtomicUsize,
}
impl std::task::Wake for CloseWake {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        let state = self.state.upgrade().unwrap();
        assert!(state.denied.load(Ordering::Acquire));
        assert_eq!(*state.cutoff.try_lock().unwrap(), self.cutoff);
        self.calls.fetch_add(1, Ordering::AcqRel);
    }
}

fn closing_context(
    session: &Arc<SessionAdmission>,
    denied: Arc<AtomicBool>,
    deadlines: Arc<Mutex<Vec<Instant>>>,
    source_cutoff: Instant,
) -> ProtectedExecutionContext {
    let one = std::num::NonZeroUsize::new(1).unwrap();
    let (admission, storage) = session
        .reserve_endpoint(CompartmentResourceDeclaration::from_raw_capacity(
            one, one, one, 0, 0, one,
        ))
        .unwrap()
        .begin();
    let selected = backend();
    let scope = identity();
    let boundary = ProtectedExecutionBoundary::from_parts(
        Arc::clone(&selected),
        scope,
        Box::new(TestResources {
            denied,
            deadline: source_cutoff,
        }),
        Box::new(ResourceTransport {
            inner: TestTransport {
                calls: Arc::new(AtomicUsize::new(0)),
            },
            pending: None,
            oversized: None,
            fail_cleanup: false,
            close_deadlines: deadlines,
            _storage: storage,
        }),
        BoundaryPeer::Synthetic,
        admission,
    )
    .unwrap();
    ProtectedExecutionContext::from_boundary(selected, scope, boundary).unwrap()
}

#[test]
fn explicit_context_close_denies_and_retains_cutoff_before_first_poll() {
    let (session, _) = scopes();
    let denied = Arc::new(AtomicBool::new(false));
    let deadlines = Arc::new(Mutex::new(Vec::new()));
    let source_cutoff = Instant::now() + Duration::from_secs(10);
    let context = closing_context(
        &session,
        Arc::clone(&denied),
        Arc::clone(&deadlines),
        source_cutoff,
    );
    let original_close = Instant::now() + Duration::from_secs(1);
    let state = context.state().unwrap();
    let wake = Arc::new(CloseWake {
        state: Arc::downgrade(state),
        cutoff: original_close,
        calls: AtomicUsize::new(0),
    });
    let waker = std::task::Waker::from(Arc::clone(&wake));
    let mut poll_context = std::task::Context::from_waker(&waker);
    let mut changed = Box::pin(state.changed.notified());
    assert!(std::future::Future::poll(changed.as_mut(), &mut poll_context).is_pending());
    let unpolled = context.close_and_reap(original_close);
    assert_eq!(wake.calls.load(Ordering::Acquire), 1);
    assert!(
        denied.load(Ordering::Acquire),
        "closing must deny before its future is first polled"
    );
    assert_eq!(*deadlines.lock().unwrap(), vec![original_close]);
    drop(unpolled);
    assert!(context
        .check_stage(ProtectedExecutionStage::Effect)
        .is_err());
    let later = context.close_and_reap(source_cutoff);
    assert_eq!(
        *deadlines.lock().unwrap(),
        vec![original_close, original_close],
        "a later close cannot enlarge a dropped close's original budget"
    );
    drop(later);
    drop(changed);
    drop(context);
    let one = std::num::NonZeroUsize::new(1).unwrap();
    let declaration = CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, one);
    let remaining = session.reserve_endpoint(declaration).unwrap();
    assert!(
        session.reserve_endpoint(declaration).is_err(),
        "unpolled close must not claim an actual join after storage retirement"
    );
    drop(remaining);
}

struct PausingCloseWake {
    entered: std::sync::mpsc::Sender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}
impl std::task::Wake for PausingCloseWake {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.entered.send(()).unwrap();
        self.release
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
    }
}

#[test]
fn concurrent_tighter_core_close_prevents_stale_raw_join_publication() {
    let (session, _) = scopes();
    let deadlines = Arc::new(Mutex::new(Vec::new()));
    let long = Instant::now() + Duration::from_secs(10);
    let context = closing_context(
        &session,
        Arc::new(AtomicBool::new(false)),
        Arc::clone(&deadlines),
        long,
    );
    // A has already forwarded its longer cutoff to RAW. Its RAW future can
    // finish while B's notification pauses before forwarding the tighter one.
    let mut earlier = context.close_and_reap(long);
    let state = context.state().unwrap();
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let waker = std::task::Waker::from(Arc::new(PausingCloseWake {
        entered: entered_tx,
        release: Mutex::new(release_rx),
    }));
    let mut poll_context = std::task::Context::from_waker(&waker);
    let mut changed = Box::pin(state.changed.notified());
    assert!(std::future::Future::poll(changed.as_mut(), &mut poll_context).is_pending());
    let expired = Instant::now();
    let (result, forwarded) = std::thread::scope(|scope| {
        scope.spawn(|| drop(context.close_and_reap(expired)));
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let mut noop = std::task::Context::from_waker(std::task::Waker::noop());
        let result = std::future::Future::poll(earlier.as_mut(), &mut noop);
        let forwarded = deadlines.lock().unwrap().len();
        release_tx.send(()).unwrap();
        (result, forwarded)
    });
    assert_eq!(forwarded, 1, "B must still be paused before its RAW call");
    assert!(
        matches!(result, std::task::Poll::Ready(Err(_))),
        "earlier close must refuse RAW success after a tighter Core cutoff"
    );
    assert_eq!(*deadlines.lock().unwrap(), vec![long, expired]);
    drop(earlier);
    drop(changed);
    drop(context);
    let one = std::num::NonZeroUsize::new(1).unwrap();
    let declaration = CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, one);
    let remaining = session.reserve_endpoint(declaration).unwrap();
    assert!(
        session.reserve_endpoint(declaration).is_err(),
        "stale RAW join cannot restore capacity after actual storage retirement"
    );
    drop(remaining);
}

#[tokio::test]
async fn successful_core_join_precedes_a_later_expired_close() {
    let (session, _) = scopes();
    let context = closing_context(
        &session,
        Arc::new(AtomicBool::new(false)),
        Arc::new(Mutex::new(Vec::new())),
        Instant::now() + Duration::from_secs(10),
    );
    context
        .close_and_reap(Instant::now() + Duration::from_secs(1))
        .await
        .unwrap();
    assert!(context.close_and_reap(Instant::now()).await.is_err());
    drop(context);
    let one = std::num::NonZeroUsize::new(1).unwrap();
    let declaration = CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, one);
    let first = session.reserve_endpoint(declaration).unwrap();
    let second = session.reserve_endpoint(declaration).unwrap();
    drop((first, second));
}
