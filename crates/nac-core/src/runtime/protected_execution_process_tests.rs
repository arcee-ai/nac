//! Unit-only transport controls; no actual reap, Root or runtime qualification.
use super::*;

#[derive(Clone, Copy)]
enum Cleanup {
    Complete,
    Fail,
    Pending,
}
struct Process {
    cleanup: Cleanup,
    started: Arc<AtomicBool>,
    requested: Arc<AtomicBool>,
}
impl CompartmentProcess for Process {
    fn wait(&self) -> CompartmentFuture<'_, CompartmentExit> {
        Box::pin(async {
            Ok(CompartmentExit {
                code: Some(0),
                signal: None,
            })
        })
    }
    fn terminate_and_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        self.requested.store(true, Ordering::Release);
        Box::pin(async move {
            self.started.store(true, Ordering::Release);
            match self.cleanup {
                Cleanup::Complete => Ok(()),
                Cleanup::Fail => bail!("unit cleanup is unknown"),
                Cleanup::Pending => std::future::pending().await,
            }
        })
    }
}
impl CompartmentPtyProcess for Process {
    fn resize(&self, _: CompartmentPtySize) -> CompartmentFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}
struct Transport {
    output: TestTransport,
    cleanup: Cleanup,
    started: Arc<AtomicBool>,
    requested: Arc<AtomicBool>,
}
impl Transport {
    fn process(&self) -> Process {
        Process {
            cleanup: self.cleanup,
            started: Arc::clone(&self.started),
            requested: Arc::clone(&self.requested),
        }
    }
}
impl ExecutionCompartmentTransport for Transport {
    fn execute(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { Ok(self.output.output()) })
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
        Box::pin(async { Ok(self.output.output()) })
    }
    fn close_and_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}
struct Fixture {
    selected: Arc<ExecutionBackend>,
    scope: ProtectedExecutionIdentity,
    context: ProtectedExecutionContext,
    denied: Arc<AtomicBool>,
    started: Arc<AtomicBool>,
    requested: Arc<AtomicBool>,
}
impl Fixture {
    fn new(cleanup: Cleanup) -> Self {
        let selected = backend();
        let scope = identity();
        let denied = Arc::new(AtomicBool::new(false));
        let started = Arc::new(AtomicBool::new(false));
        let requested = Arc::new(AtomicBool::new(false));
        let boundary = ProtectedExecutionBoundary::from_parts(
            Arc::clone(&selected),
            scope,
            Box::new(TestResources {
                denied: Arc::clone(&denied),
                deadline: Instant::now() + Duration::from_secs(10),
            }),
            Box::new(Transport {
                output: TestTransport {
                    calls: Arc::new(AtomicUsize::new(0)),
                },
                cleanup,
                started: Arc::clone(&started),
                requested: Arc::clone(&requested),
            }),
            BoundaryPeer::Synthetic,
            admission(),
        )
        .unwrap();
        let context =
            ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary)
                .unwrap();
        Self {
            selected,
            scope,
            context,
            denied,
            started,
            requested,
        }
    }
    async fn process(&self, pty: bool) -> Box<dyn CompartmentProcess> {
        if pty {
            let operation =
                PreparedOperation::Pty(command(), CompartmentPtySize { cols: 80, rows: 24 });
            self.context
                .spawn_pty(permit(&self.selected, self.scope, operation))
                .await
                .unwrap()
                .process
        } else {
            self.context
                .spawn_pipe(permit(
                    &self.selected,
                    self.scope,
                    PreparedOperation::Pipe(command()),
                ))
                .await
                .unwrap()
                .process
        }
    }
}
async fn reaped_drop_keeps_successor(pty: bool) {
    let fixture = Fixture::new(Cleanup::Complete);
    let process = fixture.process(pty).await;
    process
        .terminate_and_reap(Instant::now() + Duration::from_secs(5))
        .await
        .unwrap();
    assert!(fixture.started.load(Ordering::Acquire));
    drop(process);
    assert!(
        !fixture.denied.load(Ordering::Acquire),
        "dropping an explicitly reaped job denied its independent successor"
    );
    let output = fixture
        .context
        .execute(permit(
            &fixture.selected,
            fixture.scope,
            PreparedOperation::Execute(command()),
        ))
        .await
        .unwrap();
    assert_eq!(output.stdout(), b"target-only");
    // Releasing a completed job must not bypass a later current-source denial.
    fixture.denied.store(true, Ordering::Release);
    assert!(fixture
        .context
        .check_stage(ProtectedExecutionStage::Effect)
        .is_err());
}
#[tokio::test]
async fn reaped_pipe_drop_preserves_independent_successor() {
    reaped_drop_keeps_successor(false).await;
}
#[tokio::test]
async fn reaped_pty_drop_preserves_independent_successor() {
    reaped_drop_keeps_successor(true).await;
}
#[tokio::test]
async fn absent_failed_unpolled_cancelled_reap_and_exit_only_still_deny_on_drop() {
    for pty in [false, true] {
        for action in 0..5 {
            let fixture = Fixture::new(match action {
                2 => Cleanup::Fail,
                3 | 4 => Cleanup::Pending,
                _ => Cleanup::Complete,
            });
            let process = fixture.process(pty).await;
            let deadline = Instant::now() + Duration::from_secs(5);
            match action {
                0 => {}
                1 => {
                    process.wait().await.unwrap();
                }
                2 => {
                    assert!(process.terminate_and_reap(deadline).await.is_err());
                }
                3 => {
                    let cleanup = process.terminate_and_reap(deadline);
                    assert!(
                        fixture.requested.load(Ordering::Acquire),
                        "stop request must reach the adapter before any future poll"
                    );
                    drop(cleanup);
                    assert!(!fixture.started.load(Ordering::Acquire));
                }
                _ => {
                    let mut cleanup = process.terminate_and_reap(deadline);
                    tokio::select! { biased;
                        result = &mut cleanup => panic!("pending cleanup unexpectedly resolved: {result:?}"),
                        _ = tokio::task::yield_now() => {},
                    }
                    assert!(fixture.started.load(Ordering::Acquire));
                    drop(cleanup);
                }
            }
            drop(process);
            assert!(
                fixture.denied.load(Ordering::Acquire),
                "unknown cleanup escaped denial: pty={pty}, action={action}"
            );
            assert!(fixture
                .context
                .check_stage(ProtectedExecutionStage::Effect)
                .is_err());
        }
    }
}
