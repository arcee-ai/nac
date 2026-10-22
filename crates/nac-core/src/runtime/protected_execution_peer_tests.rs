//! Actual Linux socket ownership with synthetic Root resources only. These
//! controls do not qualify a protected runtime, UID policy or real effect lease.
use super::*;
use nac_process::peer_channel::{capture, PeerBinding, PeerConnection, PeerLifetime};
use std::sync::Mutex;
use tokio::net::UnixStream;

struct BoundTransport<T = TestTransport> {
    inner: T,
    binding: Arc<Mutex<Option<PeerBinding>>>,
    received_deadline: Arc<Mutex<Option<Instant>>>,
}
impl<T: ExecutionCompartmentTransport> ExecutionCompartmentTransport for BoundTransport<T> {
    fn peer_binding(&self) -> Option<PeerBinding> {
        self.binding.lock().unwrap().clone()
    }
    fn execute(
        &self,
        command: CompartmentCommand,
        deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        *self.received_deadline.lock().unwrap() = Some(deadline);
        self.inner.execute(command, deadline)
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
        self.inner.native_file_io(operation, deadline)
    }
    fn close_and_reap(&self, deadline: Instant) -> CompartmentFuture<'_, ()> {
        self.inner.close_and_reap(deadline)
    }
}

fn captured(cutoff: Instant) -> (PeerConnection, PeerLifetime, UnixStream) {
    let (stream, remote) = UnixStream::pair().unwrap();
    let (connection, peer) = capture(stream, cutoff).unwrap();
    (connection, peer, remote)
}
fn resources(denied: &Arc<AtomicBool>, deadline: Instant) -> Box<dyn VerifiedBoundaryResources> {
    Box::new(TestResources {
        denied: Arc::clone(denied),
        deadline,
    })
}

#[tokio::test]
async fn cancellation_handle_denies_actual_peer_io_without_a_stage_check() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let deadline = Instant::now() + Duration::from_secs(10);
    let (mut connection, peer, mut remote) = captured(deadline);
    let denied = Arc::new(AtomicBool::new(false));
    let binding = peer.binding();
    let selected = backend();
    let scope = identity();
    let boundary = ProtectedExecutionBoundary::from_verified_resources(
        Arc::clone(&selected),
        scope,
        resources(&denied, deadline),
        Box::new(BoundTransport {
            inner: TestTransport {
                calls: Arc::new(AtomicUsize::new(0)),
            },
            binding: Arc::new(Mutex::new(Some(binding))),
            received_deadline: Arc::new(Mutex::new(None)),
        }),
        peer,
        admission(),
    )
    .unwrap();
    let context = ProtectedExecutionContext::from_boundary(selected, scope, boundary).unwrap();
    let cancellation = context.cancellation().unwrap();
    remote.write_all(b"queued before denial").await.unwrap();
    // The producer signals this exact owner; no Core stage check or model call
    // is needed to close the original gated I/O, including queued bytes.
    cancellation.clone().cancel();
    let mut buffer = [0; 32];
    let result = tokio::time::timeout(Duration::from_secs(1), connection.read(&mut buffer)).await;
    assert!(matches!(result, Ok(Err(_))));
    assert_eq!(buffer, [0; 32]);
    assert!(denied.load(Ordering::Acquire));
}

#[tokio::test]
async fn actual_peer_loss_interrupts_inflight_dispatch_without_raw_reply() {
    for shape in 0..4 {
        let deadline = Instant::now() + Duration::from_secs(10);
        let (connection, peer, _remote) = captured(deadline);
        let denied = Arc::new(AtomicBool::new(false));
        let started = Arc::new(tokio::sync::Notify::new());
        let selected = backend();
        let scope = identity();
        let binding = peer.binding();
        let boundary = ProtectedExecutionBoundary::from_verified_resources(
            Arc::clone(&selected),
            scope,
            resources(&denied, deadline),
            Box::new(BoundTransport {
                inner: PendingTransport(Arc::clone(&started)),
                binding: Arc::new(Mutex::new(Some(binding))),
                received_deadline: Arc::new(Mutex::new(None)),
            }),
            peer,
            admission(),
        )
        .unwrap();
        let context =
            ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary)
                .unwrap();
        let mut pending = Box::pin(super::wait_controls::pending_dispatch(
            &context, &selected, scope, shape, deadline,
        ));
        tokio::select! { _ = started.notified() => {}, _ = &mut pending => panic!("adapter did not enter pending dispatch") }
        drop(connection);
        let result = tokio::time::timeout(Duration::from_secs(1), pending).await;
        assert!(
            matches!(result, Ok(Err(_))),
            "actual peer loss must interrupt the Core waiter"
        );
        assert!(denied.load(Ordering::Acquire));
    }
}

#[tokio::test]
async fn actual_peer_rejects_missing_or_different_allocation_and_denies_both_resources() {
    for mismatched in [false, true] {
        let deadline = Instant::now() + Duration::from_secs(10);
        let (_connection, peer, _remote) = captured(deadline);
        let (_other_connection, other_peer, _other_remote) = captured(deadline);
        let denial = peer.denial_handle();
        let denied = Arc::new(AtomicBool::new(false));
        let calls = Arc::new(AtomicUsize::new(0));
        let inner = TestTransport {
            calls: Arc::clone(&calls),
        };
        let transport: Box<dyn ExecutionCompartmentTransport> = if mismatched {
            Box::new(BoundTransport {
                inner,
                binding: Arc::new(Mutex::new(Some(other_peer.binding()))),
                received_deadline: Arc::new(Mutex::new(None)),
            })
        } else {
            // Default trait method returns None even while a real peer exists.
            Box::new(inner)
        };
        assert!(ProtectedExecutionBoundary::from_verified_resources(
            backend(),
            identity(),
            resources(&denied, deadline),
            transport,
            peer,
            admission(),
        )
        .is_err());
        assert!(denied.load(Ordering::Acquire));
        tokio::time::timeout(Duration::from_secs(1), denial.invalidated())
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::Acquire), 0);
        // Same UID/PID is insufficient; the unrelated allocation stays current.
        other_peer.check_current().unwrap();
    }
}

#[tokio::test]
async fn actual_peer_binding_replacement_cannot_reopen_after_restore() {
    let deadline = Instant::now() + Duration::from_secs(10);
    let (_connection, peer, _remote) = captured(deadline);
    let (_other_connection, other, _other_remote) = captured(deadline);
    let original = peer.binding();
    let denial = peer.denial_handle();
    let binding = Arc::new(Mutex::new(Some(original.clone())));
    let denied = Arc::new(AtomicBool::new(false));
    let selected = backend();
    let scope = identity();
    let boundary = ProtectedExecutionBoundary::from_verified_resources(
        Arc::clone(&selected),
        scope,
        resources(&denied, deadline),
        Box::new(BoundTransport {
            inner: TestTransport {
                calls: Arc::new(AtomicUsize::new(0)),
            },
            binding: Arc::clone(&binding),
            received_deadline: Arc::new(Mutex::new(None)),
        }),
        peer,
        admission(),
    )
    .unwrap();
    let context = ProtectedExecutionContext::from_boundary(selected, scope, boundary).unwrap();
    context
        .check_stage(ProtectedExecutionStage::Prepare)
        .unwrap();
    *binding.lock().unwrap() = Some(other.binding());
    assert!(context
        .check_stage(ProtectedExecutionStage::Activate)
        .is_err());
    *binding.lock().unwrap() = Some(original);
    assert!(context
        .check_stage(ProtectedExecutionStage::Effect)
        .is_err());
    assert!(denied.load(Ordering::Acquire));
    tokio::time::timeout(Duration::from_secs(1), denial.invalidated())
        .await
        .unwrap();
    other.check_current().unwrap();
}

#[tokio::test]
async fn actual_peer_caps_dispatch_and_connection_loss_blocks_later_effect() {
    let cutoff = Instant::now() + Duration::from_secs(10);
    let (connection, peer, _remote) = captured(cutoff);
    let denied = Arc::new(AtomicBool::new(false));
    let calls = Arc::new(AtomicUsize::new(0));
    let received = Arc::new(Mutex::new(None));
    let binding = peer.binding();
    let selected = backend();
    let scope = identity();
    let boundary = ProtectedExecutionBoundary::from_verified_resources(
        Arc::clone(&selected),
        scope,
        resources(&denied, cutoff + Duration::from_secs(20)),
        Box::new(BoundTransport {
            inner: TestTransport {
                calls: Arc::clone(&calls),
            },
            binding: Arc::new(Mutex::new(Some(binding))),
            received_deadline: Arc::clone(&received),
        }),
        peer,
        admission(),
    )
    .unwrap();
    assert_eq!(boundary.state.original_deadline().unwrap(), cutoff);
    let context =
        ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary).unwrap();
    let mut effect = permit(&selected, scope, PreparedOperation::Execute(command()));
    effect.deadline = cutoff + Duration::from_secs(30);
    context.execute(effect).await.unwrap();
    assert_eq!(*received.lock().unwrap(), Some(cutoff));
    drop(connection);
    assert!(context
        .execute(permit(
            &selected,
            scope,
            PreparedOperation::Execute(command())
        ))
        .await
        .is_err());
    assert!(denied.load(Ordering::Acquire));
    assert_eq!(calls.load(Ordering::Acquire), 1);
}

#[tokio::test]
async fn actual_peer_is_denied_when_root_resource_check_fails() {
    for fail_at_construction in [false, true] {
        let cutoff = Instant::now() + Duration::from_secs(10);
        let (_connection, peer, _remote) = captured(cutoff);
        let denial = peer.denial_handle();
        let binding = peer.binding();
        let denied = Arc::new(AtomicBool::new(fail_at_construction));
        let selected = backend();
        let scope = identity();
        let boundary = ProtectedExecutionBoundary::from_verified_resources(
            Arc::clone(&selected),
            scope,
            resources(&denied, cutoff),
            Box::new(BoundTransport {
                inner: TestTransport {
                    calls: Arc::new(AtomicUsize::new(0)),
                },
                binding: Arc::new(Mutex::new(Some(binding))),
                received_deadline: Arc::new(Mutex::new(None)),
            }),
            peer,
            admission(),
        );
        let context = if fail_at_construction {
            assert!(boundary.is_err());
            None
        } else {
            let context =
                ProtectedExecutionContext::from_boundary(selected, scope, boundary.unwrap())
                    .unwrap();
            denied.store(true, Ordering::Release);
            assert!(context
                .check_stage(ProtectedExecutionStage::Effect)
                .is_err());
            Some(context)
        };
        tokio::time::timeout(Duration::from_secs(1), denial.invalidated())
            .await
            .unwrap();
        drop(context);
    }
}
