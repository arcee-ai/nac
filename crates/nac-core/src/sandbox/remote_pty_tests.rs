//! CLI construction and real local-PTY characterization, not live remote acceptance.
use super::podman::{SANDBOX_KILL_WRAPPER, SANDBOX_PTY_WRAPPER};
use super::{ExecutionBackend, SandboxSession, SandboxSpec, SshBackend};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::ffi::OsString;
use std::path::Path;

#[test]
fn human_transport_is_transparent_without_changing_model_invocations() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let envs = vec![("TERM".into(), "xterm-256color".into())];
    for backend in [
        ExecutionBackend::Ssh(SshBackend::new(
            "user@qualified-later".into(),
            "/remote/work".into(),
        )),
        ExecutionBackend::Sandbox(SandboxSession::new_for_test(SandboxSpec::default())),
    ] {
        let (human, pidfile) = backend.user_terminal_pty_command(
            "exec bash -i",
            Some(Path::new("/remote/work")),
            &envs,
        );
        let (model, _) =
            backend.terminal_pty_command("exec bash -i", Some(Path::new("/remote/work")), &envs);
        assert!(
            pidfile.is_some(),
            "remote cleanup identity must not disappear"
        );
        let args = human.get_argv();
        match &backend {
            ExecutionBackend::Ssh(_) => {
                assert_eq!(args[0], OsString::from("ssh"));
                assert!(args
                    .windows(2)
                    .any(|w| w == [OsString::from("-e"), OsString::from("none")]));
                assert!(!model.get_argv().contains(&OsString::from("-e")));
                assert!(args
                    .iter()
                    .any(|arg| arg.to_string_lossy().contains("user@qualified-later")));
                assert!(args
                    .last()
                    .unwrap()
                    .to_string_lossy()
                    .contains("cd '/remote/work'"));
            }
            ExecutionBackend::Sandbox(_) => {
                assert_eq!(
                    &args[..3],
                    &[
                        OsString::from("podman"),
                        OsString::from("exec"),
                        OsString::from("--detach-keys=")
                    ]
                );
                assert!(!model.get_argv().contains(&OsString::from("--detach-keys=")));
                assert!(args.contains(&OsString::from("--workdir")));
                assert!(args.contains(&OsString::from("/remote/work")));
                assert!(args.contains(&OsString::from("TERM=xterm-256color")));
                assert!(args.contains(&OsString::from("-i")));
                assert!(args.contains(&OsString::from("-t")));
            }
            ExecutionBackend::Local { .. } => panic!("construction must not switch to Local"),
        }
    }
}

#[cfg(unix)]
mod foreground {
    use super::*;
    use std::io::{Read, Write};
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{Duration, Instant};

    struct Fixture {
        root: PathBuf,
        pidfile: PathBuf,
        master: Option<Box<dyn portable_pty::MasterPty + Send>>,
        writer: Option<Box<dyn Write + Send>>,
        reader: Option<Box<dyn Read + Send>>,
        child: Box<dyn portable_pty::Child + Send + Sync>,
        output: Vec<u8>,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("nac-remote-foreground-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            // Force the portable fallback on Linux as well as macOS. No VM or
            // external utility installation is required for this regression.
            let setsid = root.join("setsid");
            std::fs::write(&setsid, "#!/bin/sh\nexit 1\n").unwrap();
            std::fs::set_permissions(&setsid, std::fs::Permissions::from_mode(0o700)).unwrap();
            let pidfile = root.join("supervisor.pid");
            let pair = NativePtySystem::default()
                .openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .unwrap();
            let mut command = CommandBuilder::new("bash");
            command.args([
                "-c",
                SANDBOX_PTY_WRAPPER,
                "nac-pty",
                "printf '__READY__\\n'; exec bash --noprofile --norc -i",
            ]);
            command.arg(&pidfile);
            command.arg("pty");
            command.env("PATH", format!("{}:/usr/bin:/bin", root.display()));
            command.env("BASH_SILENCE_DEPRECATION_WARNING", "1");
            let fd = pair.master.as_raw_fd().unwrap();
            // This descriptor belongs only to the disposable fixture. Its
            // clones share the flags and are all closed before child reaping.
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            assert!(flags >= 0);
            assert_eq!(
                unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) },
                0
            );
            let reader = pair.master.try_clone_reader().unwrap();
            let writer = pair.master.take_writer().unwrap();
            let child = pair.slave.spawn_command(command).unwrap();
            drop(pair.slave);
            Self {
                root,
                pidfile,
                master: Some(pair.master),
                writer: Some(writer),
                reader: Some(reader),
                child,
                output: Vec::new(),
            }
        }

        fn send(&mut self, bytes: &[u8]) {
            let writer = self.writer.as_mut().unwrap();
            writer.write_all(bytes).unwrap();
            writer.flush().unwrap();
        }

        fn expect(&mut self, marker: &[u8]) {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !self
                .output
                .windows(marker.len())
                .any(|bytes| bytes == marker)
            {
                assert!(
                    Instant::now() < deadline,
                    "missing {:?}; output {:?}",
                    String::from_utf8_lossy(marker),
                    String::from_utf8_lossy(&self.output)
                );
                let mut bytes = [0; 1024];
                match self.reader.as_mut().unwrap().read(&mut bytes) {
                    Ok(0) => panic!("PTY closed before marker {:?}", marker),
                    Ok(n) => self.output.extend_from_slice(&bytes[..n]),
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                        ) =>
                    {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("PTY read failed: {error}"),
                }
                assert!(self.output.len() <= 1024 * 1024);
            }
        }

        fn cleanup(&self) -> bool {
            let Ok(mut cleanup) = Command::new("sh")
                .args(["-c", SANDBOX_KILL_WRAPPER, "nac-kill"])
                .arg(&self.pidfile)
                .spawn()
            else {
                return false;
            };
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                match cleanup.try_wait() {
                    Ok(Some(status)) => return status.success(),
                    Err(_) => {
                        let _ = cleanup.kill();
                        return false;
                    }
                    Ok(None) => {}
                }
                if Instant::now() >= deadline {
                    let _ = cleanup.kill();
                    let reap_deadline = Instant::now() + Duration::from_secs(3);
                    while matches!(cleanup.try_wait(), Ok(None)) && Instant::now() < reap_deadline {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    return false;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        fn close_and_reap(&mut self) -> bool {
            self.reader.take();
            self.writer.take();
            self.master.take();
            let _ = self.child.kill();
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                match self.child.try_wait() {
                    Ok(Some(_)) => return true,
                    Err(_) => return false,
                    Ok(None) if Instant::now() >= deadline => return false,
                    Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                }
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let cleaned = self.cleanup();
            let reaped = self.close_and_reap();
            let cleaned = cleaned || self.cleanup();
            if cleaned && reaped {
                let _ = std::fs::remove_dir_all(&self.root);
            } else {
                eprintln!(
                    "retained fixture cleanup authority at {}",
                    self.pidfile.display()
                );
            }
        }
    }

    #[test]
    fn pty_fallback_keeps_foreground_geometry_control_bytes_and_cleanup() {
        let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
        let mut fixture = Fixture::new();
        fixture.expect(b"__READY__\r\n");
        fixture
            .send(b"printf '__SIZE__'; stty size; [[ $- = *m* ]] && printf '__MONITOR__on\\n'\r");
        fixture.expect(b"__SIZE__24 80\r\n");
        fixture.expect(b"__MONITOR__on\r\n");
        fixture
            .master
            .as_ref()
            .unwrap()
            .resize(PtySize {
                rows: 31,
                cols: 91,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        fixture.send(b"printf '__NEW_SIZE__'; stty size; printf '__BYTES__\xe9\x9b\xaa\xf0\x9f\x98\x80\\033[31mred\\033[0m\\n'\r");
        fixture.expect(b"__NEW_SIZE__31 91\r\n");
        fixture.expect(b"__BYTES__\xe9\x9b\xaa\xf0\x9f\x98\x80\x1b[31mred\x1b[0m\r\n");
        fixture.send(b"printf '__SLEEPING__\\n'; sleep 30; printf '__INTERRUPTED__\\n'\r");
        fixture.expect(b"__SLEEPING__\r\n");
        fixture.send(b"\x03");
        // Bash may discard the interrupted command list; a fresh command must
        // execute promptly instead of waiting for the thirty-second job.
        fixture.send(b"printf '__INTERRUPTED__\\n'\r");
        fixture.expect(b"__INTERRUPTED__\r\n");
        fixture.send(b"sh -c 'printf \"__JOB_READY__\\n\"; exec sleep 30'\r");
        fixture.expect(b"__JOB_READY__\r\n");
        fixture.send(b"\x1a");
        fixture.expect(b"Stopped");
        fixture.send(b"bg; printf '__BACKGROUND_RESUMED__\\n'\r");
        fixture.expect(b"__BACKGROUND_RESUMED__\r\n");
        // An interactive shell uses a separate foreground/job process group.
        // Explicit remote cleanup must still find it as a verified descendant.
        let child_pidfile = fixture.root.join("background.pid");
        fixture.send(
            format!(
                "sleep 30 & printf %s $! > '{}'; printf '__BACKGROUND__\\n'\r",
                child_pidfile.display()
            )
            .as_bytes(),
        );
        fixture.expect(b"__BACKGROUND__\r\n");
        let pid = std::fs::read_to_string(child_pidfile)
            .unwrap()
            .parse::<libc::pid_t>()
            .unwrap();
        assert_eq!(unsafe { libc::kill(pid, 0) }, 0);
        let cleaned = fixture.cleanup();
        if !cleaned {
            // Portable process inspection can be uncertain after a signal;
            // that must retain retry authority rather than report success.
            assert!(fixture.pidfile.exists(), "failed cleanup lost its record");
        }
        assert!(
            fixture.close_and_reap(),
            "fixture child was not reaped promptly"
        );
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let live = unsafe { libc::kill(pid, 0) == 0 };
            #[cfg(target_os = "linux")]
            let live = live
                && std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| {
                    !stat
                        .rsplit_once(") ")
                        .is_some_and(|(_, fields)| fields.starts_with("Z "))
                });
            if !live {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "verified background descendant survived cleanup"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
