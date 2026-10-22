use super::*;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn shell(script: &str, budget: Duration) -> NativePty {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", script]);
    NativePty::spawn_with_closed_fds(command, 24, 80, Instant::now() + budget).unwrap()
}
async fn through(output: &mut NativePtyOutput, terminator: u8) -> Vec<u8> {
    tokio::time::timeout(Duration::from_secs(4), async {
        let mut out = Vec::new();
        loop {
            let byte = output.read_u8().await.unwrap();
            out.push(byte);
            if byte == terminator {
                return out;
            }
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn actual_controlling_terminal_preserves_input_and_reaps_descendants() {
    let NativePty { mut input, mut output, process } = shell(
        "test -t 0 && test -t 1 && test -t 2 || exit 91; : </dev/tty || exit 92; /bin/stty -echo; printf READY:; IFS= read -r value; printf 'got:%s\n' \"$value\"; /bin/sleep 30 & exit 7",
        Duration::from_secs(6),
    );
    assert_eq!(through(&mut output, b':').await, b"READY:");
    input.write_all(b"payload\n").await.unwrap();
    let mut out = Vec::new();
    let (status, read) = tokio::time::timeout(Duration::from_secs(4), async {
        tokio::join!(process.wait(), output.read_to_end(&mut out))
    })
    .await
    .unwrap();
    read.unwrap();
    assert_eq!(status.unwrap().code(), Some(7));
    assert_eq!(out, b"got:payload\r\n");
    assert!(!process.snapshot().cleanup_pending);
}

#[tokio::test]
async fn resize_result_reflects_actual_slave_dimensions() {
    let NativePty {
        mut input,
        mut output,
        process,
    } = shell(
        "/bin/stty -echo; /bin/stty size; IFS= read -r value; /bin/stty size",
        Duration::from_secs(6),
    );
    assert_eq!(through(&mut output, b'\n').await, b"24 80\r\n");
    assert!(process.resize(0, 137).is_err());
    process.resize(47, 137).unwrap();
    input.write_all(b"next\n").await.unwrap();
    let mut out = Vec::new();
    output.read_to_end(&mut out).await.unwrap();
    assert!(process.wait().await.unwrap().success());
    assert_eq!(out, b"47 137\r\n");
}

#[tokio::test]
async fn shutdown_closes_logical_input_without_injecting_terminal_characters() {
    let NativePty {
        mut input,
        mut output,
        process,
    } = shell(
        "/bin/stty -echo; printf READY:; IFS= read -r value; printf unexpected",
        Duration::from_secs(6),
    );
    assert_eq!(through(&mut output, b':').await, b"READY:");
    input.shutdown().await.unwrap();
    assert_eq!(
        input.write_all(b"forbidden\n").await.unwrap_err().kind(),
        io::ErrorKind::BrokenPipe
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(60), process.wait())
            .await
            .is_err()
    );
    assert!(process.snapshot().cleanup_pending);
    process
        .terminate_until(Instant::now() + Duration::from_secs(4))
        .await
        .unwrap();
    let mut out = Vec::new();
    output.read_to_end(&mut out).await.unwrap();
    assert!(!out
        .windows(b"unexpected".len())
        .any(|bytes| bytes == b"unexpected"));
    assert!(!process.snapshot().cleanup_pending);
}

#[tokio::test]
async fn environment_and_inherited_control_descriptors_are_excluded_at_exec() {
    // A real parent descriptor without CLOEXEC, above ordinary shell scratch FDs.
    let canary = File::open("/dev/null").unwrap();
    // SAFETY: the source is live; fcntl returns a new unique parent descriptor.
    let high = unsafe { libc::fcntl(canary.as_raw_fd(), libc::F_DUPFD, 128) };
    assert!(high >= 128);
    // SAFETY: fcntl returned the unique descriptor just checked above.
    let high = unsafe { File::from_raw_fd(high) };
    let mut command = Command::new("/bin/sh");
    command.args([
        "-c",
        &format!(
            "test ! -e /proc/self/fd/{} || exit 93; exec /usr/bin/env",
            high.as_raw_fd()
        ),
    ]);
    command.env("NAC_PTY_EXPLICIT", "value");
    let NativePty {
        mut output,
        process,
        ..
    } = NativePty::spawn_with_closed_fds(command, 24, 80, Instant::now() + Duration::from_secs(6))
        .unwrap();
    let mut out = Vec::new();
    output.read_to_end(&mut out).await.unwrap();
    assert!(process.wait().await.unwrap().success());
    // /bin/sh may add PWD to an explicitly empty environment.
    let text = String::from_utf8(out).unwrap();
    assert!(text.lines().any(|line| line == "NAC_PTY_EXPLICIT=value"));
    assert!(text
        .lines()
        .all(|line| line == "NAC_PTY_EXPLICIT=value" || line.starts_with("PWD=")));
    // SAFETY: this only inspects the still-live parent descriptor flags.
    assert_eq!(
        unsafe { libc::fcntl(high.as_raw_fd(), libc::F_GETFD) } & libc::FD_CLOEXEC,
        0
    );
}

#[test]
fn original_cutoff_reaps_while_caller_runtime_is_unpolled() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let pty = runtime.block_on(async { shell("exec /bin/sleep 30", Duration::from_millis(150)) });
    let observed_until = std::time::Instant::now() + Duration::from_secs(4);
    while pty.process.snapshot().cleanup_pending && std::time::Instant::now() < observed_until {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!pty.process.snapshot().cleanup_pending);
}

#[tokio::test]
async fn cancelled_wait_and_dropped_control_retain_cleanup_with_ports_alive() {
    let NativePty {
        input,
        mut output,
        process,
    } = shell(
        "/bin/stty -echo; printf READY:; exec /bin/sleep 30",
        Duration::from_secs(6),
    );
    assert_eq!(through(&mut output, b':').await, b"READY:");
    assert!(
        tokio::time::timeout(Duration::from_millis(20), process.wait())
            .await
            .is_err()
    );
    assert!(process.snapshot().cleanup_pending);
    drop(process);
    let mut out = Vec::new();
    tokio::time::timeout(Duration::from_secs(4), output.read_to_end(&mut out))
        .await
        .unwrap()
        .unwrap();
    // Keep the actual input port alive through EOF: control ownership, rather
    // than closing the last master descriptor, must have stopped the child.
    drop(input);
}
