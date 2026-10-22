//! Synthetic capture outcomes only; no file effect or runtime qualification.
use super::*;

struct CaptureTransport {
    inner: TestTransport,
    stdout_truncated: bool,
    stderr_truncated: bool,
}
impl CaptureTransport {
    fn output(&self) -> CompartmentOutput {
        let mut output = self.inner.output();
        output.stdout_truncated = self.stdout_truncated;
        output.stderr_truncated = self.stderr_truncated;
        output
    }
}
impl ExecutionCompartmentTransport for CaptureTransport {
    fn execute(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { Ok(self.output()) })
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
        _: CompartmentFileIoCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { Ok(self.output()) })
    }
    fn close_and_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::test]
async fn native_file_capture_requires_both_complete_streams_without_reissuing() {
    for (stdout_truncated, stderr_truncated) in
        [(false, false), (true, false), (false, true), (true, true)]
    {
        for file_io in [false, true] {
            let selected = backend();
            let scope = identity();
            let denied = Arc::new(AtomicBool::new(false));
            let calls = Arc::new(AtomicUsize::new(0));
            let boundary = ProtectedExecutionBoundary::from_parts(
                Arc::clone(&selected),
                scope,
                Box::new(TestResources {
                    denied: Arc::clone(&denied),
                    deadline: Instant::now() + Duration::from_secs(10),
                }),
                Box::new(CaptureTransport {
                    inner: TestTransport {
                        calls: Arc::clone(&calls),
                    },
                    stdout_truncated,
                    stderr_truncated,
                }),
                BoundaryPeer::Synthetic,
                admission(),
            )
            .unwrap();
            let context =
                ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary)
                    .unwrap();
            let result = if file_io {
                context
                    .native_file_io(permit(
                        &selected,
                        scope,
                        PreparedOperation::FileIo(CompartmentFileIoCommand::from_prepared(
                            command(),
                        )),
                    ))
                    .await
            } else {
                context
                    .execute(permit(
                        &selected,
                        scope,
                        PreparedOperation::Execute(command()),
                    ))
                    .await
            };
            assert_eq!(calls.load(Ordering::Acquire), 1);
            if file_io && (stdout_truncated || stderr_truncated) {
                assert!(result.is_err(), "an incomplete file result is not success");
                assert!(denied.load(Ordering::Acquire));
                assert!(context
                    .check_stage(ProtectedExecutionStage::Effect)
                    .is_err());
                assert!(context
                    .execute(permit(
                        &selected,
                        scope,
                        PreparedOperation::Execute(command()),
                    ))
                    .await
                    .is_err());
                assert_eq!(calls.load(Ordering::Acquire), 1);
            } else {
                let result = result.unwrap();
                assert_eq!(result.stdout_truncated(), stdout_truncated);
                assert_eq!(result.stderr_truncated(), stderr_truncated);
                assert!(!denied.load(Ordering::Acquire));
            }
        }
    }
}
