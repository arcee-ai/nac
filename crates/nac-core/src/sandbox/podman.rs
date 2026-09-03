use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio as StdStdio;
use std::process::{Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use fs2::FileExt;
use portable_pty::CommandBuilder as PtyCommandBuilder;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

use super::{MountSpec, SandboxAvailability, SandboxAvailabilityStatus, SandboxSpec};
use crate::workspace::first_stderr_line;

fn podman_program() -> OsString {
    #[cfg(test)]
    if let Some(program) = std::env::var_os("NAC_TEST_PODMAN_PROGRAM") {
        return program;
    }
    OsString::from("podman")
}

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
process_is_live() {
  if [ -r /proc/1/stat ] || [ -r /proc/self/stat ]; then
    [ -r "/proc/$1/stat" ] || return 1
  fi
  # This predicate deliberately means "not proven gone". Portable ps failure
  # is inspection uncertainty, not evidence that the recorded PID disappeared.
  state=$(ps -ww -o stat= -p "$1" 2>/dev/null) || return 0
  state=$(printf '%s' "$state" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -n "$state" ] || return 0
  case "$state" in
    Z*) return 1 ;;
    *) return 0 ;;
  esac
}
identity_state() {
  [ -n "$pid" ] && [ -n "$expected_identity" ] || {
    printf 'uncertain'
    return 0
  }
  actual_identity=$(process_identity "$pid") || {
    if process_is_live "$pid"; then
      printf 'uncertain'
    else
      printf 'gone'
    fi
    return 0
  }
  if [ "$actual_identity" = "$expected_identity" ]; then
    printf 'match'
  else
    printf 'mismatch'
  fi
}
root_identity_state=$(identity_state)
if [ "$root_identity_state" = match ]; then
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
  pids=$(descendants "$pid")
  uncertain=0
  verified_descendants=
  for child in $pids; do
    child_identity=$(process_identity "$child") || {
      process_is_live "$child" && uncertain=1
      continue
    }
    verified_descendants="${verified_descendants}${child}|${child_identity}
"
  done
  # The root may exit after descendant discovery. The captured child identity
  # remains sufficient authority to clean that exact process; do not discard
  # it merely because the supervisor disappeared before revalidation.
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
  case "$(identity_state)" in
    match)
      kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || {
        process_is_live "$pid" && uncertain=1
      }
      ;;
    uncertain) uncertain=1 ;;
    gone|mismatch) ;;
  esac
  [ "$uncertain" -eq 0 ] || exit 1
elif [ "$root_identity_state" = uncertain ]; then
  # Inspection failure is not proof that the recorded process disappeared or
  # that its PID was reused. Preserve the pidfile as retry authority and report
  # incomplete cleanup to the caller.
  exit 1
fi
rm -f "$pidfile""#;

pub(crate) struct PodmanSession {
    spec: SandboxSpec,
    session_key: String,
    /// Whether this attachment may create the stable container when it is
    /// absent. Ordinary worker attachments inherit the parent-owned container
    /// and must not recreate it; durable-session resume is an explicit
    /// lifecycle owner even though it never receives destructive Drop
    /// authority.
    create_if_missing: bool,
    cleanup_on_drop: AtomicBool,
    container_name: String,
    /// Key setup activity is reported under: a client-supplied launch id when
    /// one was sent, else the session key. Keyed per launch so concurrent
    /// launches do not clobber each other's reported phase.
    activity_key: String,
    /// Present only while a fresh durable launch has created its container but
    /// has not yet transferred ownership to the committed session row.
    creation_store_path: Option<PathBuf>,
    creation_record: Mutex<Option<CreationRecordAuthority>>,
}

struct CreationRecordAuthority {
    cidfile: PathBuf,
    lock_file: File,
}

impl CreationRecordAuthority {
    fn remove(self) {
        let cidfile = self.cidfile.clone();
        let _ = FileExt::unlock(&self.lock_file);
        drop(self);
        remove_creation_record(&cidfile);
    }
}

/// Owns an in-flight `podman run` until it is known to have settled. If the
/// caller is cancelled while awaiting creation, cleanup is ordered after the
/// exact detached child finishes so `rm` cannot race ahead of container
/// registration.
struct PendingContainerCreation {
    task: Option<tokio::task::JoinHandle<std::io::Result<std::process::Output>>>,
    record: Option<CreationRecordAuthority>,
    settled: bool,
}

impl PendingContainerCreation {
    fn disarm(&mut self) {
        self.task = None;
        if let Some(record) = self.record.take() {
            record.remove();
        }
    }

    #[expect(
        clippy::expect_used,
        reason = "only successful creation transfers the still-owned cleanup record"
    )]
    fn transfer_record(&mut self) -> CreationRecordAuthority {
        self.task = None;
        self.record
            .take()
            .expect("successful creation retains its ownership record")
    }
}

impl Drop for PendingContainerCreation {
    fn drop(&mut self) {
        let Some(task) = self.task.take() else {
            return;
        };
        let Some(record) = self.record.take() else {
            return;
        };
        let settled = self.settled;
        tokio::spawn(async move {
            if settled {
                drop(task);
            } else {
                let _ = task.await;
            }
            let cidfile = record.cidfile.clone();
            if let Err(error) = destroy_created_container_record(record).await {
                eprintln!(
                    "nac: failed to roll back cancelled sandbox creation recorded in '{}': {error:#}",
                    cidfile.display()
                );
            }
        });
    }
}

/// Removes only the container identity emitted by this exact `podman run`.
/// A failed duplicate-name creator has no cidfile and therefore cannot delete
/// the peer container that won the shared deterministic name.
#[cfg(test)]
async fn destroy_created_container(cidfile: &Path) -> Result<()> {
    destroy_created_container_only(cidfile).await?;
    remove_creation_record(cidfile);
    Ok(())
}

async fn destroy_created_container_record(record: CreationRecordAuthority) -> Result<()> {
    destroy_created_container_only(&record.cidfile).await?;
    record.remove();
    Ok(())
}

async fn destroy_created_container_only(cidfile: &Path) -> Result<()> {
    let container_id = match tokio::fs::read_to_string(cidfile).await {
        Ok(container_id) => container_id.trim().to_string(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(());
        }
        Err(error) => {
            return Err(error).with_context(|| {
                format!(
                    "failed to read Podman creation cidfile '{}'",
                    cidfile.display()
                )
            });
        }
    };
    if container_id.len() != 64 || !container_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!(
            "Podman creation cidfile '{}' did not contain a full container ID; cleanup authority was preserved",
            cidfile.display()
        );
    }

    let token_path = creation_token_path(cidfile);
    let ownership_token = tokio::fs::read_to_string(&token_path)
        .await
        .with_context(|| {
            format!(
                "failed to read Podman creation ownership token '{}'; cleanup authority was preserved",
                token_path.display()
            )
        })?;
    let ownership_token = ownership_token.trim();
    if ownership_token.is_empty() {
        bail!(
            "Podman creation ownership token '{}' was empty; cleanup authority was preserved",
            token_path.display()
        );
    }

    let inspection = Command::new(podman_program())
        .args([
            "inspect",
            "--type",
            "container",
            "--format",
            "{{ index .Config.Labels \"io.nac.creation-token\" }}",
            "--",
            &container_id,
        ])
        .output()
        .await
        .context("failed to verify Podman sandbox creation ownership")?;
    if !inspection.status.success() {
        bail!(
            "failed to verify newly created sandbox container '{}': {}; cleanup authority was preserved in '{}'",
            container_id,
            first_stderr_line(&inspection.stderr),
            cidfile.display()
        );
    }
    if String::from_utf8_lossy(&inspection.stdout).trim() != ownership_token {
        bail!(
            "Podman creation cidfile '{}' did not identify the container owned by this launch; refusing removal",
            cidfile.display()
        );
    }

    let output = Command::new(podman_program())
        .args(["rm", "--ignore", "-f", "--", &container_id])
        .output()
        .await
        .context("failed to execute Podman sandbox creation rollback")?;
    if !output.status.success() {
        bail!(
            "failed to remove newly created sandbox container '{}': {}; cleanup authority was preserved in '{}'",
            container_id,
            first_stderr_line(&output.stderr),
            cidfile.display()
        );
    }
    Ok(())
}

fn remove_creation_record(cidfile: &Path) {
    let _ = std::fs::remove_file(cidfile);
    let _ = std::fs::remove_file(creation_token_path(cidfile));
    let _ = std::fs::remove_file(creation_session_path(cidfile));
    let _ = std::fs::remove_file(creation_store_path(cidfile));
    let _ = std::fs::remove_file(creation_lock_path(cidfile));
    if let Some(directory) = cidfile.parent() {
        let _ = std::fs::remove_dir(directory);
    }
}

fn creation_token_path(cidfile: &Path) -> std::path::PathBuf {
    cidfile.with_file_name("ownership.token")
}

fn creation_session_path(cidfile: &Path) -> PathBuf {
    cidfile.with_file_name("session.key")
}

fn creation_store_path(cidfile: &Path) -> PathBuf {
    cidfile.with_file_name("store.path")
}

fn creation_lock_path(cidfile: &Path) -> PathBuf {
    cidfile.with_file_name("ownership.lock")
}

fn write_private_record(path: &Path, contents: &[u8]) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("failed to create private record '{}'", path.display()))?;
    file.write_all(contents)?;
    file.sync_all()?;
    Ok(())
}

fn create_creation_record(
    session_key: &str,
    store_path: Option<&Path>,
    ownership_token: &str,
) -> Result<CreationRecordAuthority> {
    let directory = std::env::temp_dir().join(format!(
        "nac-podman-create-{}-{}",
        sanitize_name(session_key),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&directory).with_context(|| {
        format!(
            "failed to create private Podman creation record directory '{}'",
            directory.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
    }

    let cidfile = directory.join("container.cid");
    let result = (|| -> Result<CreationRecordAuthority> {
        write_private_record(
            &creation_token_path(&cidfile),
            format!("{ownership_token}\n").as_bytes(),
        )?;
        write_private_record(
            &creation_session_path(&cidfile),
            format!("{session_key}\n").as_bytes(),
        )?;
        if let Some(store_path) = store_path {
            let canonical_store = store_path.canonicalize().with_context(|| {
                format!(
                    "failed to canonicalize durable store '{}' for Podman creation ownership",
                    store_path.display()
                )
            })?;
            write_private_record(
                &creation_store_path(&cidfile),
                &serde_json::to_vec(&canonical_store)?,
            )?;
        }
        let lock_path = creation_lock_path(&cidfile);
        write_private_record(&lock_path, b"")?;
        let lock_file = OpenOptions::new().read(true).write(true).open(&lock_path)?;
        FileExt::lock_exclusive(&lock_file)?;
        #[cfg(unix)]
        File::open(&directory)?.sync_all()?;
        Ok(CreationRecordAuthority { cidfile, lock_file })
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&directory);
    }
    result
}

/// On server startup, settle private creation records that outlived their
/// creating process. The held lock distinguishes an active launch from an
/// abandoned one. A committed row wins ownership; otherwise removal remains
/// bound to the full container ID and per-launch Podman label.
pub(crate) async fn reconcile_creation_records(store_path: &Path) -> Result<()> {
    let canonical_store = store_path.canonicalize().with_context(|| {
        format!(
            "failed to canonicalize durable store '{}' before reconciling Podman creation ownership",
            store_path.display()
        )
    })?;
    let entries = match std::fs::read_dir(std::env::temp_dir()) {
        Ok(entries) => entries,
        Err(error) => return Err(error).context("failed to scan Podman creation records"),
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                eprintln!("nac: failed to inspect a Podman creation record: {error}");
                continue;
            }
        };
        let name = entry.file_name();
        if !name.to_string_lossy().starts_with("nac-podman-create-") {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                eprintln!(
                    "nac: failed to inspect Podman creation record '{}': {error}",
                    entry.path().display()
                );
                continue;
            }
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let cidfile = entry.path().join("container.cid");
        let recorded_store: PathBuf = match std::fs::read(creation_store_path(&cidfile))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        {
            Some(recorded_store) => recorded_store,
            None => continue,
        };
        if recorded_store != canonical_store {
            continue;
        }
        let lock_file = match OpenOptions::new()
            .read(true)
            .write(true)
            .open(creation_lock_path(&cidfile))
        {
            Ok(lock_file) => lock_file,
            Err(error) => {
                eprintln!(
                    "nac: Podman creation record '{}' has no usable ownership lock: {error}; cleanup authority was preserved",
                    cidfile.display()
                );
                continue;
            }
        };
        match FileExt::try_lock_exclusive(&lock_file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => continue,
            Err(error) => {
                eprintln!(
                    "nac: failed to claim abandoned Podman creation record '{}': {error}",
                    cidfile.display()
                );
                continue;
            }
        }
        let record = CreationRecordAuthority { cidfile, lock_file };
        // The creator may have died while its detached `podman run` child was
        // still registering the container. An absent cidfile is therefore
        // uncertainty, not proof that no container can appear after this
        // scan. Keep the record for a later reconciliation pass.
        if !record.cidfile.exists() {
            eprintln!(
                "nac: abandoned Podman creation record '{}' has no container ID yet; cleanup authority was preserved for retry",
                record.cidfile.display()
            );
            continue;
        }
        let session_key = match std::fs::read_to_string(creation_session_path(&record.cidfile)) {
            Ok(session_key) => session_key.trim().to_string(),
            Err(error) => {
                eprintln!(
                    "nac: Podman creation record '{}' has no usable session identity: {error}; cleanup authority was preserved",
                    record.cidfile.display()
                );
                continue;
            }
        };
        if uuid::Uuid::parse_str(&session_key).is_err() {
            eprintln!(
                "nac: Podman creation record '{}' has an invalid session identity; cleanup authority was preserved",
                record.cidfile.display()
            );
            continue;
        }
        match crate::sessions::session_exists(store_path, &session_key) {
            Ok(true) => record.remove(),
            Ok(false) => {
                if let Err(error) = destroy_created_container_record(record).await {
                    eprintln!(
                        "nac: failed to reconcile abandoned Podman creation: {error:#}"
                    );
                }
            }
            Err(error) => eprintln!(
                "nac: failed to check durable ownership for Podman creation record '{}': {error:#}; cleanup authority was preserved",
                record.cidfile.display()
            ),
        }
    }
    Ok(())
}

pub(crate) async fn destroy_owned_container(session_key: &str) -> Result<()> {
    let container_name = format!("nac-{}", sanitize_name(session_key));
    let output = Command::new("podman")
        .args(["rm", "--ignore", "-f", &container_name])
        .output()
        .await
        .context("failed to execute Podman sandbox cleanup")?;
    if !output.status.success() {
        bail!(
            "failed to remove sandbox container '{}': {}",
            container_name,
            first_stderr_line(&output.stderr)
        );
    }
    Ok(())
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
            create_if_missing: owner,
            cleanup_on_drop: AtomicBool::new(owner),
            container_name,
            activity_key,
            creation_store_path: None,
            creation_record: Mutex::new(None),
        }
    }

    pub(crate) fn new_for_durable_launch(
        spec: SandboxSpec,
        session_key: String,
        owner: bool,
        activity_key: String,
        store_path: PathBuf,
    ) -> Self {
        let mut session = Self::new(spec, session_key, owner, activity_key);
        session.creation_store_path = Some(store_path);
        session
    }

    pub(crate) fn new_for_durable_resume(
        spec: SandboxSpec,
        session_key: String,
        activity_key: String,
    ) -> Self {
        let mut session = Self::new(spec, session_key, false, activity_key);
        session.create_if_missing = true;
        session
    }

    pub(crate) fn spec(&self) -> &SandboxSpec {
        &self.spec
    }

    #[expect(
        clippy::expect_used,
        reason = "poisoning the creation-record lock invalidates container cleanup ownership"
    )]
    pub(crate) fn retain_for_durable_session(&self) {
        self.cleanup_on_drop.store(false, Ordering::Release);
        let creation_record = self
            .creation_record
            .lock()
            .expect("Podman creation record lock poisoned")
            .take();
        if let Some(record) = creation_record {
            record.remove();
        }
    }

    /// Checked launch rollback owns cleanup from this point, but the durable
    /// creation record remains until that removal succeeds so process loss can
    /// still be reconciled on a later startup.
    pub(crate) fn disable_drop_cleanup(&self) {
        self.cleanup_on_drop.store(false, Ordering::Release);
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
            if !self.create_if_missing {
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
        let exists = Command::new(podman_program())
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
        for name in crate::model::NATIVE_INTEGRATION_CREDENTIAL_ENV_NAMES {
            command.env_remove(name);
        }
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
        let output = Command::new(podman_program())
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

    #[expect(
        clippy::expect_used,
        reason = "the creation task is installed in the pending guard immediately before awaiting it"
    )]
    async fn create_container(&self) -> Result<()> {
        let ownership_token = uuid::Uuid::new_v4().to_string();
        let record = create_creation_record(
            &self.session_key,
            self.creation_store_path.as_deref(),
            &ownership_token,
        )?;
        let cidfile = record.cidfile.clone();
        let args = match self
            .create_container_args_with_cidfile(Some((&cidfile, ownership_token.as_str())))
        {
            Ok(args) => args,
            Err(error) => {
                record.remove();
                return Err(error);
            }
        };
        let task = tokio::spawn(async move {
            let mut command = Command::new(podman_program());
            command.args(args);
            command.output().await
        });
        let mut pending = PendingContainerCreation {
            task: Some(task),
            record: Some(record),
            settled: false,
        };
        let result = pending.task.as_mut().expect("creation task is armed").await;
        pending.settled = true;
        let output = result
            .map_err(|error| anyhow!("Podman sandbox creation task failed: {error}"))?
            .with_context(|| "failed to execute 'podman run'")?;
        if !output.status.success() {
            return Err(explain_runtime_failure(anyhow!(
                "failed to create sandbox container '{}': {}",
                self.container_name,
                String::from_utf8_lossy(&output.stderr).trim()
            ))
            .await);
        }
        if self.creation_store_path.is_some() {
            let record = pending.transfer_record();
            let replaced = self
                .creation_record
                .lock()
                .expect("Podman creation record lock poisoned")
                .replace(record);
            debug_assert!(
                replaced.is_none(),
                "a sandbox session may own only one pending Podman creation record"
            );
        } else {
            pending.disarm();
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

    #[cfg(test)]
    fn create_container_args(&self) -> Result<Vec<OsString>> {
        self.create_container_args_with_cidfile(None)
    }

    fn create_container_args_with_cidfile(
        &self,
        creation_record: Option<(&Path, &str)>,
    ) -> Result<Vec<OsString>> {
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

        if let Some((cidfile, ownership_token)) = creation_record {
            args.push(OsString::from("--cidfile"));
            args.push(cidfile.as_os_str().to_os_string());
            args.push(OsString::from("--label"));
            args.push(OsString::from(format!(
                "io.nac.creation-token={ownership_token}"
            )));
        }

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
    /// `Arc` references. `--ignore` makes absence idempotent while every real
    /// runtime failure remains visible to the lifecycle caller.
    #[expect(
        clippy::expect_used,
        reason = "poisoning the creation-record lock invalidates container cleanup ownership"
    )]
    pub(crate) async fn destroy(&self) -> Result<()> {
        destroy_owned_container(&self.session_key).await?;
        let creation_record = self
            .creation_record
            .lock()
            .expect("Podman creation record lock poisoned")
            .take();
        if let Some(record) = creation_record {
            record.remove();
        }
        Ok(())
    }
}

impl Drop for PodmanSession {
    #[expect(
        clippy::expect_used,
        reason = "poisoning the mutable creation record invalidates rollback ownership"
    )]
    fn drop(&mut self) {
        if !self.cleanup_on_drop.load(Ordering::Acquire) {
            return;
        }

        let removed = match StdCommand::new("podman")
            .arg("rm")
            .arg("--ignore")
            .arg("-f")
            .arg(&self.container_name)
            .stdout(StdStdio::null())
            .stderr(StdStdio::null())
            .status()
        {
            Ok(status) if status.success() => true,
            Ok(status) => {
                eprintln!(
                    "nac: failed to roll back fresh sandbox container '{}' (status {status})",
                    self.container_name
                );
                false
            }
            Err(error) => {
                eprintln!(
                    "nac: failed to execute rollback for fresh sandbox container '{}': {error}",
                    self.container_name
                );
                false
            }
        };
        if removed {
            if let Some(record) = self
                .creation_record
                .get_mut()
                .expect("Podman creation record lock poisoned")
                .take()
            {
                record.remove();
            }
        }
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
#[path = "podman_tests.rs"]
mod tests;
