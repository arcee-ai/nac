//! Bounded pressure on the existing managed Local terminal runtime.
//! Timings characterize this fixture/host; they are not throughput guarantees.
#![cfg(any(target_os = "linux", target_os = "macos"))]

use super::*;
use crate::application::terminal_observation::RenderAcknowledgement;
use nac_core::session_service::SessionService;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

// Verified at this base: AgentMode::Direct uses for_direct(), which always
// takes CommandOutputLimits::default() (8 MiB); worker overrides are separate.
// Keep these public-behavior expectations local instead of exporting private
// terminal implementation constants just for a delivery fixture.
const RETAINED_WINDOW_BYTES: usize = 8 * 1024 * 1024;
const MAX_PAGE_BYTES: usize = 64 * 1024;

/// Cleanup uses the retained session/terminal authority, never a numeric PID.
/// It finishes before Fixture drops its temporary store, including on panic.
struct OwnedTerminals(Arc<SessionService>);
impl Drop for OwnedTerminals {
    fn drop(&mut self) {
        let service = Arc::clone(&self.0);
        match std::thread::Builder::new()
            .name("nac-pressure-fixture-cleanup".into())
            .spawn(move || {
                let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                else {
                    eprintln!("owned terminal fixture cleanup runtime unavailable");
                    return;
                };
                if runtime.block_on(service.destroy_terminals()).is_err() {
                    eprintln!("owned terminal fixture cleanup retained an error");
                }
            }) {
            Ok(worker) => {
                let _ = worker.join();
            }
            Err(_) => eprintln!("owned terminal fixture cleanup worker unavailable"),
        }
    }
}

struct SelfCpu {
    wall: Instant,
    seconds: f64,
}
impl SelfCpu {
    fn now() -> Self {
        let mut raw = std::mem::MaybeUninit::<libc::rusage>::zeroed();
        // SAFETY: writable rusage storage, querying only this owned process.
        assert_eq!(
            unsafe { libc::getrusage(libc::RUSAGE_SELF, raw.as_mut_ptr()) },
            0
        );
        // SAFETY: the successful call initialized the entire result record.
        let usage = unsafe { raw.assume_init() };
        Self {
            wall: Instant::now(),
            seconds: usage.ru_utime.tv_sec as f64
                + usage.ru_stime.tv_sec as f64
                + (usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) as f64 / 1_000_000.0,
        }
    }
    fn percent_since(&self, earlier: &Self) -> f64 {
        100.0 * (self.seconds - earlier.seconds)
            / self.wall.duration_since(earlier.wall).as_secs_f64()
    }
}

async fn tail_with(
    service: &SessionService,
    id: &str,
    marker: &[u8],
) -> nac_core::session_service::UserTerminalOutputPage {
    tokio::time::timeout(Duration::from_secs(15), async {
        let mut offset = 0;
        loop {
            let page = service
                .read_user_terminal_output(id, offset, MAX_PAGE_BYTES)
                .await
                .unwrap();
            assert!(page.bytes.len() <= MAX_PAGE_BYTES);
            assert!(page.retained_end - page.retained_start <= RETAINED_WINDOW_BYTES as u64);
            if page
                .bytes
                .windows(marker.len())
                .any(|bytes| bytes == marker)
            {
                break page;
            }
            offset = page
                .retained_end
                .saturating_sub(MAX_PAGE_BYTES as u64)
                .max(page.retained_start);
            service
                .wait_for_user_terminal_output(id, page.retained_end, 100)
                .await
                .unwrap();
        }
    })
    .await
    .expect("finite fixture output must reach its complete marker")
}

async fn settle(service: &SessionService, id: &str) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = service.user_terminal_status(id).await.unwrap();
            if !status.alive && status.exit_code.is_some() && status.output_complete {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned cleanup and collector EOF must settle independently")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn finite_noisy_output_keeps_pending_frames_controls_and_retention_bounded() {
    let fixture = Fixture::new();
    let (service, id) = launch(&fixture, "session").await;
    let _cleanup = OwnedTerminals(Arc::clone(&service));
    let quiet = fixture
        .manager
        .session_terminals()
        .open_user("session", uuid::Uuid::new_v4(), 80, 24)
        .await
        .unwrap()
        .id;
    // Disable only fixture echo/prompt controls. The full LF terminates setup;
    // Linux Readline otherwise emits bracketed-paste bytes after an empty PS1.
    service.write_user_terminal_input(&id,
        b"stty -echo -onlcr; PS1=; PROMPT_COMMAND=; bind 'set enable-bracketed-paste off' 2>/dev/null; head -c 8192 /dev/zero | tr '\\000' S; printf 'SEED-%s\\n' READY\r"
    ).await.unwrap();
    tail_with(&service, &id, b"SEED-READY\n").await;
    let terminals = fixture.manager.session_terminals();
    let (slow, _) = terminals.attach_user("session", &id, 4096).await.unwrap();
    let (fast, _) = terminals
        .attach_user("session", &id, MAX_PAGE_BYTES)
        .await
        .unwrap();
    let pending = terminals
        .pull_user("session", &id, slow, None, 0)
        .await
        .unwrap();
    assert_eq!(pending.page.bytes.len(), 4096);
    let fast_seed = terminals
        .pull_user("session", &id, fast, None, 0)
        .await
        .unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let fast_bytes = Arc::new(AtomicU64::new(0));
    let fast_manager = fixture.manager.clone();
    let fast_id = id.clone();
    let fast_stop = Arc::clone(&stop);
    let read_bytes = Arc::clone(&fast_bytes);
    let reader = tokio::spawn(async move {
        let mut ack = Some(RenderAcknowledgement {
            offset: fast_seed.page.next_offset,
            reset: fast_seed.page.gap,
        });
        while !fast_stop.load(Ordering::SeqCst) {
            let frame = fast_manager
                .session_terminals()
                .pull_user("session", &fast_id, fast, ack, 100)
                .await
                .unwrap();
            assert!(frame.page.bytes.len() <= MAX_PAGE_BYTES);
            read_bytes.fetch_add(frame.page.bytes.len() as u64, Ordering::SeqCst);
            ack = frame.requires_ack.then_some(RenderAcknowledgement {
                offset: frame.page.next_offset,
                reset: frame.page.gap,
            });
            if frame.terminal.output_complete {
                break;
            }
        }
    });
    let idle_start = SelfCpu::now();
    tokio::time::sleep(Duration::from_millis(500)).await;
    let idle_end = SelfCpu::now();
    // Direct sessions use for_direct() defaults; worker configuration cannot
    // silently change this window. Derive the finite 12 MiB load from it.
    let emitted = RETAINED_WINDOW_BYTES * 3 / 2;
    let heavy_start = SelfCpu::now();
    terminals
        .input_user(
            "session",
            &id,
            format!("head -c {emitted} /dev/zero | tr '\\000' N; printf 'PRESSURE-%s\\n' DONE\r")
                .as_bytes(),
        )
        .await
        .unwrap();
    let controls_started = Instant::now();
    let status_started = Instant::now();
    tokio::time::timeout(Duration::from_millis(500), async {
        assert!(terminals.user_status("session", &id).await.unwrap().alive);
        assert!(
            terminals
                .user_status("session", &quiet)
                .await
                .unwrap()
                .alive
        );
    })
    .await
    .expect("cached status must stay responsive under output pressure");
    let status_elapsed = status_started.elapsed();
    let input_started = Instant::now();
    tokio::time::timeout(
        Duration::from_millis(500),
        terminals.input_user("session", &id, b"printf 'INPUT-%s\\n' SEEN\r"),
    )
    .await
    .expect("input delivery to PTY must stay responsive")
    .unwrap();
    let input_elapsed = input_started.elapsed();
    let resize_started = Instant::now();
    tokio::time::timeout(
        Duration::from_millis(500),
        terminals.resize_user("session", &id, 91, 31),
    )
    .await
    .expect("resize must stay responsive under output pressure")
    .unwrap();
    let resize_elapsed = resize_started.elapsed();
    let tail = tail_with(&service, &id, b"PRESSURE-DONE\n").await;
    assert!(tail.retained_start > pending.page.next_offset);
    assert!(tail.retained_end >= emitted as u64);
    tail_with(&service, &id, b"INPUT-SEEN\n").await;
    let heavy_end = SelfCpu::now();
    assert!(fast_bytes.load(Ordering::SeqCst) >= MAX_PAGE_BYTES as u64);
    let replay = terminals
        .pull_user("session", &id, slow, None, 0)
        .await
        .unwrap();
    assert_eq!(replay.page.bytes, pending.page.bytes);
    assert_eq!(replay.page.offset, pending.page.offset);
    assert_eq!(replay.page.next_offset, pending.page.next_offset);
    assert_eq!(replay.terminal.alive, pending.terminal.alive);
    assert_eq!(replay.terminal.exit_code, pending.terminal.exit_code);
    assert_eq!(
        replay.terminal.output_complete,
        pending.terminal.output_complete
    );
    let gap = terminals
        .pull_user(
            "session",
            &id,
            slow,
            Some(RenderAcknowledgement {
                offset: pending.page.next_offset,
                reset: false,
            }),
            0,
        )
        .await
        .unwrap();
    assert!(gap.page.gap && gap.requires_ack && gap.page.bytes.is_empty());
    let resumed = terminals
        .pull_user(
            "session",
            &id,
            slow,
            Some(RenderAcknowledgement {
                offset: gap.page.next_offset,
                reset: true,
            }),
            0,
        )
        .await
        .unwrap();
    assert!(!resumed.page.gap && !resumed.page.bytes.is_empty());
    assert!(resumed.page.bytes.len() <= 4096);
    stop.store(true, Ordering::SeqCst);
    let close_started = Instant::now();
    tokio::time::timeout(
        Duration::from_secs(1),
        fixture.manager.terminate_terminal("session", &id),
    )
    .await
    .expect("exact close must remain responsive with pending frames")
    .unwrap();
    let close_elapsed = close_started.elapsed();
    tokio::time::timeout(Duration::from_secs(2), reader)
        .await
        .unwrap()
        .unwrap();
    settle(&service, &id).await;
    assert!(service.user_terminal_status(&quiet).await.unwrap().alive);
    assert!(!service
        .read_user_terminal_output(&id, tail.retained_start, 4096)
        .await
        .unwrap()
        .bytes
        .is_empty());
    fixture
        .manager
        .terminate_terminal("session", &quiet)
        .await
        .unwrap();
    settle(&service, &quiet).await;
    let blockers = fixture
        .manager
        .managed_upgrade_blockers_async()
        .await
        .unwrap();
    assert!(blockers.iter().all(|blocker| blocker.kind
        != nac_core::store::ManagedBlockerKind::TerminalProcess
        && blocker.kind != nac_core::store::ManagedBlockerKind::ResourceLease));
    eprintln!("owned NAC fixture process CPU (driver included, producers excluded): idle={:.2}% heavy={:.2}%; finite_bytes={emitted} fast_read={} status={status_elapsed:?} input={input_elapsed:?} resize={resize_elapsed:?} close={close_elapsed:?} controls_total={:?}", idle_end.percent_since(&idle_start), heavy_end.percent_since(&heavy_start), fast_bytes.load(Ordering::SeqCst), controls_started.elapsed());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repeated_observer_seat_churn_releases_capacity_without_settling_shell() {
    let fixture = Fixture::new();
    let (service, id) = launch(&fixture, "session").await;
    let _cleanup = OwnedTerminals(Arc::clone(&service));
    let terminals = fixture.manager.session_terminals();
    for _ in 0..64 {
        let mut seats = Vec::new();
        for _ in 0..4 {
            seats.push(terminals.attach_user("session", &id, 4096).await.unwrap().0);
        }
        assert!(matches!(
            terminals.attach_user("session", &id, 4096).await,
            Err(crate::application::terminal_observation::TerminalApplicationError::Busy)
        ));
        for seat in seats {
            terminals.detach_user("session", &id, seat).await.unwrap();
        }
        assert!(terminals.user_status("session", &id).await.unwrap().alive);
    }
    let close_started = Instant::now();
    tokio::time::timeout(
        Duration::from_secs(1),
        fixture.manager.terminate_terminal("session", &id),
    )
    .await
    .expect("seat churn must not delay exact close")
    .unwrap();
    settle(&service, &id).await;
    eprintln!(
        "observer churn: 256 admitted+detached seats, close={:?}",
        close_started.elapsed()
    );
}
