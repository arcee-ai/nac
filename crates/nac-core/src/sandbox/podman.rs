use std::ffi::OsString;
use std::path::Path;
use std::process::Stdio as StdStdio;
use std::process::{Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use portable_pty::CommandBuilder as PtyCommandBuilder;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

use super::{MountSpec, SandboxAvailability, SandboxAvailabilityStatus, SandboxSpec};
use crate::workspace::first_stderr_line;

/// Probes whether podman can be used on this host right now: first the binary
/// (`podman --version`), then the runtime (`podman info`, which fails while a
/// macOS `podman machine` is stopped or never initialized).
pub(crate) async fn probe_availability() -> SandboxAvailability {
    match Command::new("podman").arg("--version").output().await {
        Ok(output) if output.status.success() => {}
        Ok(output) => {
            return SandboxAvailability {
                status: SandboxAvailabilityStatus::Missing,
                detail: Some(first_stderr_line(&output.stderr)),
                guidance: Some(install_guidance()),
            };
        }
        Err(error) => {
            let detail = (error.kind() != std::io::ErrorKind::NotFound).then(|| error.to_string());
            return SandboxAvailability {
                status: SandboxAvailabilityStatus::Missing,
                detail,
                guidance: Some(install_guidance()),
            };
        }
    }
    match Command::new("podman").arg("info").output().await {
        Ok(output) if output.status.success() => SandboxAvailability {
            status: SandboxAvailabilityStatus::Ready,
            detail: None,
            guidance: None,
        },
        Ok(output) => SandboxAvailability {
            status: SandboxAvailabilityStatus::Unavailable,
            detail: Some(first_stderr_line(&output.stderr)),
            guidance: Some(start_guidance()),
        },
        Err(error) => SandboxAvailability {
            status: SandboxAvailabilityStatus::Unavailable,
            detail: Some(error.to_string()),
            guidance: Some(start_guidance()),
        },
    }
}

/// When a podman operation fails, an availability probe says better than the
/// raw error whether the runtime is even there; if it probes fine, the
/// original error is the more specific one and stays.
async fn explain_runtime_failure(error: anyhow::Error) -> anyhow::Error {
    let availability = probe_availability().await;
    if availability.available() {
        error
    } else {
        error.context(availability.message())
    }
}

#[cfg(target_os = "macos")]
fn install_guidance() -> String {
    "brew install podman\npodman machine init\npodman machine start".to_string()
}

#[cfg(target_os = "linux")]
fn install_guidance() -> String {
    "sudo apt install podman    # Debian/Ubuntu\nsudo dnf install podman    # Fedora".to_string()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn install_guidance() -> String {
    "install podman: https://podman.io/docs/installation".to_string()
}

#[cfg(target_os = "macos")]
fn start_guidance() -> String {
    "podman machine init    # first run only\npodman machine start".to_string()
}

#[cfg(not(target_os = "macos"))]
fn start_guidance() -> String {
    "check 'podman info' on this host for why the runtime is not responding".to_string()
}

pub(crate) const SANDBOX_EXEC_WRAPPER: &str = r#"pidfile=$2
if command -v setsid >/dev/null 2>&1; then
  setsid bash -c "$1" &
else
  set -m
  bash -c "$1" &
fi
pid=$!
printf '%s' "$pid" > "$pidfile"
wait "$pid"
status=$?
rm -f "$pidfile"
exit "$status""#;

pub(crate) const SANDBOX_PTY_WRAPPER: &str = r#"pidfile=$1
printf '%s' "$$" > "$pidfile"
bash -i
status=$?
rm -f "$pidfile"
exit "$status""#;

pub(crate) const SANDBOX_KILL_WRAPPER: &str = r#"pidfile=$1
pid=$(cat "$pidfile" 2>/dev/null) || exit 0
if [ -n "$pid" ]; then
  descendants() {
    parent=$1
    for stat in /proc/[0-9]*/stat; do
      [ -r "$stat" ] || continue
      child=${stat#/proc/}
      child=${child%/stat}
      rest=$(sed 's/^.*) //' "$stat" 2>/dev/null) || continue
      set -- $rest
      [ "${2:-}" = "$parent" ] || continue
      printf '%s\n' "$child"
      descendants "$child"
    done
  }
  pids=$(descendants "$pid")
  for child in $pids; do
    kill -KILL "$child" 2>/dev/null || true
  done
  kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
fi
rm -f "$pidfile""#;

pub(crate) struct PodmanSession {
    spec: SandboxSpec,
    session_key: String,
    owner: bool,
    container_name: String,
    /// Key setup activity is reported under: a client-supplied launch id when
    /// one was sent, else the session key. Keyed per launch so concurrent
    /// launches do not clobber each other's reported phase.
    activity_key: String,
}

impl PodmanSession {
    pub(crate) fn new(
        spec: SandboxSpec,
        session_key: String,
        owner: bool,
        activity_key: String,
    ) -> Self {
        let container_name = format!("nac-{}", sanitize_name(&session_key));
        Self {
            spec,
            session_key,
            owner,
            container_name,
            activity_key,
        }
    }

    pub(crate) fn spec(&self) -> &SandboxSpec {
        &self.spec
    }

    pub(crate) async fn ensure_ready(&self) -> Result<()> {
        // The guard clears the activity entry even when this future is
        // dropped mid-setup (e.g. the client disconnects during a long first
        // image pull); stale activity is worse than none.
        let _guard = ActivityGuard(self.activity_key.clone());
        self.ensure_ready_inner().await
    }

    async fn ensure_ready_inner(&self) -> Result<()> {
        let exists = match self.container_exists().await {
            Ok(exists) => exists,
            Err(error) => return Err(explain_runtime_failure(error).await),
        };
        if !exists {
            if !self.owner {
                bail!(
                    "sandbox session '{}' is not available; start the parent nac process first",
                    self.session_key
                );
            }
            self.ensure_image().await?;
            super::report_activity(&self.activity_key, "starting the sandbox container");
            self.create_container().await?;
            return Ok(());
        }

        if !self.container_running().await? {
            self.start_container().await?;
        }

        Ok(())
    }

    /// A first sandbox launch spends nearly all its time here. Pulling
    /// explicitly — rather than letting `podman run` pull implicitly — is
    /// what lets the slow phase be reported and streamed instead of looking
    /// frozen.
    async fn ensure_image(&self) -> Result<()> {
        let exists = Command::new("podman")
            .arg("image")
            .arg("exists")
            .arg(&self.spec.image)
            .output()
            .await
            .with_context(|| "failed to execute 'podman image exists'")?;
        match classify_image_exists(exists.status.code(), &exists.stderr) {
            ImageCheck::Present => return Ok(()),
            ImageCheck::Missing => {}
            // A runtime failure (125 while the engine is down, connection
            // errors, ...) must not fall through to a pull: that would
            // disguise an availability problem as a slow first-run pull.
            ImageCheck::Failed(detail) => {
                return Err(explain_runtime_failure(anyhow!(
                    "failed to check for sandbox image '{}': {}",
                    self.spec.image,
                    detail
                ))
                .await);
            }
        }
        super::report_activity(
            &self.activity_key,
            format!(
                "pulling image {} (first run can take several minutes)",
                self.spec.image
            ),
        );
        // Stdout stays inherited so pull progress is still streamed; stderr
        // is captured so registry, auth, and network failures reach the
        // caller instead of only the terminal. `kill_on_drop` keeps a
        // cancelled launch from leaving the pull running, where a retry
        // would race a second pull of the same image.
        let child = Command::new("podman")
            .arg("pull")
            .arg(&self.spec.image)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("failed to execute 'podman pull {}'", self.spec.image))?;
        let output = child
            .wait_with_output()
            .await
            .with_context(|| format!("failed to wait for 'podman pull {}'", self.spec.image))?;
        if !output.status.success() {
            return Err(explain_runtime_failure(anyhow!(
                "failed to pull sandbox image '{}': {}",
                self.spec.image,
                pull_error_detail(&output.stderr)
            ))
            .await);
        }
        Ok(())
    }

    pub(crate) fn worker_cli_args(&self) -> Vec<OsString> {
        let mut args = vec![
            OsString::from("--sandbox"),
            OsString::from("--no-mount-cwd"),
            OsString::from("--sandbox-backend"),
            OsString::from("podman"),
            OsString::from("--sandbox-image"),
            OsString::from(self.spec.image.clone()),
            OsString::from("--sandbox-workdir"),
            OsString::from(self.spec.workdir.display().to_string()),
            OsString::from("--sandbox-session-key"),
            OsString::from(self.session_key.clone()),
            OsString::from("--sandbox-cpus"),
            OsString::from(self.spec.cpus.to_string()),
            OsString::from("--sandbox-mem"),
            OsString::from(self.spec.memory_mib.to_string()),
        ];

        for mount in &self.spec.mounts {
            args.push(OsString::from(if mount.read_only {
                "--mount-ro"
            } else {
                "--mount"
            }));
            args.push(OsString::from(format!(
                "{}:{}",
                mount.host.display(),
                mount.guest.display()
            )));
        }
        if let Some(shm_size) = &self.spec.shm_size {
            args.push(OsString::from("--sandbox-shm-size"));
            args.push(OsString::from(shm_size));
        }
        for device in &self.spec.gpu_devices {
            args.push(OsString::from("--sandbox-gpu"));
            args.push(OsString::from(device));
        }

        args
    }

    pub(crate) async fn exec(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<&[u8]>,
    ) -> Result<std::process::Output> {
        let mut command = Command::new("podman");
        command.args(self.exec_args(program, args, true, false, None, &[]));

        if stdin.is_some() {
            command.stdin(Stdio::piped());
        } else {
            command.stdin(Stdio::null());
        }
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        command.kill_on_drop(true);

        let mut child = command
            .spawn()
            .with_context(|| "failed to spawn 'podman exec'")?;

        if let Some(input) = stdin {
            if let Some(mut stdin_pipe) = child.stdin.take() {
                stdin_pipe.write_all(input).await?;
            }
        }

        child
            .wait_with_output()
            .await
            .with_context(|| "failed to wait for 'podman exec'")
    }

    pub(crate) fn child_process_command(
        &self,
        program: &str,
        args: &[String],
        envs: &[(String, String)],
    ) -> Command {
        let mut command = Command::new("podman");
        command.args(self.exec_args(program, args, true, false, None, envs));
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::inherit());
        command
    }

    pub(crate) fn terminal_pty_command(
        &self,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (PtyCommandBuilder, String) {
        let pidfile = make_sandbox_pidfile();
        let pty_args = vec![
            "-lc".to_string(),
            SANDBOX_PTY_WRAPPER.to_string(),
            "nac-pty".to_string(),
            pidfile.clone(),
        ];
        let mut cmd = PtyCommandBuilder::new("podman");
        cmd.args(self.exec_args("bash", &pty_args, true, true, cwd, envs));
        (cmd, pidfile)
    }

    pub(crate) fn terminal_pipe_command(
        &self,
        cmd_str: &str,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (Command, String) {
        let pidfile = make_sandbox_pidfile();
        let pipe_args = vec![
            "-lc".to_string(),
            SANDBOX_EXEC_WRAPPER.to_string(),
            "nac-exec".to_string(),
            cmd_str.to_string(),
            pidfile.clone(),
        ];
        let mut command = Command::new("podman");
        command.args(self.exec_args("bash", &pipe_args, true, false, cwd, envs));
        command.stdin(Stdio::null());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        (command, pidfile)
    }

    pub(crate) async fn terminal_pipe_kill(&self, pidfile: &str) -> Result<()> {
        let mut command = Command::new("podman");
        command
            .arg("exec")
            .arg(&self.container_name)
            .arg("sh")
            .arg("-c")
            .arg(SANDBOX_KILL_WRAPPER)
            .arg("nac-kill")
            .arg(pidfile)
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let _ = timeout(Duration::from_secs(2), command.status()).await;
        Ok(())
    }

    fn exec_args(
        &self,
        program: &str,
        args: &[String],
        interactive: bool,
        tty: bool,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> Vec<OsString> {
        let mut command_args = vec![OsString::from("exec")];

        let wd = cwd
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| self.spec.workdir.display().to_string());
        command_args.push(OsString::from("--workdir"));
        command_args.push(OsString::from(wd));

        for (key, value) in envs {
            command_args.push(OsString::from("--env"));
            command_args.push(OsString::from(format!("{key}={value}")));
        }

        if interactive {
            command_args.push(OsString::from("-i"));
        }
        if tty {
            command_args.push(OsString::from("-t"));
        }

        command_args.push(OsString::from(self.container_name.clone()));
        command_args.push(OsString::from(program));
        for arg in args {
            command_args.push(OsString::from(arg));
        }
        command_args
    }

    async fn container_exists(&self) -> Result<bool> {
        let output = Command::new("podman")
            .arg("container")
            .arg("exists")
            .arg(&self.container_name)
            .output()
            .await
            .with_context(|| "failed to execute 'podman container exists'")?;
        Ok(output.status.success())
    }

    async fn container_running(&self) -> Result<bool> {
        let output = Command::new("podman")
            .arg("inspect")
            .arg("--format")
            .arg("{{.State.Running}}")
            .arg(&self.container_name)
            .output()
            .await
            .with_context(|| "failed to execute 'podman inspect'")?;

        if !output.status.success() {
            return Ok(false);
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim() == "true")
    }

    async fn create_container(&self) -> Result<()> {
        let mut command = Command::new("podman");
        command.args(self.create_container_args());
        let output = command
            .output()
            .await
            .with_context(|| "failed to execute 'podman run'")?;
        if !output.status.success() {
            return Err(explain_runtime_failure(anyhow!(
                "failed to create sandbox container '{}': {}",
                self.container_name,
                String::from_utf8_lossy(&output.stderr).trim()
            ))
            .await);
        }
        Ok(())
    }

    async fn start_container(&self) -> Result<()> {
        let output = Command::new("podman")
            .arg("start")
            .arg(&self.container_name)
            .output()
            .await
            .with_context(|| "failed to execute 'podman start'")?;
        if !output.status.success() {
            return Err(explain_runtime_failure(anyhow!(
                "failed to start sandbox container '{}': {}",
                self.container_name,
                String::from_utf8_lossy(&output.stderr).trim()
            ))
            .await);
        }
        Ok(())
    }

    fn create_container_args(&self) -> Vec<OsString> {
        let mut args = vec![
            OsString::from("run"),
            OsString::from("-d"),
            OsString::from("--rm"),
            OsString::from("--name"),
            OsString::from(self.container_name.clone()),
            OsString::from("--cpus"),
            OsString::from(self.spec.cpus.to_string()),
            OsString::from("--memory"),
            OsString::from(format!("{}m", self.spec.memory_mib)),
        ];

        if should_keep_id_userns() && self.spec.mounts.iter().any(|mount| !mount.read_only) {
            args.push(OsString::from("--userns"));
            args.push(OsString::from("keep-id"));
        }

        for mount in &self.spec.mounts {
            args.push(OsString::from("-v"));
            args.push(OsString::from(volume_arg(mount)));
        }

        if let Some(shm_size) = &self.spec.shm_size {
            args.push(OsString::from("--shm-size"));
            args.push(OsString::from(shm_size));
        }

        if !self.spec.gpu_devices.is_empty() && should_enable_gpu_access_options() {
            args.push(OsString::from("--security-opt"));
            args.push(OsString::from("label=disable"));
            args.push(OsString::from("--group-add"));
            args.push(OsString::from("keep-groups"));
        }

        for device in &self.spec.gpu_devices {
            args.push(OsString::from("--device"));
            args.push(OsString::from(device));
        }

        args.push(OsString::from(self.spec.image.clone()));
        args.push(OsString::from("sh"));
        args.push(OsString::from("-lc"));
        args.push(OsString::from(format!(
            "mkdir -p '{}' && exec sleep infinity",
            shell_escape_path(&self.spec.workdir)
        )));
        args
    }

    /// Explicitly destroy the sandbox container, regardless of remaining
    /// `Arc` references.  Best-effort and idempotent: `podman rm -f` already
    /// handles non-existent containers gracefully.
    pub(crate) async fn destroy(&self) -> Result<()> {
        if !self.owner {
            return Ok(());
        }
        let mut cmd = Command::new("podman");
        cmd.args(["rm", "-f", &self.container_name]);
        let _ = cmd.output().await; // best-effort, ignore errors
        Ok(())
    }
}

impl Drop for PodmanSession {
    fn drop(&mut self) {
        if !self.owner {
            return;
        }

        let _ = StdCommand::new("podman")
            .arg("rm")
            .arg("-f")
            .arg(&self.container_name)
            .stdout(StdStdio::null())
            .stderr(StdStdio::null())
            .spawn();
    }
}

/// `podman image exists` exit codes: 0 = present, 1 = missing, anything
/// else (125 while the engine is down, connection failures, being killed by
/// a signal) = the check itself failed.
enum ImageCheck {
    Present,
    Missing,
    Failed(String),
}

fn classify_image_exists(code: Option<i32>, stderr: &[u8]) -> ImageCheck {
    match code {
        Some(0) => ImageCheck::Present,
        Some(1) => ImageCheck::Missing,
        _ => ImageCheck::Failed(first_stderr_line(stderr)),
    }
}

/// `podman pull` streams progress ("Trying to pull ...", "Copying blob ...")
/// to stderr along with the real failure, so the first line is rarely the
/// error. Prefer the `Error:` line podman prints for the failure itself;
/// fall back to the last non-empty line, which is where podman puts the
/// reason when it is not `Error:`-prefixed.
fn pull_error_detail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    lines
        .iter()
        .rev()
        .find(|line| line.starts_with("Error"))
        .or_else(|| lines.last())
        .map(|line| (*line).to_string())
        .unwrap_or_else(|| "no details reported".to_string())
}

/// Removes a session's activity-map entry on drop, so cancelling the
/// `ensure_ready` future mid-setup cannot leak a stale entry.
struct ActivityGuard(String);

impl Drop for ActivityGuard {
    fn drop(&mut self) {
        super::clear_activity(&self.0);
    }
}

pub(crate) fn make_sandbox_pidfile() -> String {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    format!("/tmp/nac-exec-{}-{id}.pid", std::process::id())
}

fn volume_arg(mount: &MountSpec) -> String {
    let mode = if mount.read_only { "ro" } else { "rw" };
    format!(
        "{}:{}:{}",
        mount.host.display(),
        mount.guest.display(),
        mode
    )
}

pub(crate) fn sanitize_name(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

pub(crate) fn shell_escape_path(path: &Path) -> String {
    path.display().to_string().replace('\'', "'\"'\"'")
}

#[cfg(target_os = "linux")]
fn should_keep_id_userns() -> bool {
    true
}

#[cfg(not(target_os = "linux"))]
fn should_keep_id_userns() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn should_enable_gpu_access_options() -> bool {
    true
}

#[cfg(not(target_os = "linux"))]
fn should_enable_gpu_access_options() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::DEFAULT_SANDBOX_WORKDIR;
    use std::path::PathBuf;

    fn sample_session() -> PodmanSession {
        PodmanSession::new(
            SandboxSpec {
                mounts: vec![MountSpec {
                    host: PathBuf::from("/tmp/project"),
                    guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                    read_only: false,
                }],
                shm_size: Some("0".to_string()),
                ..Default::default()
            },
            "abc123".to_string(),
            false,
            "abc123".to_string(),
        )
    }

    #[test]
    fn image_exists_exit_codes_are_classified() {
        assert!(matches!(
            classify_image_exists(Some(0), b""),
            ImageCheck::Present
        ));
        assert!(matches!(
            classify_image_exists(Some(1), b""),
            ImageCheck::Missing
        ));
        // Engine-down style failure (podman exits 125) surfaces its stderr.
        match classify_image_exists(Some(125), b"Error: unable to connect to Podman socket\n") {
            ImageCheck::Failed(detail) => {
                assert!(detail.contains("unable to connect to Podman socket"));
            }
            _ => panic!("exit 125 must be a check failure, not a missing image"),
        }
        // Signal termination (no exit code) is also a failure, and empty
        // stderr still yields a usable message.
        match classify_image_exists(None, b"") {
            ImageCheck::Failed(detail) => assert_eq!(detail, "no details reported"),
            _ => panic!("signal termination must be a check failure"),
        }
    }

    #[test]
    fn pull_error_detail_prefers_the_error_line_over_progress() {
        // Pull progress precedes the real failure on stderr; the first line
        // is a status, not the reason.
        let stderr = b"Trying to pull registry.example.com/img:latest...\nCopying blob sha256:abc\nError: initializing source: unauthorized\n";
        assert_eq!(
            pull_error_detail(stderr),
            "Error: initializing source: unauthorized"
        );
        // Without an `Error:` line, the last non-empty line is the reason.
        let stderr = b"Trying to pull registry.example.com/img:latest...\nmanifest unknown\n";
        assert_eq!(pull_error_detail(stderr), "manifest unknown");
        // Empty stderr still yields a usable message.
        assert_eq!(pull_error_detail(b""), "no details reported");
        assert_eq!(pull_error_detail(b"\n  \n"), "no details reported");
    }

    #[test]
    fn worker_cli_args_are_explicit() {
        let args = sample_session().worker_cli_args();
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(rendered.contains(&"--sandbox".to_string()));
        assert!(rendered.contains(&"--no-mount-cwd".to_string()));
        assert!(rendered.contains(&"--sandbox-session-key".to_string()));
        assert!(rendered.contains(&"/tmp/project:/workspace".to_string()));
        assert!(rendered.contains(&"--sandbox-shm-size".to_string()));
        assert!(rendered.contains(&"0".to_string()));
    }

    #[test]
    fn create_container_args_include_mounts_and_command() {
        let args = sample_session().create_container_args();
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(rendered.starts_with(&["run".to_string(), "-d".to_string(), "--rm".to_string(),]));
        assert!(rendered.contains(&"-v".to_string()));
        assert!(rendered.contains(&"/tmp/project:/workspace:rw".to_string()));
        assert!(rendered.contains(&"--shm-size".to_string()));
        assert!(rendered.contains(&"0".to_string()));
        assert_eq!(
            rendered.contains(&"--userns".to_string()),
            should_keep_id_userns()
        );
        assert_eq!(
            rendered.contains(&"keep-id".to_string()),
            should_keep_id_userns()
        );
        assert!(rendered
            .iter()
            .any(|value| value.contains("sleep infinity")));
    }

    #[test]
    fn create_container_args_skip_user_without_rw_mounts() {
        let session = PodmanSession::new(
            SandboxSpec {
                shm_size: Some("0".to_string()),
                ..Default::default()
            },
            "empty".to_string(),
            false,
            "empty".to_string(),
        );
        let rendered: Vec<String> = session
            .create_container_args()
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(!rendered.contains(&"--userns".to_string()));
    }

    #[test]
    fn create_container_args_include_gpu_devices() {
        let session = PodmanSession::new(
            SandboxSpec {
                gpu_devices: vec![
                    "nvidia.com/gpu=all".to_string(),
                    "nvidia.com/gpu=mig1:0".to_string(),
                ],
                shm_size: Some("8g".to_string()),
                ..Default::default()
            },
            "gpu".to_string(),
            false,
            "gpu".to_string(),
        );
        let rendered: Vec<String> = session
            .create_container_args()
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(rendered.contains(&"--device".to_string()));
        assert!(rendered.contains(&"nvidia.com/gpu=all".to_string()));
        assert!(rendered.contains(&"nvidia.com/gpu=mig1:0".to_string()));
        assert!(rendered.contains(&"--shm-size".to_string()));
        assert!(rendered.contains(&"8g".to_string()));
        assert_eq!(
            rendered.contains(&"label=disable".to_string()),
            should_enable_gpu_access_options()
        );
        assert_eq!(
            rendered.contains(&"keep-groups".to_string()),
            should_enable_gpu_access_options()
        );
    }

    #[test]
    fn exec_args_enable_interactive_mode_when_stdin_is_present() {
        let args = sample_session().exec_args(
            "python3",
            &["-c".to_string(), "print('hi')".to_string()],
            true,
            false,
            None,
            &[],
        );
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert_eq!(rendered.first().map(String::as_str), Some("exec"));
        assert!(rendered.contains(&"-i".to_string()));
        assert!(!rendered.contains(&"-t".to_string()));
    }

    #[test]
    fn exec_args_skip_interactive_mode_without_stdin() {
        let args = sample_session().exec_args(
            "bash",
            &["-lc".to_string(), "pwd".to_string()],
            false,
            false,
            None,
            &[],
        );
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(!rendered.contains(&"-i".to_string()));
        assert!(!rendered.contains(&"-t".to_string()));
    }

    #[test]
    fn exec_args_includes_it_flags_when_interactive_and_tty() {
        let args = sample_session().exec_args("bash", &[], true, true, None, &[]);
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(rendered.contains(&"-i".to_string()));
        assert!(rendered.contains(&"-t".to_string()));
    }

    #[test]
    fn terminal_pipe_command_includes_env_vars() {
        let session = sample_session();
        let (command, _pidfile) = session.terminal_pipe_command(
            "echo hello",
            None,
            &[
                ("TERM".to_string(), "dumb".to_string()),
                ("PAGER".to_string(), "cat".to_string()),
            ],
        );
        // Render the command as a debug string to inspect arguments
        let debug = format!("{command:?}");
        assert!(debug.contains("--env"), "expected --env flag: {debug}");
        assert!(debug.contains("TERM=dumb"), "expected TERM=dumb: {debug}");
        assert!(debug.contains("PAGER=cat"), "expected PAGER=cat: {debug}");
    }

    #[test]
    fn sandbox_pidfile_path_is_container_tmp_path() {
        let path = make_sandbox_pidfile();
        assert!(path.starts_with("/tmp/nac-exec-"));
        assert!(path.ends_with(".pid"));
    }

    #[test]
    fn sandbox_wrappers_track_and_kill_process_group() {
        assert!(SANDBOX_EXEC_WRAPPER.contains("setsid bash -c"));
        assert!(
            SANDBOX_EXEC_WRAPPER.contains("printf '%s' \"$pid\" > \"$pidfile\""),
            "exec wrapper: {SANDBOX_EXEC_WRAPPER}"
        );
        assert!(SANDBOX_PTY_WRAPPER.contains("printf '%s' \"$$\" > \"$pidfile\""));
        assert!(SANDBOX_PTY_WRAPPER.contains("bash -i"));
        assert!(SANDBOX_KILL_WRAPPER.contains("descendants()"));
        assert!(!SANDBOX_KILL_WRAPPER.contains("kill -TERM"));
        assert!(SANDBOX_KILL_WRAPPER.contains("kill -KILL \"$child\""));
        assert!(SANDBOX_KILL_WRAPPER.contains("kill -KILL \"-$pid\""));
    }
}
