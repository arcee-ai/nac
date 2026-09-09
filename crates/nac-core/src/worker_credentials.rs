//! Private native-credential transport for managed workers.
//!
//! The worker endpoint is inherited only across the `__worker` exec, marked
//! close-on-exec before any MCP transport is constructed, and backed by an
//! anonymous Unix socket rather than stdin or a pipe. The worker announces
//! readiness only after MCP construction; credential bytes are not written
//! before that handshake.

use std::io;

use anyhow::{anyhow, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

const MANAGED_WORKER_CREDENTIAL_PREFIX: &[u8] = b"__NAC_NATIVE_CREDENTIALS_V2__";
const MANAGED_WORKER_CREDENTIAL_READY: &[u8] = b"__NAC_NATIVE_CREDENTIALS_READY_V2__";
const MAX_CREDENTIAL_FRAME_BYTES: usize = 64 * 1024;

/// Prevent same-UID descendants from inspecting this process through ordinary
/// Linux ptrace/procfs interfaces, and prevent later execs from acquiring new
/// privilege. A process with pre-existing `CAP_SYS_PTRACE` remains outside this
/// in-process boundary and must be excluded by deployment policy.
pub fn restrict_same_uid_inspection() -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: both prctl operations take integer flags and no pointers.
        if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // Executing an ordinary binary resets dumpability, so this function is
        // called independently by the server and each managed worker.
        // SAFETY: PR_SET_DUMPABLE takes an integer flag and no pointers.
        if unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ManagedWorkerNativeCredentials {
    exa_api_key: Option<String>,
}

impl ManagedWorkerNativeCredentials {
    pub(crate) fn from_process_environment() -> io::Result<Self> {
        let exa_api_key = std::env::var_os(crate::model::EXA_API_KEY_ENV)
            .map(|value| {
                value.into_string().map_err(|_| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        "EXA_API_KEY is not valid Unicode",
                    )
                })
            })
            .transpose()?
            .filter(|value| !value.trim().is_empty());
        Ok(Self { exa_api_key })
    }

    pub(crate) fn exact_redactions(&self) -> Vec<String> {
        self.exa_api_key.iter().cloned().collect()
    }

    pub(crate) fn into_exa_api_key(self) -> Option<String> {
        self.exa_api_key
    }

    #[cfg(test)]
    pub(crate) fn for_test(exa_api_key: Option<&str>) -> Self {
        Self {
            exa_api_key: exa_api_key.map(str::to_string),
        }
    }

    fn encode_control_frame(&self) -> io::Result<CredentialFrame> {
        let mut payload = serde_json::to_vec(self)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let mut frame =
            Vec::with_capacity(MANAGED_WORKER_CREDENTIAL_PREFIX.len() + payload.len() + 1);
        frame.extend_from_slice(MANAGED_WORKER_CREDENTIAL_PREFIX);
        frame.extend_from_slice(&payload);
        payload.fill(0);
        frame.push(b'\n');
        if frame.len() > MAX_CREDENTIAL_FRAME_BYTES {
            frame.fill(0);
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "managed worker credential control frame is too large",
            ));
        }
        Ok(CredentialFrame(frame))
    }

    fn decode_control_frame(frame: &[u8]) -> Result<Self> {
        let payload = frame
            .strip_suffix(b"\n")
            .and_then(|frame| frame.strip_prefix(MANAGED_WORKER_CREDENTIAL_PREFIX))
            .ok_or_else(|| anyhow!("managed worker credential control frame is invalid"))?;
        serde_json::from_slice(payload)
            .map_err(|_| anyhow!("managed worker credential control frame is invalid"))
    }
}

struct CredentialFrame(Vec<u8>);

impl CredentialFrame {
    fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for CredentialFrame {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::os::fd::{AsRawFd, FromRawFd, RawFd};
    use std::os::unix::net::UnixStream as StdUnixStream;
    use std::os::unix::process::CommandExt;

    pub(crate) struct PreparedWorkerCredentialChannel {
        parent: StdUnixStream,
        child: StdUnixStream,
    }

    pub(crate) struct WorkerCredentialSender {
        stream: tokio::net::UnixStream,
    }

    pub struct ManagedWorkerCredentialReceiver {
        stream: StdUnixStream,
    }

    pub(crate) fn prepare_worker_credential_channel(
        command: &mut Command,
    ) -> io::Result<PreparedWorkerCredentialChannel> {
        let (parent, child) = StdUnixStream::pair()?;
        set_cloexec(parent.as_raw_fd(), true)?;
        set_cloexec(child.as_raw_fd(), true)?;
        let child_fd = child.as_raw_fd();
        command
            .arg("--native-credential-fd")
            .arg(child_fd.to_string());
        // SAFETY: the callback invokes only async-signal-safe `fcntl` calls
        // between fork and exec, and captures only an integer descriptor.
        unsafe {
            command
                .as_std_mut()
                .pre_exec(move || set_cloexec(child_fd, false));
        }
        Ok(PreparedWorkerCredentialChannel { parent, child })
    }

    impl PreparedWorkerCredentialChannel {
        pub(crate) fn into_sender(self) -> io::Result<WorkerCredentialSender> {
            drop(self.child);
            self.parent.set_nonblocking(true)?;
            Ok(WorkerCredentialSender {
                stream: tokio::net::UnixStream::from_std(self.parent)?,
            })
        }
    }

    impl WorkerCredentialSender {
        pub(crate) async fn send_after_ready(
            mut self,
            credentials: &ManagedWorkerNativeCredentials,
        ) -> io::Result<()> {
            let mut ready = vec![0; MANAGED_WORKER_CREDENTIAL_READY.len()];
            self.stream.read_exact(&mut ready).await?;
            if ready != MANAGED_WORKER_CREDENTIAL_READY {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "managed worker credential readiness frame is invalid",
                ));
            }
            let frame = credentials.encode_control_frame()?;
            self.stream.write_all(frame.as_bytes()).await?;
            self.stream.flush().await?;
            self.stream.shutdown().await
        }
    }

    impl ManagedWorkerCredentialReceiver {
        pub fn from_inherited_fd(fd: Option<i32>) -> Result<Self> {
            restrict_same_uid_inspection()
                .map_err(|_| anyhow!("failed to restrict managed worker process inspection"))?;
            let fd =
                fd.ok_or_else(|| anyhow!("managed worker credential descriptor is missing"))?;
            if fd <= libc::STDERR_FILENO {
                return Err(anyhow!("managed worker credential descriptor is invalid"));
            }
            validate_unix_stream(fd)?;
            set_cloexec(fd, true)?;
            // SAFETY: the hidden worker CLI transfers unique ownership of this
            // validated inherited descriptor exactly once.
            let stream = unsafe { StdUnixStream::from_raw_fd(fd) };
            Ok(Self { stream })
        }

        pub(crate) async fn receive_after_mcp(self) -> Result<ManagedWorkerNativeCredentials> {
            self.stream.set_nonblocking(true)?;
            let mut stream = tokio::net::UnixStream::from_std(self.stream)?;
            stream.write_all(MANAGED_WORKER_CREDENTIAL_READY).await?;
            stream.flush().await?;

            let mut frame = Vec::with_capacity(1024);
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream.read(&mut chunk).await?;
                if read == 0 {
                    chunk.fill(0);
                    frame.fill(0);
                    return Err(anyhow!("managed worker credential control channel closed"));
                }
                let newline = chunk[..read].iter().position(|byte| *byte == b'\n');
                let frame_bytes = newline.map_or(&chunk[..read], |index| &chunk[..=index]);
                frame.extend_from_slice(frame_bytes);
                let trailing_bytes = newline.is_some_and(|index| index + 1 != read);
                chunk.fill(0);
                if frame.len() > MAX_CREDENTIAL_FRAME_BYTES {
                    frame.fill(0);
                    return Err(anyhow!(
                        "managed worker credential control frame is too large"
                    ));
                }
                if trailing_bytes {
                    frame.fill(0);
                    return Err(anyhow!(
                        "managed worker credential control frame is invalid"
                    ));
                }
                if newline.is_some() {
                    // The sender half-closes immediately after its one frame.
                    // Require that EOF so trailing bytes split into a later
                    // socket read cannot be mistaken for a valid message.
                    let trailing = stream.read(&mut chunk[..1]).await?;
                    chunk.fill(0);
                    if trailing != 0 {
                        frame.fill(0);
                        return Err(anyhow!(
                            "managed worker credential control frame is invalid"
                        ));
                    }
                    break;
                }
            }
            let decoded = ManagedWorkerNativeCredentials::decode_control_frame(&frame);
            frame.fill(0);
            decoded
        }
    }

    fn set_cloexec(fd: RawFd, enabled: bool) -> io::Result<()> {
        // SAFETY: `fcntl` operates on the supplied integer descriptor without
        // dereferencing pointers. Errors are reported through errno.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        if flags < 0 {
            return Err(io::Error::last_os_error());
        }
        let updated = if enabled {
            flags | libc::FD_CLOEXEC
        } else {
            flags & !libc::FD_CLOEXEC
        };
        // SAFETY: as above; F_SETFD consumes the integer flag value.
        if unsafe { libc::fcntl(fd, libc::F_SETFD, updated) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn validate_unix_stream(fd: RawFd) -> io::Result<()> {
        let mut socket_type: libc::c_int = 0;
        let mut len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
        // SAFETY: both pointers refer to initialized writable storage of `len`
        // bytes, and getsockopt reports errors through errno.
        let result = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_TYPE,
                (&mut socket_type as *mut libc::c_int).cast(),
                &mut len,
            )
        };
        if result < 0 {
            return Err(io::Error::last_os_error());
        }
        if socket_type != libc::SOCK_STREAM {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "managed worker credential descriptor is not a stream socket",
            ));
        }
        // SAFETY: all-zero is a valid initial byte representation for storage
        // that `getsockname` will initialize before it is inspected.
        let mut address: libc::sockaddr_storage = unsafe { std::mem::zeroed() };
        let mut address_len = std::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
        // SAFETY: `address` is writable storage of `address_len` bytes and the
        // descriptor was already established to be a socket.
        let result = unsafe {
            libc::getsockname(
                fd,
                (&mut address as *mut libc::sockaddr_storage).cast(),
                &mut address_len,
            )
        };
        if result < 0 {
            return Err(io::Error::last_os_error());
        }
        if libc::c_int::from(address.ss_family) != libc::AF_UNIX {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "managed worker credential descriptor is not a Unix socket",
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn channel_for_test(
    ) -> io::Result<(WorkerCredentialSender, ManagedWorkerCredentialReceiver)> {
        let (parent, child) = StdUnixStream::pair()?;
        parent.set_nonblocking(true)?;
        Ok((
            WorkerCredentialSender {
                stream: tokio::net::UnixStream::from_std(parent)?,
            },
            ManagedWorkerCredentialReceiver { stream: child },
        ))
    }

    #[cfg(test)]
    pub(super) fn raw_channel_for_test(
    ) -> io::Result<(tokio::net::UnixStream, ManagedWorkerCredentialReceiver)> {
        let (parent, child) = StdUnixStream::pair()?;
        parent.set_nonblocking(true)?;
        Ok((
            tokio::net::UnixStream::from_std(parent)?,
            ManagedWorkerCredentialReceiver { stream: child },
        ))
    }
}

#[cfg(not(unix))]
mod platform {
    use super::*;

    pub(crate) struct PreparedWorkerCredentialChannel;
    pub(crate) struct WorkerCredentialSender;
    pub struct ManagedWorkerCredentialReceiver;

    pub(crate) fn prepare_worker_credential_channel(
        _command: &mut Command,
    ) -> io::Result<PreparedWorkerCredentialChannel> {
        Ok(PreparedWorkerCredentialChannel)
    }

    impl PreparedWorkerCredentialChannel {
        pub(crate) fn into_sender(self) -> io::Result<WorkerCredentialSender> {
            Ok(WorkerCredentialSender)
        }
    }

    impl WorkerCredentialSender {
        pub(crate) async fn send_after_ready(
            self,
            credentials: &ManagedWorkerNativeCredentials,
        ) -> io::Result<()> {
            if credentials.exa_api_key.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "delegated native credentials require a Unix worker host",
                ));
            }
            Ok(())
        }
    }

    impl ManagedWorkerCredentialReceiver {
        pub fn from_inherited_fd(fd: Option<i32>) -> Result<Self> {
            if fd.is_some() {
                return Err(anyhow!(
                    "managed worker credential descriptors are unsupported on this host"
                ));
            }
            Ok(Self)
        }

        pub(crate) async fn receive_after_mcp(self) -> Result<ManagedWorkerNativeCredentials> {
            Ok(ManagedWorkerNativeCredentials::default())
        }
    }
}

pub(crate) use platform::prepare_worker_credential_channel;
pub use platform::ManagedWorkerCredentialReceiver;

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn same_uid_process_inspection_probe_helper() {
        let Some(root) = std::env::var_os("NAC_SAME_UID_INSPECTION_ROOT") else {
            return;
        };
        let target = std::env::var("NAC_SAME_UID_INSPECTION_TARGET").unwrap();
        let target_fd = std::env::var("NAC_SAME_UID_INSPECTION_FD")
            .unwrap()
            .parse::<i32>()
            .unwrap();
        assert!(std::fs::File::open(format!("/proc/{target}/environ")).is_err());
        assert!(std::fs::read_dir(format!("/proc/{target}/fd")).is_err());

        let pid = target.parse::<libc::pid_t>().unwrap();
        // SAFETY: pidfd_open takes the parsed process ID and an integer flag.
        let pidfd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) } as libc::c_int;
        let pidfd_status = if pidfd < 0 {
            "unavailable"
        } else {
            // SAFETY: pidfd_getfd takes integer descriptors and flags only.
            let duplicated =
                unsafe { libc::syscall(libc::SYS_pidfd_getfd, pidfd, target_fd, 0) } as libc::c_int;
            // SAFETY: `pidfd` is an owned descriptor returned above.
            unsafe { libc::close(pidfd) };
            assert!(
                duplicated < 0,
                "pidfd_getfd bypassed the non-dumpable boundary"
            );
            "blocked"
        };
        std::fs::write(
            std::path::PathBuf::from(root).join("probe"),
            format!("environ=blocked;fd=blocked;pidfd_getfd={pidfd_status}"),
        )
        .unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn same_uid_restricted_parent_helper() {
        use std::os::fd::AsRawFd;

        let Some(root) = std::env::var_os("NAC_SAME_UID_INSPECTION_ROOT") else {
            return;
        };
        let (_peer, protected_socket) = std::os::unix::net::UnixStream::pair().unwrap();
        restrict_same_uid_inspection().unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "worker_credentials::tests::same_uid_process_inspection_probe_helper",
                "--nocapture",
            ])
            .env("N_SAME_UID_MARKER", "nonsecret")
            .env(
                "NAC_SAME_UID_INSPECTION_TARGET",
                std::process::id().to_string(),
            )
            .env(
                "NAC_SAME_UID_INSPECTION_FD",
                protected_socket.as_raw_fd().to_string(),
            )
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "same--UID probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!String::from_utf8_lossy(&output.stdout).contains("inspection-env-canary"));
        assert!(!String::from_utf8_lossy(&output.stderr).contains("inspection-env-canary"));
        assert!(std::path::PathBuf::from(root).join("probe").exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_non_dumpable_boundary_blocks_same_uid_procfs_and_pidfd_getfd() {
        let root =
            std::env::temp_dir().join(format!("nac_same_uid_inspection_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "worker_credentials::tests::same_uid_restricted_parent_helper",
                "--nocapture",
            ])
            .env("NAC_SAME_UID_INSPECTION_ROOT", &root)
            .env("EXA_API_KEY", "inspection-env-canary")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "restriction helper failed: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let probe = std::fs::read_to_string(root.join("probe")).unwrap();
        assert!(probe.contains("environ=blocked;fd=blocked"), "{probe}");
        assert!(!probe.contains("inspection-env-canary"));
        assert!(!String::from_utf8_lossy(&output.stdout).contains("inspection-env-canary"));
        assert!(!String::from_utf8_lossy(&output.stderr).contains("inspection-env-canary"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn legacy_pipe_procfs_probe_helper() {
        use std::io::Read;
        use std::os::unix::fs::OpenOptionsExt;

        let Some(root) = std::env::var_os("NAC_LEGACY_PIPE_PROBE_ROOT") else {
            return;
        };
        let target = std::env::var("NAC_LEGACY_PIPE_TARGET").unwrap();
        let fd = std::env::var("NAC_LEGACY_PIPE_FD").unwrap();
        let mut pipe = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(format!("/proc/{target}/fd/{fd}"))
            .unwrap();
        let mut bytes = [0_u8; 128];
        let read = pipe.read(&mut bytes).unwrap();
        let observed = bytes[..read]
            .windows(b"legacy-stdin-pipe-canary".len())
            .any(|part| part == b"legacy-stdin-pipe-canary");
        bytes.fill(0);
        assert!(
            observed,
            "legacy buffered pipe was not observable through procfs"
        );
        std::fs::write(std::path::PathBuf::from(root).join("observed"), "yes").unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn legacy_pipe_parent_helper() {
        let Some(root) = std::env::var_os("NAC_LEGACY_PIPE_PROBE_ROOT") else {
            return;
        };
        let mut fds = [-1_i32; 2];
        // SAFETY: `fds` provides writable storage for exactly two descriptors.
        assert_eq!(unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) }, 0);
        let canary = b"legacy-stdin-pipe-canary\n";
        // SAFETY: the pipe write descriptor is valid and `canary` is readable
        // for the supplied length.
        assert_eq!(
            unsafe { libc::write(fds[1], canary.as_ptr().cast(), canary.len()) },
            canary.len() as isize
        );
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "worker_credentials::tests::legacy_pipe_procfs_probe_helper",
                "--nocapture",
            ])
            .env("NAC_LEGACY_PIPE_TARGET", std::process::id().to_string())
            .env("NAC_LEGACY_PIPE_FD", fds[0].to_string())
            .output()
            .unwrap();
        // SAFETY: both descriptors are owned by this helper and no longer used.
        unsafe {
            libc::close(fds[0]);
            libc::close(fds[1]);
        }
        assert!(
            output.status.success(),
            "legacy pipe probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(std::path::PathBuf::from(root).join("observed").exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn legacy_stdin_pipe_reproduction_demonstrates_the_closed_vulnerability() {
        let root =
            std::env::temp_dir().join(format!("nac_legacy_pipe_probe_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "worker_credentials::tests::legacy_pipe_parent_helper",
                "--nocapture",
            ])
            .env("NAC_LEGACY_PIPE_PROBE_ROOT", &root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "legacy pipe parent failed: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            std::fs::read_to_string(root.join("observed")).unwrap(),
            "yes"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    async fn send_raw_frame(chunks: &[&[u8]]) -> Result<ManagedWorkerNativeCredentials> {
        let (mut sender, receiver) = platform::raw_channel_for_test().unwrap();
        let receiver = tokio::spawn(receiver.receive_after_mcp());
        let mut ready = vec![0_u8; MANAGED_WORKER_CREDENTIAL_READY.len()];
        sender.read_exact(&mut ready).await.unwrap();
        assert_eq!(ready, MANAGED_WORKER_CREDENTIAL_READY);
        for chunk in chunks {
            sender.write_all(chunk).await.unwrap();
            tokio::task::yield_now().await;
        }
        // Invalid frames may make the receiver close before the sender's
        // half-close reaches the socket.
        let _ = sender.shutdown().await;
        receiver.await.unwrap()
    }

    #[test]
    fn native_credential_control_frame_round_trips_without_echoing_invalid_payloads() {
        let credential = "exa-control-frame-canary";
        let encoded = ManagedWorkerNativeCredentials::for_test(Some(credential))
            .encode_control_frame()
            .unwrap();
        let decoded =
            ManagedWorkerNativeCredentials::decode_control_frame(encoded.as_bytes()).unwrap();
        assert_eq!(decoded.into_exa_api_key().as_deref(), Some(credential));

        let invalid = [
            MANAGED_WORKER_CREDENTIAL_PREFIX,
            credential.as_bytes(),
            b"\n",
        ]
        .concat();
        let error = match ManagedWorkerNativeCredentials::decode_control_frame(&invalid) {
            Ok(_) => panic!("invalid credential control frame was accepted"),
            Err(error) => error.to_string(),
        };
        assert!(!error.contains(credential));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sender_blocks_until_worker_announces_post_mcp_readiness() {
        let (sender, receiver) = platform::channel_for_test().unwrap();
        let credentials = ManagedWorkerNativeCredentials::for_test(Some("ready-gated-canary"));
        let delivery = tokio::spawn(async move { sender.send_after_ready(&credentials).await });
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        assert!(
            !delivery.is_finished(),
            "credential delivery bypassed readiness"
        );

        let received = receiver.receive_after_mcp().await.unwrap();
        delivery.await.unwrap().unwrap();
        assert_eq!(
            received.into_exa_api_key().as_deref(),
            Some("ready-gated-canary")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn receiver_accepts_a_fragmented_frame() {
        let received = send_raw_frame(&[
            MANAGED_WORKER_CREDENTIAL_PREFIX,
            br#"{"exa_api_key":"fragmented-canary"}"#,
            b"\n",
        ])
        .await
        .unwrap();
        assert_eq!(
            received.into_exa_api_key().as_deref(),
            Some("fragmented-canary")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn receiver_rejects_trailing_bytes_without_echoing_them() {
        let secret = "trailing-canary";
        let frame = format!(
            "{}{{\"exa_api_key\":\"{secret}\"}}\n",
            String::from_utf8_lossy(MANAGED_WORKER_CREDENTIAL_PREFIX)
        );
        let error = match send_raw_frame(&[frame.as_bytes(), b"trailing"]).await {
            Ok(_) => panic!("trailing bytes were accepted"),
            Err(error) => error.to_string(),
        };
        assert!(!error.contains(secret));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn receiver_rejects_partial_oversized_and_peer_closed_frames() {
        let partial_secret = "partial-canary";
        let partial = format!(
            "{}{{\"exa_api_key\":\"{partial_secret}\"}}",
            String::from_utf8_lossy(MANAGED_WORKER_CREDENTIAL_PREFIX)
        );
        let partial_error = match send_raw_frame(&[partial.as_bytes()]).await {
            Ok(_) => panic!("partial credential frame was accepted"),
            Err(error) => error.to_string(),
        };
        assert!(partial_error.contains("channel closed"));
        assert!(!partial_error.contains(partial_secret));

        let oversized = vec![b'x'; MAX_CREDENTIAL_FRAME_BYTES + 1];
        let oversized_error = match send_raw_frame(&[&oversized]).await {
            Ok(_) => panic!("oversized credential frame was accepted"),
            Err(error) => error.to_string(),
        };
        assert!(oversized_error.contains("too large"));

        let closed_error = match send_raw_frame(&[]).await {
            Ok(_) => panic!("closed credential peer was accepted"),
            Err(error) => error.to_string(),
        };
        assert!(closed_error.contains("channel closed"));
    }
}
