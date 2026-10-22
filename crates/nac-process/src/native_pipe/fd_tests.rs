use super::*;
use std::fs::File;
use std::io::Read;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const PROBE_FD: &str = "NAC_NATIVE_PIPE_FD_PROBE";

// This exact test runs again only after a real exec of the test executable.
#[test]
fn exec_probe() {
    let Ok(raw) = std::env::var(PROBE_FD) else {
        return;
    };
    let descriptor: i32 = raw.parse().unwrap();
    // SAFETY: F_GETFD observes the inherited descriptor without dereferencing.
    assert_eq!(unsafe { libc::fcntl(descriptor, libc::F_GETFD) }, -1);
    assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::EBADF));
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input).unwrap();
    assert_eq!(input, b"stdio-input");
    assert_eq!(std::env::vars_os().count(), 1);
    println!("exec-fd-barrier-stdout");
    eprintln!("exec-fd-barrier-stderr");
}

#[tokio::test]
async fn exec_barrier_closes_inheritance_preserves_stdio_and_parent_descriptor() {
    let file = File::open("/dev/null").unwrap();
    // SAFETY: duplicating our live file at a high descriptor avoids reuse by
    // test-harness startup. F_DUPFD deliberately creates a non-CLOEXEC canary.
    let descriptor = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_DUPFD, 128) };
    assert!(descriptor >= 128);
    // SAFETY: successful F_DUPFD above transfers this new descriptor to us.
    let descriptor = unsafe { OwnedFd::from_raw_fd(descriptor) };
    // SAFETY: F_GETFD observes our own live descriptor.
    assert_eq!(
        unsafe { libc::fcntl(descriptor.as_raw_fd(), libc::F_GETFD) },
        0
    );
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "native_pipe::fd_tests::exec_probe",
            "--nocapture",
        ])
        .env(PROBE_FD, descriptor.as_raw_fd().to_string());
    let NativePipe {
        mut stdin,
        mut stdout,
        mut stderr,
        process,
    } = NativePipe::spawn_with_closed_fds(command, Instant::now() + Duration::from_secs(5))
        .unwrap();
    stdin.write_all(b"stdio-input").await.unwrap();
    drop(stdin);
    let mut out = Vec::new();
    let mut err = Vec::new();
    let (status, out_read, err_read) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(
            process.wait(),
            stdout.read_to_end(&mut out),
            stderr.read_to_end(&mut err)
        )
    })
    .await
    .unwrap();
    out_read.unwrap();
    err_read.unwrap();
    assert!(
        status.unwrap().success(),
        "exec probe failed: stdout={} stderr={}",
        String::from_utf8_lossy(&out),
        String::from_utf8_lossy(&err)
    );
    assert!(out
        .windows(23)
        .any(|part| part == b"exec-fd-barrier-stdout\n"));
    assert!(err
        .windows(23)
        .any(|part| part == b"exec-fd-barrier-stderr\n"));
    // The post-fork barrier must not change the parent's open-file table.
    // SAFETY: F_GETFD observes our still-owned canary.
    assert_eq!(
        unsafe { libc::fcntl(descriptor.as_raw_fd(), libc::F_GETFD) },
        0
    );
    assert!(!process.snapshot().cleanup_pending);
}

#[tokio::test]
async fn unavailable_or_denied_descriptor_barrier_refuses_exec() {
    for error_code in [libc::ENOSYS, libc::EPERM] {
        let mut command = Command::new("/bin/true");
        // SAFETY: this test installs a stack-only seccomp filter in the child
        // before the production barrier. The filter denies only close_range;
        // prctl copies it synchronously. No parent policy or shared state changes.
        unsafe {
            command.pre_exec(move || {
                let mut filter = [
                    libc::sock_filter {
                        code: (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16,
                        jt: 0,
                        jf: 0,
                        k: std::mem::offset_of!(libc::seccomp_data, nr) as u32,
                    },
                    libc::sock_filter {
                        code: (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16,
                        jt: 0,
                        jf: 1,
                        k: libc::SYS_close_range as u32,
                    },
                    libc::sock_filter {
                        code: (libc::BPF_RET | libc::BPF_K) as u16,
                        jt: 0,
                        jf: 0,
                        k: libc::SECCOMP_RET_ERRNO | error_code as u32,
                    },
                    libc::sock_filter {
                        code: (libc::BPF_RET | libc::BPF_K) as u16,
                        jt: 0,
                        jf: 0,
                        k: libc::SECCOMP_RET_ALLOW,
                    },
                ];
                let program = libc::sock_fprog {
                    len: 4,
                    filter: filter.as_mut_ptr(),
                };
                if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0
                    || libc::prctl(
                        libc::PR_SET_SECCOMP,
                        libc::SECCOMP_MODE_FILTER,
                        &program as *const libc::sock_fprog,
                    ) != 0
                {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        let error = match NativePipe::spawn_with_closed_fds(command, deadline) {
            Err(error) => error,
            Ok(pipe) => {
                pipe.process.terminate_until(deadline).await.unwrap();
                panic!("failed descriptor barrier must refuse exec");
            }
        };
        assert_eq!(error.raw_os_error(), Some(error_code));
    }
}

#[test]
fn descriptor_barrier_preserves_exec_error_reporting() {
    let path = format!("/nac-exec-fd-no-such-program-{}", uuid::Uuid::new_v4());
    match NativePipe::spawn_with_closed_fds(
        Command::new(path),
        Instant::now() + Duration::from_secs(5),
    ) {
        Err(error) => assert_eq!(error.raw_os_error(), Some(libc::ENOENT)),
        Ok(_) => panic!("nonexistent program cannot exec"),
    }
}
