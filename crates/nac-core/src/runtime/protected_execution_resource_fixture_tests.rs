//! Only fixture accounting is tested here; RAW callbacks are not qualification.
use super::*;
use crate::runtime::{
    CompartmentCommand, CompartmentFileIoCommand, CompartmentOutput, CompartmentPipe,
    CompartmentPty, CompartmentPtySize,
};
use anyhow::bail;
use std::time::Duration;

#[derive(Clone, Copy)]
enum Cleanup {
    Complete,
    Fail,
    Pending,
}
struct Raw {
    mode: Cleanup,
    observed: Arc<Mutex<Vec<Instant>>>,
    _hold: CompartmentStorageHold,
}
impl ExecutionCompartmentTransport for Raw {
    fn execute(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { bail!("fixture has no execution") })
    }
    fn spawn_pipe(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        Box::pin(async { bail!("fixture has no execution") })
    }
    fn spawn_pty(
        &self,
        _: CompartmentCommand,
        _: CompartmentPtySize,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        Box::pin(async { bail!("fixture has no execution") })
    }
    fn native_file_io(
        &self,
        _: CompartmentFileIoCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { bail!("fixture has no execution") })
    }
    fn close_and_reap(&self, cutoff: Instant) -> CompartmentFuture<'_, ()> {
        self.observed.lock().unwrap().push(cutoff);
        Box::pin(async move {
            match self.mode {
                Cleanup::Complete => Ok(()),
                Cleanup::Fail => bail!("fixture cleanup unknown"),
                Cleanup::Pending => std::future::pending().await,
            }
        })
    }
}
fn limits() -> FixtureScopeLimits {
    FixtureScopeLimits {
        endpoints: 1,
        live_jobs: 1,
        native_payload_bytes: 1,
        captured_results: 1,
        captured_bytes: 1,
    }
}
fn declaration() -> CompartmentResourceDeclaration {
    let one = NonZeroUsize::new(1).unwrap();
    CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, one)
}

#[tokio::test]
async fn fixture_cleanup_requires_awaited_success_and_actual_storage_retirement() {
    for mode in [0, 1, 2, 3] {
        let host = FixtureHost::new(limits(), NonZeroUsize::new(1).unwrap());
        let session = host.session(limits()).unwrap();
        session.probe_endpoint(declaration()).unwrap();
        session.probe_endpoint(declaration()).unwrap();
        let (reservation, hold) = session.reserve_endpoint(declaration()).unwrap();
        let observed = Arc::new(Mutex::new(Vec::new()));
        let raw = Raw {
            mode: match mode {
                1 => Cleanup::Fail,
                2 => Cleanup::Pending,
                _ => Cleanup::Complete,
            },
            observed: Arc::clone(&observed),
            _hold: hold.clone(),
        };
        let cutoff = Instant::now() + Duration::from_secs(1);
        let cleanup = reservation.close_and_reap(&raw, cutoff);
        assert_eq!(
            *observed.lock().unwrap(),
            vec![cutoff],
            "stop request forwards before first poll"
        );
        match mode {
            0 => cleanup.await.unwrap(),
            1 => assert!(cleanup.await.is_err()),
            2 => assert!(tokio::time::timeout(Duration::from_millis(10), cleanup)
                .await
                .is_err()),
            _ => drop(cleanup),
        }
        drop(reservation);
        drop(hold);
        assert!(session.probe_endpoint(declaration()).is_err());
        drop(raw);
        if mode == 0 {
            session.probe_endpoint(declaration()).unwrap();
        } else {
            assert!(session.probe_endpoint(declaration()).is_err());
        }
        drop(session);
        assert_eq!(
            host.session(limits()).is_ok(),
            mode == 0,
            "unknown session slot remains charged too"
        );
    }
}

#[tokio::test]
async fn fixture_retry_retains_original_cutoff_until_success() {
    let host = FixtureHost::new(limits(), NonZeroUsize::new(1).unwrap());
    let session = host.session(limits()).unwrap();
    let (reservation, hold) = session.reserve_endpoint(declaration()).unwrap();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let mut raw = Raw {
        mode: Cleanup::Fail,
        observed: Arc::clone(&observed),
        _hold: hold,
    };
    let original = Instant::now() + Duration::from_secs(1);
    assert!(reservation.close_and_reap(&raw, original).await.is_err());
    raw.mode = Cleanup::Complete;
    reservation
        .close_and_reap(&raw, original + Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(*observed.lock().unwrap(), vec![original, original]);
    drop(reservation);
    assert!(session.probe_endpoint(declaration()).is_err());
    drop(raw);
    session.probe_endpoint(declaration()).unwrap();
}

#[tokio::test]
async fn fixture_join_checks_latest_retained_cutoff() {
    let host = FixtureHost::new(limits(), NonZeroUsize::new(1).unwrap());
    let session = host.session(limits()).unwrap();
    let (reservation, hold) = session.reserve_endpoint(declaration()).unwrap();
    let raw = Raw {
        mode: Cleanup::Complete,
        observed: Arc::new(Mutex::new(Vec::new())),
        _hold: hold,
    };
    let earlier = reservation.close_and_reap(&raw, Instant::now() + Duration::from_secs(1));
    drop(reservation.close_and_reap(&raw, Instant::now()));
    assert!(
        earlier.await.is_err(),
        "fixture must refuse RAW success after its retained cutoff expired"
    );
    drop(reservation);
    drop(raw);
    assert!(session.probe_endpoint(declaration()).is_err());
}

#[tokio::test]
async fn fixture_prior_success_survives_a_later_expired_close() {
    let host = FixtureHost::new(limits(), NonZeroUsize::new(1).unwrap());
    let session = host.session(limits()).unwrap();
    let (reservation, hold) = session.reserve_endpoint(declaration()).unwrap();
    let raw = Raw {
        mode: Cleanup::Complete,
        observed: Arc::new(Mutex::new(Vec::new())),
        _hold: hold,
    };
    reservation
        .close_and_reap(&raw, Instant::now() + Duration::from_secs(1))
        .await
        .unwrap();
    assert!(reservation
        .close_and_reap(&raw, Instant::now())
        .await
        .is_err());
    drop(reservation);
    drop(raw);
    session.probe_endpoint(declaration()).unwrap();
}
