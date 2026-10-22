//! Real socket/storage retirement with synthetic source/peer qualification.
//! These controls do not activate E or establish authenticated CREATE authority.
use super::*;
use crate::runtime::protected_execution_resources::capacity_source::{
    tests::Fixture, RetainedCapacityInput,
};
use crate::runtime::CompartmentStorageHold;
use futures_util::FutureExt;
use tokio::{io::AsyncReadExt, net::UnixStream};

enum Cleanup {
    Joined,
    Failed,
    Pending,
}
struct SocketTransport {
    inner: TestTransport,
    socket: Mutex<Option<UnixStream>>,
    storage: Mutex<Option<[CompartmentStorageHold; 2]>>,
    cleanup: Cleanup,
}
impl ExecutionCompartmentTransport for SocketTransport {
    fn execute(
        &self,
        command: CompartmentCommand,
        cutoff: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        self.inner.execute(command, cutoff)
    }
    fn spawn_pipe(
        &self,
        command: CompartmentCommand,
        cutoff: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        self.inner.spawn_pipe(command, cutoff)
    }
    fn spawn_pty(
        &self,
        command: CompartmentCommand,
        size: CompartmentPtySize,
        cutoff: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        self.inner.spawn_pty(command, size, cutoff)
    }
    fn native_file_io(
        &self,
        operation: CompartmentFileIoCommand,
        cutoff: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        self.inner.native_file_io(operation, cutoff)
    }
    fn close_and_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async {
            match self.cleanup {
                Cleanup::Joined => {
                    drop(self.socket.lock().unwrap().take());
                    drop(self.storage.lock().unwrap().take());
                    Ok(())
                }
                Cleanup::Failed => bail!("synthetic transport cannot prove join"),
                Cleanup::Pending => std::future::pending().await,
            }
        })
    }
}
fn declaration() -> CompartmentResourceDeclaration {
    let one = std::num::NonZeroUsize::new(1).unwrap();
    CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, one)
}
fn context(
    capacity: &Arc<RetainedCapacityInput>,
    cleanup: Cleanup,
) -> (ProtectedExecutionContext, UnixStream) {
    let (admissions, storage) = capacity
        .prepare_native_pair(declaration())
        .unwrap()
        .begin()
        .unwrap();
    let (socket, remote) = UnixStream::pair().unwrap();
    let selected = backend();
    let scope = identity();
    let boundary = ProtectedExecutionBoundary::from_parts(
        Arc::clone(&selected),
        scope,
        Box::new(TestResources {
            denied: Arc::new(AtomicBool::new(false)),
            deadline: Instant::now() + Duration::from_secs(30),
        }),
        Box::new(SocketTransport {
            inner: TestTransport {
                calls: Arc::new(AtomicUsize::new(0)),
            },
            socket: Mutex::new(Some(socket)),
            storage: Mutex::new(Some(storage)),
            cleanup,
        }),
        BoundaryPeer::Synthetic,
        admissions,
    )
    .unwrap();
    (
        ProtectedExecutionContext::from_boundary(selected, scope, boundary).unwrap(),
        remote,
    )
}
async fn local_socket_is_closed(remote: &mut UnixStream) {
    let mut byte = [0];
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), remote.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn paired_transport_join_retires_both_charges_after_actual_socket_storage_closure() {
    let fixture = Fixture::new();
    let capacity = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
    let (context, mut remote) = context(&capacity, Cleanup::Joined);
    context
        .close_and_reap(Instant::now() + Duration::from_secs(10))
        .await
        .unwrap();
    local_socket_is_closed(&mut remote).await;
    assert!(
        capacity.prepare_native_pair(declaration()).is_err(),
        "boundary still retains both original admissions"
    );
    drop(context);
    drop(capacity.prepare_native_pair(declaration()).unwrap());
}

#[tokio::test]
async fn canceled_paired_cleanup_closes_local_socket_but_keeps_unknown_charges_parked() {
    let fixture = Fixture::new();
    let capacity = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
    let (context, mut remote) = context(&capacity, Cleanup::Pending);
    context.cancellation().unwrap().cancel();
    assert!(context
        .close_and_reap(Instant::now() + Duration::from_secs(10))
        .now_or_never()
        .is_none());
    assert!(context
        .check_stage(ProtectedExecutionStage::Effect)
        .is_err());
    drop(context);
    local_socket_is_closed(&mut remote).await;
    assert!(
        capacity.prepare_native_pair(declaration()).is_err(),
        "local FD/storage Drop does not prove a whole Native join"
    );
}

#[tokio::test]
async fn failed_paired_transport_join_never_restores_capacity_after_local_closure() {
    let fixture = Fixture::new();
    let capacity = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
    let (context, mut remote) = context(&capacity, Cleanup::Failed);
    assert!(context
        .close_and_reap(Instant::now() + Duration::from_secs(10))
        .await
        .is_err());
    drop(context);
    local_socket_is_closed(&mut remote).await;
    assert!(capacity.prepare_native_pair(declaration()).is_err());
}
