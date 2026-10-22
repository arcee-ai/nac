use super::*;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn shell(script: &str, budget: Duration) -> NativePipe {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", script]);
    NativePipe::spawn(command, Instant::now() + budget).unwrap()
}

#[tokio::test]
async fn pipe_ports_preserve_bytes_and_wait_includes_descendant_cleanup() {
    let NativePipe {
        mut stdin,
        mut stdout,
        mut stderr,
        process,
    } = shell(
        "IFS= read -r value; printf '%s' \"$value\"; printf error >&2; /bin/sleep 30 & exit 7",
        Duration::from_secs(5),
    );
    stdin.write_all(b"input\n").await.unwrap();
    drop(stdin);
    let mut out = Vec::new();
    let mut err = Vec::new();
    let (status, _, _) = tokio::time::timeout(Duration::from_secs(4), async {
        tokio::join!(
            process.wait(),
            stdout.read_to_end(&mut out),
            stderr.read_to_end(&mut err)
        )
    })
    .await
    .unwrap();
    assert_eq!(status.unwrap().code(), Some(7));
    assert_eq!(out, b"input");
    assert_eq!(err, b"error");
    assert!(!process.snapshot().cleanup_pending);
}

#[tokio::test]
async fn pipe_environment_contains_only_explicit_entries() {
    let mut command = Command::new("/usr/bin/env");
    command.env("NAC_PIPE_EXPLICIT", "value");
    let NativePipe {
        stdin,
        mut stdout,
        process,
        ..
    } = NativePipe::spawn(command, Instant::now() + Duration::from_secs(5)).unwrap();
    drop(stdin);
    let mut out = Vec::new();
    stdout.read_to_end(&mut out).await.unwrap();
    assert!(process.wait().await.unwrap().success());
    assert_eq!(out, b"NAC_PIPE_EXPLICIT=value\n");
}

#[tokio::test]
async fn original_cutoff_stops_a_pipe_even_without_a_waiter() {
    let pipe = shell("exec /bin/sleep 30", Duration::from_millis(100));
    tokio::time::timeout(Duration::from_secs(4), async {
        while pipe.process.snapshot().cleanup_pending {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(!pipe.process.wait().await.unwrap().success());
}

#[tokio::test]
async fn cancelled_wait_keeps_the_original_cutoff_and_last_drop_cleans_up() {
    let mut pipe = shell("exec /bin/sleep 30", Duration::from_secs(5));
    assert!(
        tokio::time::timeout(Duration::from_millis(10), pipe.process.wait())
            .await
            .is_err()
    );
    assert!(pipe.process.snapshot().cleanup_pending);
    drop(pipe.process);
    drop(pipe.stdin);
    let mut out = Vec::new();
    tokio::time::timeout(Duration::from_secs(4), pipe.stdout.read_to_end(&mut out))
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn expired_construction_does_not_spawn() {
    let command = Command::new("/bin/false");
    assert!(NativePipe::spawn(command, Instant::now()).is_err());
}

#[test]
fn synchronous_stop_reaps_with_all_handles_retained_and_no_caller_runtime_progress() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let pipe = runtime.block_on(async { shell("exec /bin/sleep 30", Duration::from_secs(5)) });
    // All pipe ports and the owner stay alive. This caller never polls a wait
    // or terminate future, and its current-thread runtime stays unpolled.
    std::thread::scope(|scope| {
        scope
            .spawn(|| pipe.process.request_stop_until(Instant::now()))
            .join()
            .unwrap();
    });
    let observed_until = std::time::Instant::now() + Duration::from_secs(4);
    while pipe.process.snapshot().cleanup_pending && std::time::Instant::now() < observed_until {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!pipe.process.snapshot().cleanup_pending);
    assert!(!runtime.block_on(pipe.process.wait()).unwrap().success());
}

#[tokio::test]
async fn delay_before_exec_cannot_launch_after_the_original_cutoff() {
    let mut command = Command::new("/bin/false");
    // SAFETY: nanosleep is async-signal-safe, with initialized stack storage;
    // this disposable child delays before the owner's final pre-exec check.
    unsafe {
        command.pre_exec(|| {
            let delay = libc::timespec {
                tv_sec: 0,
                tv_nsec: 100_000_000,
            };
            if libc::nanosleep(&delay, std::ptr::null_mut()) != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    assert!(NativePipe::spawn(command, Instant::now() + Duration::from_millis(20)).is_err());
}

#[tokio::test]
async fn a_tightened_cleanup_cutoff_wakes_an_existing_pipe_waiter() {
    let pipe = shell("exec /bin/sleep 30", Duration::from_secs(5));
    pipe.process.owner.set_inspection_failure_for_test(true);
    let mut wait = Box::pin(pipe.process.wait());
    std::future::poll_fn(|cx| {
        assert!(std::future::Future::poll(wait.as_mut(), cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    assert!(pipe.process.terminate_until(Instant::now()).await.is_err());
    let result = tokio::time::timeout(Duration::from_millis(200), wait).await;
    pipe.process.owner.set_inspection_failure_for_test(false);
    assert!(
        result.is_ok(),
        "pipe wait must share the earliest retained cutoff"
    );
    assert!(result.unwrap().is_err());
}
