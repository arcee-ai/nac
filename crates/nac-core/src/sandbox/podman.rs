use std::ffi::OsString;
use std::path::Path;
use std::process::Stdio as StdStdio;
use std::process::{Command as StdCommand, Stdio};
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

pub(crate) const SANDBOX_EXEC_WRAPPER: &str = r#"supervisor='requested=$1
pidfile=$2
process_identity() {
  target=$1
  if [ -r "/proc/$target/stat" ]; then
    rest=$(sed '\''s/^.*) //'\'' "/proc/$target/stat" 2>/dev/null) || return 1
    set -- $rest
    [ -n "${20:-}" ] || return 1
    printf '\''proc:%s'\'' "${20}"
    return 0
  fi
  started=$(ps -ww -o lstart= -p "$target" 2>/dev/null) || return 1
  started=$(printf '\''%s'\'' "$started" | sed '\''s/^[[:space:]]*//;s/[[:space:]]*$//'\'')
  [ -n "$started" ] || return 1
  command_line=$(ps -ww -o command= -p "$target" 2>/dev/null) || return 1
  command_signature=$(printf '\''%s'\'' "$command_line" | cksum 2>/dev/null) || return 1
  command_signature=${command_signature%% *}
  [ -n "$command_signature" ] || return 1
  printf '\''ps:%s:%s'\'' "$started" "$command_signature"
}
identity=$(process_identity "$$") || exit 125
printf '\''%s\t%s\n'\'' "$$" "$identity" > "$pidfile"
bash -c "$requested"
status=$?
pgid=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d '\'' '\'')
group_members() {
  [ -n "$pgid" ] || return 0
  (ps -eo pid=,pgid= 2>/dev/null || ps -ax -o pid= -o pgid= 2>/dev/null) |
    awk -v group="$pgid" -v self="$$" '\''$2 == group && $1 != self { print $1 }'\''
}
for child in $(group_members); do
  kill -TERM "$child" 2>/dev/null || true
done
sleep 0.1
for child in $(group_members); do
  kill -KILL "$child" 2>/dev/null || true
done
rm -f "$pidfile"
exit "$status"'
if command -v setsid >/dev/null 2>&1 && setsid -w true >/dev/null 2>&1; then
  exec setsid -w bash -c "$supervisor" nac-supervisor "$1" "$2"
else
  set -m
  bash -c "$supervisor" nac-supervisor "$1" "$2" &
  supervisor_pid=$!
  if [ "${3:-}" = pty ]; then
    fg %1 >/dev/null 2>/dev/null
  else
    wait "$supervisor_pid" 2>/dev/null
  fi
fi"#;

// PTYs use the same foreground supervisor. The requested command retains the
// inherited terminal file descriptors, while the supervisor keeps the process
// group identity alive until successful-exit descendant cleanup is complete.
pub(crate) const SANDBOX_PTY_WRAPPER: &str = SANDBOX_EXEC_WRAPPER;

pub(crate) const SANDBOX_KILL_WRAPPER: &str = r#"pidfile=$1
pid=$(sed -n 's/[[:space:]].*$//p' "$pidfile" 2>/dev/null) || exit 0
expected_identity=$(sed -n 's/^[^[:space:]]*[[:space:]]*//p' "$pidfile" 2>/dev/null) || exit 0
process_identity() {
  target=$1
  if [ -r "/proc/$target/stat" ]; then
    rest=$(sed 's/^.*) //' "/proc/$target/stat" 2>/dev/null) || return 1
    set -- $rest
    [ -n "${20:-}" ] || return 1
    printf 'proc:%s' "${20}"
    return 0
  fi
  started=$(ps -ww -o lstart= -p "$target" 2>/dev/null) || return 1
  started=$(printf '%s' "$started" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -n "$started" ] || return 1
  command_line=$(ps -ww -o command= -p "$target" 2>/dev/null) || return 1
  command_signature=$(printf '%s' "$command_line" | cksum 2>/dev/null) || return 1
  command_signature=${command_signature%% *}
  [ -n "$command_signature" ] || return 1
  printf 'ps:%s:%s' "$started" "$command_signature"
}
identity_matches() {
  [ -n "$pid" ] && [ -n "$expected_identity" ] || return 1
  actual_identity=$(process_identity "$pid") || return 1
  [ "$actual_identity" = "$expected_identity" ]
}
process_is_live() {
  state=$(ps -ww -o stat= -p "$1" 2>/dev/null) || return 1
  state=$(printf '%s' "$state" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -n "$state" ] || return 1
  case "$state" in
    Z*) return 1 ;;
    *) return 0 ;;
  esac
}
if identity_matches; then
  process_table=
  if [ ! -r "/proc/$pid/stat" ]; then
    process_table=$(ps -eo pid=,ppid= 2>/dev/null || ps -ax -o pid= -o ppid= 2>/dev/null) || exit 1
  fi
  descendants() {
    parent=$1
    if [ -r "/proc/$pid/stat" ]; then
      for stat in /proc/[0-9]*/stat; do
        [ -r "$stat" ] || continue
        child=${stat#/proc/}
        child=${child%/stat}
        rest=$(sed 's/^.*) //' "$stat" 2>/dev/null) || continue
        set -- $rest
        [ "${2:-}" = "$parent" ] || continue
        descendants "$child"
        printf '%s\n' "$child"
      done
    else
      for child in $(printf '%s\n' "$process_table" | awk -v parent="$parent" '$2 == parent { print $1 }'); do
        descendants "$child"
        printf '%s\n' "$child"
      done
    fi
  }
  is_current_descendant() {
    candidate=$1
    while [ -n "$candidate" ] && [ "$candidate" -gt 1 ] 2>/dev/null; do
      parent=$(ps -ww -o ppid= -p "$candidate" 2>/dev/null) || return 1
      parent=$(printf '%s' "$parent" | tr -d ' ')
      [ -n "$parent" ] || return 1
      [ "$parent" = "$pid" ] && return 0
      candidate=$parent
    done
    return 1
  }
  pids=$(descendants "$pid")
  if identity_matches; then
    uncertain=0
    verified_descendants=
    for child in $pids; do
      if [ ! -r "/proc/$pid/stat" ] && ! is_current_descendant "$child"; then
        continue
      fi
      child_identity=$(process_identity "$child") || {
        process_is_live "$child" && uncertain=1
        continue
      }
      verified_descendants="${verified_descendants}${child}|${child_identity}
"
    done
    while IFS='|' read -r child child_expected_identity; do
      [ -n "$child" ] || continue
      child_actual_identity=$(process_identity "$child") || {
        process_is_live "$child" && uncertain=1
        continue
      }
      if [ "$child_actual_identity" != "$child_expected_identity" ]; then
        uncertain=1
        continue
      fi
      kill -KILL "$child" 2>/dev/null || {
        process_is_live "$child" && uncertain=1
      }
    done <<NAC_DESCENDANTS
$verified_descendants
NAC_DESCENDANTS
    if identity_matches; then
      kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || {
        process_is_live "$pid" && uncertain=1
      }
    elif process_is_live "$pid"; then
      uncertain=1
    fi
    [ "$uncertain" -eq 0 ] || exit 1
  fi
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
                "--sandbox-mount-ro"
            } else {
                "--sandbox-mount"
            }));
            args.push(mount.host.as_os_str().to_owned());
            args.push(mount.guest.as_os_str().to_owned());
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

    pub(crate) async fn materialize_worktree(&self) -> Result<()> {
        let args = vec![
            "-C".to_string(),
            self.spec.workdir.display().to_string(),
            "reset".to_string(),
            "--hard".to_string(),
            "HEAD".to_string(),
        ];
        let output = self.exec("git", &args, None).await?;
        if !output.status.success() {
            bail!(
                "failed to materialize restored sandbox worktree in container: {}",
                first_stderr_line(&output.stderr)
            );
        }
        Ok(())
    }

    pub(crate) fn terminal_pty_command(
        &self,
        cmd_str: &str,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (PtyCommandBuilder, String) {
        let pidfile = make_sandbox_pidfile();
        let pty_args = vec![
            "-lc".to_string(),
            SANDBOX_PTY_WRAPPER.to_string(),
            "nac-pty".to_string(),
            cmd_str.to_string(),
            pidfile.clone(),
            "pty".to_string(),
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

        match timeout(Duration::from_secs(2), command.status()).await {
            Ok(Ok(status)) if status.success() => Ok(()),
            Ok(Ok(status)) => bail!("Podman command cleanup exited with status {status}"),
            Ok(Err(error)) => Err(error).context("failed to start Podman command cleanup"),
            Err(_) => bail!("Podman command cleanup timed out"),
        }
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
        command.args(self.create_container_args()?);
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

    fn create_container_args(&self) -> Result<Vec<OsString>> {
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
            args.push(OsString::from("--mount"));
            args.push(bind_mount_arg(mount)?);
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
        Ok(args)
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
    format!("/tmp/nac-exec-{}.pid", uuid::Uuid::new_v4().simple())
}

fn bind_mount_arg(mount: &MountSpec) -> Result<OsString> {
    for (kind, path) in [("host", &mount.host), ("guest", &mount.guest)] {
        if path.as_os_str().as_encoded_bytes().contains(&b',') {
            bail!(
                "podman bind-mount {kind} path '{}' contains ','; \
                 move the path before launching the sandbox",
                path.display()
            );
        }
    }
    let mut arg = OsString::from("type=bind,src=");
    arg.push(mount.host.as_os_str());
    arg.push(",dst=");
    arg.push(mount.guest.as_os_str());
    if mount.read_only {
        arg.push(",ro=true");
    }
    Ok(arg)
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
        assert!(rendered.contains(&"--sandbox-mount".to_string()));
        assert!(rendered.contains(&"/tmp/project".to_string()));
        assert!(rendered.contains(&"/workspace".to_string()));
        assert!(!rendered.contains(&"/tmp/project:/workspace".to_string()));
        assert!(rendered.contains(&"--sandbox-shm-size".to_string()));
        assert!(rendered.contains(&"0".to_string()));
    }

    #[test]
    fn create_container_args_include_mounts_and_command() {
        let args = sample_session().create_container_args().unwrap();
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(rendered.starts_with(&["run".to_string(), "-d".to_string(), "--rm".to_string(),]));
        assert!(rendered.contains(&"--mount".to_string()));
        assert!(rendered.contains(&"type=bind,src=/tmp/project,dst=/workspace".to_string()));
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
    fn create_container_args_preserve_colons_in_typed_mount_paths() {
        let mut session = sample_session();
        session.spec.mounts[0].host = PathBuf::from("/tmp/nac:home/worktree");
        let rendered: Vec<String> = session
            .create_container_args()
            .unwrap()
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(
            rendered.contains(&"type=bind,src=/tmp/nac:home/worktree,dst=/workspace".to_string())
        );
        let worker_args = session.worker_cli_args();
        assert!(worker_args.windows(3).any(|args| {
            args == [
                OsString::from("--sandbox-mount"),
                OsString::from("/tmp/nac:home/worktree"),
                OsString::from("/workspace"),
            ]
        }));
    }

    #[cfg(unix)]
    #[test]
    fn worker_cli_args_preserve_non_utf_mount_paths() {
        use std::os::unix::ffi::OsStringExt;

        let host = PathBuf::from(OsString::from_vec(b"/tmp/nac-\xff-worktree".to_vec()));
        let mut session = sample_session();
        session.spec.mounts[0].host = host.clone();

        let args = session.worker_cli_args();
        assert!(args.windows(3).any(|args| {
            args[0] == OsString::from("--sandbox-mount")
                && args[1] == host.as_os_str()
                && args[2] == OsString::from("/workspace")
        }));
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
            .unwrap()
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
            .unwrap()
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

    #[cfg(unix)]
    #[tokio::test]
    async fn terminal_pipe_kill_reports_nonzero_podman_status() {
        use std::os::unix::fs::PermissionsExt;

        let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
        let root =
            std::env::temp_dir().join(format!("nac-podman-kill-status-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let podman = root.join("podman");
        std::fs::write(&podman, "#!/bin/sh\nexit 23\n").unwrap();
        std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
        let original_path = std::env::var_os("PATH");
        unsafe { std::env::set_var("PATH", &root) };
        let result = sample_session().terminal_pipe_kill("/tmp/unused.pid").await;
        unsafe {
            match original_path {
                Some(path) => std::env::set_var("PATH", path),
                None => std::env::remove_var("PATH"),
            }
        }
        let error = result.unwrap_err().to_string();
        assert!(
            error.contains("status"),
            "unexpected cleanup error: {error}"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sandbox_pidfile_path_is_container_tmp_path_and_restart_unique() {
        let path = make_sandbox_pidfile();
        assert!(path.starts_with("/tmp/nac-exec-"));
        assert!(path.ends_with(".pid"));
        assert_ne!(path, make_sandbox_pidfile());
    }

    #[test]
    fn sandbox_wrappers_track_and_kill_process_group() {
        assert!(SANDBOX_EXEC_WRAPPER.contains("setsid -w true"));
        assert!(SANDBOX_EXEC_WRAPPER.contains("exec setsid -w bash -c"));
        assert!(
            SANDBOX_EXEC_WRAPPER.contains("nac-supervisor"),
            "exec wrapper: {SANDBOX_EXEC_WRAPPER}"
        );
        assert!(SANDBOX_EXEC_WRAPPER.contains("group_members()"));
        assert!(SANDBOX_EXEC_WRAPPER.contains("/proc/$target/stat"));
        assert!(SANDBOX_EXEC_WRAPPER.contains("${20:-}"));
        assert!(SANDBOX_EXEC_WRAPPER.contains("ps -ww -o command="));
        assert!(SANDBOX_EXEC_WRAPPER.contains("cksum"));
        assert!(SANDBOX_EXEC_WRAPPER.contains("%s\\t%s\\n"));
        assert!(SANDBOX_EXEC_WRAPPER.contains("kill -KILL \"$child\""));
        assert_eq!(SANDBOX_PTY_WRAPPER, SANDBOX_EXEC_WRAPPER);
        assert!(SANDBOX_PTY_WRAPPER.contains("bash -c \"$requested\""));
        assert!(!SANDBOX_PTY_WRAPPER.contains("bash -i"));
        assert!(SANDBOX_KILL_WRAPPER.contains("descendants()"));
        assert!(SANDBOX_KILL_WRAPPER.contains("expected_identity"));
        assert!(SANDBOX_KILL_WRAPPER.contains("identity_matches()"));
        assert!(SANDBOX_KILL_WRAPPER.contains("/proc/$target/stat"));
        assert!(SANDBOX_KILL_WRAPPER.contains("ps -eo pid=,ppid="));
        assert!(SANDBOX_KILL_WRAPPER.contains("$2 == parent"));
        assert!(SANDBOX_KILL_WRAPPER.contains("is_current_descendant()"));
        assert!(SANDBOX_KILL_WRAPPER.contains("child_actual_identity"));
        assert!(SANDBOX_KILL_WRAPPER.contains("uncertain=1"));
        assert!(!SANDBOX_KILL_WRAPPER.contains("kill -TERM"));
        assert!(SANDBOX_KILL_WRAPPER.contains("kill -KILL \"$child\""));
        assert!(SANDBOX_KILL_WRAPPER.contains("kill -KILL \"-$pid\""));
    }

    #[cfg(unix)]
    #[test]
    fn portable_descendant_helper() {
        let Some(pid_path) = std::env::var_os("NAC_PORTABLE_DESCENDANT_PID_PATH") else {
            return;
        };
        let session = unsafe { libc::setsid() };
        assert!(session > 0, "failed to create escaped descendant session");
        std::fs::write(pid_path, unsafe { libc::getpid() }.to_string()).unwrap();
        std::thread::sleep(Duration::from_secs(30));
    }

    #[cfg(unix)]
    fn portable_ps_identity(pid: u32) -> String {
        use std::io::Write as _;

        let started = std::process::Command::new("ps")
            .args(["-ww", "-o", "lstart=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        assert!(started.status.success());
        let started = String::from_utf8(started.stdout).unwrap();
        let started = started.trim();
        assert!(!started.is_empty());
        let command_line = std::process::Command::new("ps")
            .args(["-ww", "-o", "command=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        assert!(command_line.status.success());
        let mut cksum = std::process::Command::new("cksum")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let command_line = String::from_utf8(command_line.stdout).unwrap();
        let command_line = command_line.trim_end_matches(['\r', '\n']);
        cksum
            .stdin
            .as_mut()
            .unwrap()
            .write_all(command_line.as_bytes())
            .unwrap();
        let checksum = cksum.wait_with_output().unwrap();
        assert!(checksum.status.success());
        let checksum = String::from_utf8(checksum.stdout).unwrap();
        let checksum = checksum.split_whitespace().next().unwrap();
        format!("ps:{started}:{checksum}")
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_wrapper_uses_ps_to_kill_session_escaped_descendants_without_proc() {
        use std::os::unix::process::CommandExt;

        let root = std::env::temp_dir().join(format!(
            "nac-wrapper-portable-descendants-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let descendant_pid_path = root.join("descendant.pid");
        let wrapper_pidfile = root.join("wrapper.pid");
        let executable = std::env::current_exe().unwrap();
        let executable = format!(
            "'{}'",
            executable.display().to_string().replace('\'', "'\"'\"'")
        );
        let command = format!(
            "{executable} --exact sandbox::podman::tests::portable_descendant_helper --nocapture & wait"
        );
        let mut supervisor = std::process::Command::new("bash");
        supervisor
            .env("NAC_PORTABLE_DESCENDANT_PID_PATH", &descendant_pid_path)
            .arg("-c")
            .arg(command)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .process_group(0);
        let mut supervisor = supervisor.spawn().unwrap();

        for _ in 0..200 {
            if descendant_pid_path.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(descendant_pid_path.exists(), "escaped helper did not start");
        let descendant_pid = std::fs::read_to_string(&descendant_pid_path)
            .unwrap()
            .parse::<libc::pid_t>()
            .unwrap();
        let supervisor_pid = supervisor.id();
        std::fs::write(
            &wrapper_pidfile,
            format!(
                "{supervisor_pid}\t{}\n",
                portable_ps_identity(supervisor_pid)
            ),
        )
        .unwrap();

        // Make both identity and descendant discovery take their production
        // non-/proc branches while keeping the rest of the wrapper identical.
        let no_proc_wrapper = SANDBOX_KILL_WRAPPER.replace("/proc/", "/nac-no-proc/");
        let cleanup_started = std::time::Instant::now();
        let output = std::process::Command::new("bash")
            .arg("-c")
            .arg(no_proc_wrapper)
            .arg("nac-kill")
            .arg(&wrapper_pidfile)
            .output()
            .unwrap();
        assert!(
            cleanup_started.elapsed() < Duration::from_secs(5),
            "portable cleanup waited for the descendant to exit naturally"
        );
        assert!(
            output.status.success(),
            "kill wrapper failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let _ = supervisor.wait();
        for _ in 0..100 {
            if unsafe { libc::kill(descendant_pid, 0) } != 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if unsafe { libc::kill(descendant_pid, 0) } == 0 {
            unsafe { libc::kill(descendant_pid, libc::SIGKILL) };
            panic!("session-escaped descendant survived portable cleanup");
        }
        assert!(!wrapper_pidfile.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_wrapper_does_not_kill_a_reused_pid_with_a_different_identity() {
        let root =
            std::env::temp_dir().join(format!("nac-wrapper-pid-identity-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let pidfile = root.join("wrapper.pid");
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        std::fs::write(&pidfile, format!("{}\tproc:not-this-process\n", child.id())).unwrap();

        let output = std::process::Command::new("bash")
            .arg("-c")
            .arg(SANDBOX_KILL_WRAPPER)
            .arg("nac-kill")
            .arg(&pidfile)
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "kill wrapper failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            child.try_wait().unwrap().is_none(),
            "identity mismatch killed the process"
        );
        assert!(!pidfile.exists());
        child.kill().unwrap();
        child.wait().unwrap();
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn portable_identity_rejects_same_start_time_with_a_different_command_signature() {
        let root = std::env::temp_dir().join(format!(
            "nac-wrapper-portable-identity-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let pidfile = root.join("wrapper.pid");
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let actual = portable_ps_identity(child.id());
        let started = actual.rsplit_once(':').unwrap().0;
        std::fs::write(&pidfile, format!("{}\t{started}:0\n", child.id())).unwrap();

        let no_proc_wrapper = SANDBOX_KILL_WRAPPER.replace("/proc/", "/nac-no-proc/");
        let output = std::process::Command::new("bash")
            .arg("-c")
            .arg(no_proc_wrapper)
            .arg("nac-kill")
            .arg(&pidfile)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "kill wrapper failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            child.try_wait().unwrap().is_none(),
            "same-second portable identity collision killed the unrelated process"
        );
        child.kill().unwrap();
        child.wait().unwrap();
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn successful_wrapper_completion_kills_background_group_members() {
        use std::os::unix::process::ExitStatusExt;

        let root =
            std::env::temp_dir().join(format!("nac-wrapper-descendant-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let pid_path = root.join("pid");
        let wrapper_pidfile = root.join("wrapper.pid");
        let requested = format!(
            "sh -c 'trap \"\" HUP TERM; printf %s $$ > {}; exec sleep 30' </dev/null >/dev/null 2>&1 & while [ ! -s {} ]; do sleep 0.01; done",
            pid_path.display(),
            pid_path.display(),
        );
        let output = std::process::Command::new("bash")
            .arg("-c")
            .arg(SANDBOX_EXEC_WRAPPER)
            .arg("nac-exec")
            .arg(requested)
            .arg(&wrapper_pidfile)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "wrapper failed with signal {:?}: {}",
            output.status.signal(),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            output.stderr.is_empty(),
            "wrapper added stderr noise: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let pid = std::fs::read_to_string(&pid_path)
            .unwrap()
            .parse::<libc::pid_t>()
            .unwrap();
        for _ in 0..100 {
            if unsafe { libc::kill(pid, 0) } != 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "descendant survived");
        assert!(!wrapper_pidfile.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn pty_wrapper_fallback_keeps_requested_stdio_and_status() {
        use std::io::Write;

        let root =
            std::env::temp_dir().join(format!("nac-wrapper-pty-fallback-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let wrapper_pidfile = root.join("wrapper.pid");
        let mut child = std::process::Command::new("bash")
            .env("PATH", "/usr/bin:/bin")
            .arg("-c")
            .arg(SANDBOX_PTY_WRAPPER)
            .arg("nac-pty")
            .arg("read value; printf 'exact-pty:%s' \"$value\"")
            .arg(&wrapper_pidfile)
            .arg("pty")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(b"input\n").unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout), "exact-pty:input");
        assert!(
            output.stderr.is_empty(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!wrapper_pidfile.exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
