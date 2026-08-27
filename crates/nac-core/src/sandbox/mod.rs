use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use portable_pty::CommandBuilder as PtyCommandBuilder;
use serde::{Deserialize, Serialize};

mod backend;
mod podman;
pub(crate) mod session_worktree;
mod ssh;
mod ssh_browse;
pub(crate) mod ssh_command;

#[cfg(test)]
pub use backend::execution_backend_from_sandbox;
pub use backend::{select_execution_backend, ExecutionBackend, FileIoMode};
pub use ssh::SshBackend;
pub use ssh_browse::{browse_remote_directory, RemoteBrowseError, RemoteEntry, RemoteListing};
pub use ssh_command::SshConnection;

pub const DEFAULT_SANDBOX_IMAGE: &str = "python:3.13-bookworm";
pub const DEFAULT_SANDBOX_WORKDIR: &str = "/workspace";

/// Whether the sandbox runtime (podman) can be used on this host right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "kebab-case")]
pub enum SandboxAvailabilityStatus {
    Ready,
    /// The `podman` binary was not found.
    Missing,
    /// Installed but not answering: on macOS usually a stopped or missing
    /// `podman machine`.
    Unavailable,
}

/// The result of probing the sandbox runtime, with the steps that would make
/// it usable. Surfaced by the API so launch UIs can warn before a session
/// fails, and embedded in session-creation errors for agents driving the MCP.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SandboxAvailability {
    pub status: SandboxAvailabilityStatus,
    /// Why the runtime is unusable, when it is.
    pub detail: Option<String>,
    /// Platform-specific commands that would make it usable.
    pub guidance: Option<String>,
}

impl SandboxAvailability {
    pub fn available(&self) -> bool {
        self.status == SandboxAvailabilityStatus::Ready
    }

    /// The availability problem as a single human-readable sentence, guidance
    /// included. This is what session creation errors carry.
    pub fn message(&self) -> String {
        let problem = match self.status {
            SandboxAvailabilityStatus::Ready => return "sandbox runtime is available".to_string(),
            SandboxAvailabilityStatus::Missing => "podman is not installed".to_string(),
            SandboxAvailabilityStatus::Unavailable => match &self.detail {
                Some(detail) => format!("podman is installed but not responding ({detail})"),
                None => "podman is installed but not responding".to_string(),
            },
        };
        match &self.guidance {
            Some(guidance) => format!("sandbox requested but {problem}. To fix:\n{guidance}"),
            None => format!("sandbox requested but {problem}"),
        }
    }
}

/// Probes the sandbox runtime. Costs two subprocess spawns, so callers on hot
/// paths should only probe when an operation has already failed.
pub async fn probe_availability() -> SandboxAvailability {
    podman::probe_availability().await
}

/// What sandbox setup is currently doing for one launching session, for UIs
/// waiting on a launch. Sandbox creation can take minutes (a first image
/// pull), and without this the only signal is a hung request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SandboxActivity {
    pub phase: String,
    pub since_epoch_ms: u64,
}

/// In-flight sandbox setups, keyed by the launch's activity key (a
/// client-supplied launch id when one was sent, else the sandbox session
/// key). Keyed rather than a single slot so concurrent launches do not
/// clobber each other's phase and a polling UI only ever sees its own
/// launch's progress.
static CURRENT_ACTIVITY: std::sync::LazyLock<
    std::sync::RwLock<std::collections::HashMap<String, SandboxActivity>>,
> = std::sync::LazyLock::new(|| std::sync::RwLock::new(std::collections::HashMap::new()));

/// The sandbox setup in progress for `key`, if any.
pub fn current_activity(key: &str) -> Option<SandboxActivity> {
    CURRENT_ACTIVITY.read().ok()?.get(key).cloned()
}

pub(crate) fn report_activity(key: &str, phase: impl Into<String>) {
    let since_epoch_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    if let Ok(mut current) = CURRENT_ACTIVITY.write() {
        current.insert(
            key.to_string(),
            SandboxActivity {
                phase: phase.into(),
                since_epoch_ms,
            },
        );
    }
}

pub(crate) fn clear_activity(key: &str) {
    if let Ok(mut current) = CURRENT_ACTIVITY.write() {
        current.remove(key);
    }
}

/// Identifies which sandbox backend implementation to use.
///
/// Kept as an enum (currently Podman-only) so a future sandbox rework has a
/// natural home for additional backends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum SandboxBackendType {
    #[default]
    Podman,
}

impl SandboxBackendType {
    pub fn as_str(&self) -> &'static str {
        match self {
            SandboxBackendType::Podman => "podman",
        }
    }

    pub fn from_str(s: &str) -> Result<Self> {
        match s {
            "podman" => Ok(Self::Podman),
            other => Err(anyhow!(
                "invalid sandbox backend '{other}': expected 'podman'"
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MountSpec {
    pub host: PathBuf,
    pub guest: PathBuf,
    pub read_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HostMountPath {
    pub root: PathBuf,
    pub relative: PathBuf,
    pub read_only: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HostPathResolution {
    Mapped(HostMountPath),
    UnsafeMounted { read_only: bool },
    Unmounted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HostWorkspaceMount {
    pub relative: PathBuf,
    pub source: HostMountPath,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxSpec {
    pub backend: SandboxBackendType,
    pub image: String,
    pub mounts: Vec<MountSpec>,
    pub workdir: PathBuf,
    pub gpu_devices: Vec<String>,
    pub shm_size: Option<String>,
    pub cpus: u8,
    pub memory_mib: u32,
    pub worktree: Option<SandboxWorktree>,
}

impl Default for SandboxSpec {
    /// The out-of-the-box sandbox: podman running the default image with the
    /// default workdir and no extra mounts. Exists so tests and fixtures can
    /// override only the fields they care about.
    fn default() -> Self {
        Self {
            backend: SandboxBackendType::default(),
            image: DEFAULT_SANDBOX_IMAGE.to_string(),
            mounts: Vec::new(),
            workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
            gpu_devices: Vec::new(),
            shm_size: None,
            cpus: 2,
            memory_mib: 2048,
            worktree: None,
        }
    }
}

/// The per-session worktree a sandboxed session runs in, when its working
/// directory was forked from a git repository instead of mounting the user's
/// live checkout. Recorded so a resumed session can re-attach the worktree and
/// a deleted session can clean it up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SandboxWorktree {
    /// The repository's working-tree root, used for git cleanup commands.
    pub repo_root: PathBuf,
    /// The worktree root on the host.
    pub path: PathBuf,
    /// Resolved nac-owned scratch directory. Persisting the absolute path keeps
    /// a relative `NAC_HOME` anchored to the launch cwd during later cleanup.
    #[serde(default)]
    pub scratch_root: PathBuf,
    /// The session branch (`nac/<key-prefix>`) the worktree has checked out.
    pub branch: String,
    /// The commit the branch forked from; compared against at cleanup to tell
    /// an untouched branch (deleted) from one holding session work (kept).
    pub fork_point: String,
}

impl SandboxWorktree {
    /// Whether the recorded path sits inside the nac-owned worktree scratch
    /// directory resolved at launch. Both values come from the session record,
    /// so canonicalization and strict descendant checks prevent `..` or symlink
    /// escapes. Missing legacy metadata fails closed.
    pub(crate) fn path_in_scratch_dir(&self) -> bool {
        if self.scratch_root.as_os_str().is_empty() {
            return false;
        }
        let Ok(scratch_root) = self.scratch_root.canonicalize() else {
            return false;
        };
        canonicalize_existing(&self.path)
            .is_some_and(|path| path != scratch_root && path.starts_with(&scratch_root))
    }
}

/// Canonicalizes the deepest existing ancestor of `path` and re-appends the
/// remaining components lexically, so a path that may already be deleted can
/// still be compared against a canonicalized root. A `..` or prefix
/// component bails out instead of being resolved.
fn canonicalize_existing(path: &Path) -> Option<PathBuf> {
    let mut missing = Vec::new();
    let mut current = path;
    loop {
        match current.canonicalize() {
            Ok(mut canonical) => {
                for component in missing.iter().rev() {
                    canonical.push(component);
                }
                return Some(canonical);
            }
            Err(_) => {
                missing.push(current.file_name()?);
                current = current.parent()?;
            }
        }
    }
}

#[derive(Clone)]
#[allow(private_interfaces)]
pub enum SandboxSession {
    Podman(Arc<podman::PodmanSession>),
}

impl SandboxSession {
    pub async fn create(
        spec: SandboxSpec,
        session_key: String,
        owner: bool,
        activity_key: String,
    ) -> Result<Self> {
        let session = match spec.backend {
            SandboxBackendType::Podman => {
                let inner = Arc::new(podman::PodmanSession::new(
                    spec,
                    session_key,
                    owner,
                    activity_key,
                ));
                inner.ensure_ready().await?;
                Self::Podman(inner)
            }
        };
        Ok(session)
    }

    pub(crate) async fn create_for_durable_launch(
        spec: SandboxSpec,
        session_key: String,
        owner: bool,
        activity_key: String,
        store_path: PathBuf,
    ) -> Result<Self> {
        let session = match spec.backend {
            SandboxBackendType::Podman => {
                let inner = Arc::new(podman::PodmanSession::new_for_durable_launch(
                    spec,
                    session_key,
                    owner,
                    activity_key,
                    store_path,
                ));
                inner.ensure_ready().await?;
                Self::Podman(inner)
            }
        };
        Ok(session)
    }

    pub(crate) async fn create_for_durable_resume(
        spec: SandboxSpec,
        session_key: String,
        activity_key: String,
    ) -> Result<Self> {
        let session = match spec.backend {
            SandboxBackendType::Podman => {
                let inner = Arc::new(podman::PodmanSession::new_for_durable_resume(
                    spec,
                    session_key,
                    activity_key,
                ));
                inner.ensure_ready().await?;
                Self::Podman(inner)
            }
        };
        Ok(session)
    }

    pub fn workdir_display(&self) -> String {
        self.spec().workdir.display().to_string()
    }

    pub fn host_workdir(&self) -> Option<PathBuf> {
        host_workdir_from_spec(self.spec())
    }

    pub(crate) fn host_workspace_mounts(&self) -> Option<Vec<HostWorkspaceMount>> {
        host_workspace_mounts_from_spec(self.spec())
    }

    pub fn image(&self) -> &str {
        &self.spec().image
    }

    pub fn spec(&self) -> &SandboxSpec {
        match self {
            Self::Podman(inner) => inner.spec(),
        }
    }

    /// Once the durable session row commits, explicit lifecycle deletion owns
    /// container cleanup. Process shutdown must not erase resumable state.
    pub(crate) fn retain_for_durable_session(&self) {
        match self {
            Self::Podman(inner) => inner.retain_for_durable_session(),
        }
    }

    pub(crate) fn disable_drop_cleanup(&self) {
        match self {
            Self::Podman(inner) => inner.disable_drop_cleanup(),
        }
    }

    pub fn status_text(&self) -> String {
        let backend = self.spec().backend.as_str();
        format!("on ({backend}, image={})", self.image())
    }

    pub async fn ensure_ready(&self) -> Result<()> {
        match self {
            Self::Podman(inner) => inner.ensure_ready().await,
        }
    }

    pub(crate) async fn materialize_worktree(&self) -> Result<()> {
        match self {
            Self::Podman(inner) => inner.materialize_worktree().await,
        }
    }

    pub fn worker_cli_args(&self) -> Vec<OsString> {
        match self {
            Self::Podman(inner) => inner.worker_cli_args(),
        }
    }

    pub fn resolve_path(&self, path: &str) -> Result<PathBuf> {
        let requested = PathBuf::from(path);
        let spec = self.spec();

        if requested.is_relative() {
            return Ok(spec.workdir.join(requested));
        }

        for mount in &spec.mounts {
            if requested.starts_with(&mount.host) {
                let suffix = requested
                    .strip_prefix(&mount.host)
                    .unwrap_or_else(|_| Path::new(""));
                return Ok(join_guest_path(&mount.guest, suffix));
            }
        }

        for mount in &spec.mounts {
            if requested.starts_with(&mount.guest) {
                return Ok(requested);
            }
        }

        if requested.starts_with(&spec.workdir) {
            return Ok(requested);
        }

        if requested.exists() {
            return Err(anyhow!(
                "Path '{path}' is not mounted into the sandbox. Use /workspace or an explicitly mounted guest path."
            ));
        }

        Ok(requested)
    }

    pub(crate) fn host_path_resolution_for_guest(&self, guest_path: &Path) -> HostPathResolution {
        let Some(guest_path) = normalize_guest_path(guest_path) else {
            return HostPathResolution::Unmounted;
        };
        let Some((mount, mount_guest)) = self
            .spec()
            .mounts
            .iter()
            .filter_map(|mount| {
                let normalized = normalize_guest_path(&mount.guest)?;
                guest_path
                    .starts_with(&normalized)
                    .then_some((mount, normalized))
            })
            .max_by_key(|(_, guest)| guest.components().count())
        else {
            return HostPathResolution::Unmounted;
        };
        let Ok(relative) = guest_path.strip_prefix(&mount_guest) else {
            return HostPathResolution::Unmounted;
        };
        if host_path_contains_symlink(&mount.host, relative) {
            return HostPathResolution::UnsafeMounted {
                read_only: mount.read_only,
            };
        }
        HostPathResolution::Mapped(HostMountPath {
            root: mount.host.clone(),
            relative: relative.to_path_buf(),
            read_only: mount.read_only,
        })
    }

    pub async fn exec(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<&[u8]>,
    ) -> Result<std::process::Output> {
        match self {
            Self::Podman(inner) => inner.exec(program, args, stdin).await,
        }
    }

    pub fn terminal_pty_command(
        &self,
        cmd: &str,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (PtyCommandBuilder, String) {
        match self {
            Self::Podman(inner) => inner.terminal_pty_command(cmd, cwd, envs),
        }
    }

    pub fn terminal_pipe_command(
        &self,
        cmd: &str,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (tokio::process::Command, String) {
        match self {
            Self::Podman(inner) => inner.terminal_pipe_command(cmd, cwd, envs),
        }
    }

    pub async fn terminal_pipe_kill(&self, pidfile: &str) -> Result<()> {
        match self {
            Self::Podman(inner) => inner.terminal_pipe_kill(pidfile).await,
        }
    }

    /// Explicitly destroy the sandbox (container or VM), regardless of
    /// remaining `Arc` references. Explicit lifecycle cleanup is authoritative
    /// even when this process attached as an observer.
    pub async fn destroy(&self) -> Result<()> {
        match self {
            Self::Podman(inner) => inner.destroy().await,
        }
    }

    #[cfg(test)]
    pub(crate) fn new_for_test(spec: SandboxSpec) -> Self {
        match spec.backend {
            SandboxBackendType::Podman => Self::Podman(Arc::new(podman::PodmanSession::new(
                spec,
                "test-session".to_string(),
                false,
                "test-session".to_string(),
            ))),
        }
    }
}

/// Best-effort recovery cleanup for an owned container whose in-memory owner
/// was lost in a process crash. Owned top-level containers use the durable
/// session id as their key, so deletion after restart can still address them.
pub async fn destroy_persisted_container(session_id: &str) -> Result<()> {
    podman::destroy_owned_container(session_id).await
}

/// Reconciles an interrupted fresh Podman launch against the durable session
/// store before the server begins accepting requests.
pub async fn reconcile_podman_creation_records(store_path: &Path) -> Result<()> {
    podman::reconcile_creation_records(store_path).await
}

pub fn parse_mount_spec(raw: &str, read_only: bool, cwd: &Path) -> Result<MountSpec> {
    let (host_raw, guest_raw) = raw
        .split_once(':')
        .ok_or_else(|| anyhow!("invalid mount '{raw}': expected HOST:GUEST"))?;

    if host_raw.is_empty() || guest_raw.is_empty() {
        return Err(anyhow!("invalid mount '{raw}': expected HOST:GUEST"));
    }

    let host = absolutize_host_path(host_raw, cwd)
        .with_context(|| format!("invalid host path in mount '{raw}'"))?;
    if !host.exists() {
        return Err(anyhow!("mount source '{}' does not exist", host.display()));
    }

    let guest = PathBuf::from(guest_raw);
    if !guest.is_absolute() {
        return Err(anyhow!(
            "mount target '{}' must be an absolute path inside the sandbox",
            guest.display()
        ));
    }

    Ok(MountSpec {
        host,
        guest,
        read_only,
    })
}

pub(crate) fn host_workdir_from_spec(spec: &SandboxSpec) -> Option<PathBuf> {
    host_workdir_mount_from_spec(spec).map(|mount| join_host_path(&mount.root, &mount.relative))
}

fn host_workdir_mount_from_spec(spec: &SandboxSpec) -> Option<HostMountPath> {
    let workdir = normalize_guest_path(&spec.workdir)?;
    let (_, mount, mount_guest) = spec
        .mounts
        .iter()
        .enumerate()
        .filter_map(|(index, mount)| {
            let guest = normalize_guest_path(&mount.guest)?;
            workdir.starts_with(&guest).then_some((index, mount, guest))
        })
        .max_by_key(|(_, _, guest)| guest.components().count())?;
    let relative = workdir.strip_prefix(&mount_guest).ok()?.to_path_buf();
    if host_path_contains_symlink(&mount.host, &relative) {
        return None;
    }
    Some(HostMountPath {
        root: mount.host.clone(),
        relative,
        read_only: mount.read_only,
    })
}

fn host_workspace_mounts_from_spec(spec: &SandboxSpec) -> Option<Vec<HostWorkspaceMount>> {
    let workdir = normalize_guest_path(&spec.workdir)?;
    let base = host_workdir_mount_from_spec(spec)?;
    let mut mounts = vec![HostWorkspaceMount {
        relative: PathBuf::new(),
        source: base,
    }];
    for mount in &spec.mounts {
        let guest = normalize_guest_path(&mount.guest)?;
        if guest == workdir || !guest.starts_with(&workdir) {
            continue;
        }
        let relative = guest.strip_prefix(&workdir).ok()?.to_path_buf();
        let candidate = HostWorkspaceMount {
            relative: relative.clone(),
            source: HostMountPath {
                root: mount.host.clone(),
                relative: PathBuf::new(),
                read_only: mount.read_only,
            },
        };
        if let Some(existing) = mounts.iter_mut().find(|entry| entry.relative == relative) {
            *existing = candidate;
        } else {
            mounts.push(candidate);
        }
    }
    mounts.sort_by_key(|mount| mount.relative.components().count());
    Some(mounts)
}

#[allow(clippy::too_many_arguments)]
pub fn build_sandbox_spec(
    backend: SandboxBackendType,
    image: String,
    workdir: String,
    mounts: Vec<MountSpec>,
    gpu_devices: Vec<String>,
    shm_size: Option<String>,
    cpus: u8,
    memory_mib: u32,
) -> Result<SandboxSpec> {
    let workdir = PathBuf::from(workdir);
    if !workdir.is_absolute() {
        return Err(anyhow!(
            "sandbox workdir '{}' must be an absolute path",
            workdir.display()
        ));
    }

    Ok(SandboxSpec {
        backend,
        image,
        mounts,
        workdir,
        gpu_devices,
        shm_size,
        cpus,
        memory_mib,
        worktree: None,
    })
}

fn absolutize_host_path(raw: &str, cwd: &Path) -> Result<PathBuf> {
    let path = PathBuf::from(raw);
    let joined = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    joined
        .canonicalize()
        .with_context(|| format!("failed to canonicalize '{}'", joined.display()))
}

fn join_guest_path(base: &Path, suffix: &Path) -> PathBuf {
    join_path(base, suffix)
}

fn join_host_path(base: &Path, suffix: &Path) -> PathBuf {
    join_path(base, suffix)
}

fn normalize_guest_path(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }

    let mut normalized = PathBuf::from("/");
    for component in path.components() {
        match component {
            std::path::Component::RootDir | std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::Normal(part) => normalized.push(part),
            std::path::Component::Prefix(_) => return None,
        }
    }
    Some(normalized)
}

fn join_path(base: &Path, suffix: &Path) -> PathBuf {
    if suffix.as_os_str().is_empty() {
        return base.to_path_buf();
    }
    let mut out = base.to_path_buf();
    for component in suffix.components() {
        if let std::path::Component::Normal(part) = component {
            out.push(part);
        }
    }
    out
}

fn host_path_contains_symlink(root: &Path, relative: &Path) -> bool {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(part) = component else {
            return true;
        };
        current.push(part);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => return true,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return false,
            Err(_) => return true,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sets NAC_HOME to a fresh temp dir for the duration of a guard test.
    /// Returns the dir and the prior value so the test can restore it.
    fn scratch_nac_home(label: &str) -> (PathBuf, Option<std::ffi::OsString>) {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let nac_home = std::env::temp_dir().join(format!(
            "nac-scratch-guard-{label}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        let original = std::env::var_os("NAC_HOME");
        unsafe { std::env::set_var("NAC_HOME", &nac_home) };
        (nac_home, original)
    }

    fn restore_nac_home(original: Option<std::ffi::OsString>) {
        unsafe {
            match original {
                Some(value) => std::env::set_var("NAC_HOME", value),
                None => std::env::remove_var("NAC_HOME"),
            }
        }
    }

    fn worktree_at(path: PathBuf) -> SandboxWorktree {
        SandboxWorktree {
            repo_root: PathBuf::from("/repo"),
            path,
            scratch_root: crate::paths::nac_home_dir()
                .unwrap()
                .join("worktrees")
                .canonicalize()
                .unwrap(),
            branch: "nac/key".to_string(),
            fork_point: "abc123".to_string(),
        }
    }

    #[test]
    fn scratch_guard_approves_only_paths_under_the_real_nac_home() {
        let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
        let (nac_home, original) = scratch_nac_home("anchor");
        let scratch = nac_home.join("worktrees");

        // A real session worktree path is approved, existing or not.
        let session_dir = scratch.join("session-key");
        std::fs::create_dir_all(&session_dir).unwrap();
        assert!(worktree_at(session_dir.clone()).path_in_scratch_dir());
        std::fs::remove_dir_all(&session_dir).unwrap();
        assert!(worktree_at(session_dir).path_in_scratch_dir());

        // A path whose parent is merely NAMED worktrees is rejected: the
        // guard is anchored to the resolved nac home, not to the name.
        let impostor = std::env::temp_dir().join("nac-scratch-guard-impostor/worktrees/key");
        std::fs::create_dir_all(&impostor).unwrap();
        assert!(!worktree_at(impostor).path_in_scratch_dir());

        // The scratch root itself and paths outside it are rejected.
        assert!(!worktree_at(scratch.clone()).path_in_scratch_dir());
        assert!(!worktree_at(nac_home.join("other/key")).path_in_scratch_dir());

        // A `..` escape that lexically sits under the scratch dir is rejected.
        assert!(!worktree_at(scratch.join("../worktrees/../nac.toml")).path_in_scratch_dir());

        // A symlink inside the scratch dir pointing outside it is rejected.
        #[cfg(unix)]
        {
            let outside = nac_home.join("outside");
            std::fs::create_dir_all(&outside).unwrap();
            let link = scratch.join("link");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(!worktree_at(link).path_in_scratch_dir());
        }

        restore_nac_home(original);
        let _ = std::fs::remove_dir_all(&nac_home);
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join("nac-scratch-guard-impostor"));
    }

    #[test]
    fn scratch_guard_follows_a_symlinked_nac_home() {
        let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
        let (nac_home, original) = scratch_nac_home("symlinked");
        let scratch = nac_home.join("worktrees");
        // Resolve through a symlinked NAC_HOME: the recorded path may carry
        // the unresolved prefix while the guard canonicalizes both sides.
        let canonical_scratch = scratch.canonicalize().unwrap();
        let session_dir = canonical_scratch.join("session-key");
        std::fs::create_dir_all(&session_dir).unwrap();
        assert!(worktree_at(session_dir).path_in_scratch_dir());

        restore_nac_home(original);
        let _ = std::fs::remove_dir_all(&nac_home);
    }

    #[test]
    fn activity_is_reported_and_cleared_per_key() {
        assert_eq!(current_activity("launch-a"), None);
        report_activity("launch-a", "pulling image python:3.13-bookworm");
        report_activity("launch-b", "starting the sandbox container");
        let activity = current_activity("launch-a").expect("activity must be reported");
        assert!(activity.phase.contains("pulling image"));
        assert!(activity.since_epoch_ms > 0);
        // Concurrent launches do not clobber each other.
        assert_eq!(
            current_activity("launch-b").unwrap().phase,
            "starting the sandbox container"
        );
        report_activity("launch-a", "starting the sandbox container");
        assert_eq!(
            current_activity("launch-a").unwrap().phase,
            "starting the sandbox container"
        );
        clear_activity("launch-a");
        assert_eq!(current_activity("launch-a"), None);
        assert!(current_activity("launch-b").is_some());
        clear_activity("launch-b");
    }

    #[test]
    fn availability_message_combines_problem_and_guidance() {
        let missing = SandboxAvailability {
            status: SandboxAvailabilityStatus::Missing,
            detail: None,
            guidance: Some("brew install podman".to_string()),
        };
        assert!(!missing.available());
        let message = missing.message();
        assert!(
            message.contains("podman is not installed"),
            "got: {message}"
        );
        assert!(message.contains("brew install podman"), "got: {message}");

        let unavailable = SandboxAvailability {
            status: SandboxAvailabilityStatus::Unavailable,
            detail: Some("cannot connect to Podman socket".to_string()),
            guidance: None,
        };
        let message = unavailable.message();
        assert!(
            message.contains("not responding") && message.contains("cannot connect"),
            "got: {message}"
        );

        let ready = SandboxAvailability {
            status: SandboxAvailabilityStatus::Ready,
            detail: None,
            guidance: None,
        };
        assert!(ready.available());
    }

    #[test]
    fn parse_mount_spec_normalizes_relative_host_path() {
        let cwd = std::env::current_dir().unwrap();
        let mount = parse_mount_spec(".:/sandbox/crates", true, &cwd).unwrap();
        assert!(mount.host.is_absolute());
        assert_eq!(mount.guest, PathBuf::from("/sandbox/crates"));
        assert!(mount.read_only);
    }

    #[test]
    fn resolve_relative_and_host_absolute_paths() {
        let cwd = std::env::current_dir().unwrap();
        let mount = MountSpec {
            host: cwd.clone(),
            guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
            read_only: false,
        };
        let session = SandboxSession::new_for_test(SandboxSpec {
            mounts: vec![mount],
            shm_size: Some("0".to_string()),
            ..Default::default()
        });

        assert_eq!(session.host_workdir().unwrap(), cwd);

        assert_eq!(
            session.resolve_path("Cargo.toml").unwrap(),
            PathBuf::from("/workspace/Cargo.toml")
        );
        assert_eq!(
            session
                .resolve_path(&cwd.join("Cargo.toml").display().to_string())
                .unwrap(),
            PathBuf::from("/workspace/Cargo.toml")
        );
        assert_eq!(
            session.host_path_resolution_for_guest(Path::new("/workspace/src/lib.rs")),
            HostPathResolution::Mapped(HostMountPath {
                root: cwd.clone(),
                relative: PathBuf::from("src/lib.rs"),
                read_only: false,
            })
        );
        assert_eq!(
            session.host_path_resolution_for_guest(Path::new("/tmp/unmounted")),
            HostPathResolution::Unmounted
        );
        assert_eq!(
            session.host_path_resolution_for_guest(Path::new("/workspace/../workspace/src/lib.rs")),
            HostPathResolution::Mapped(HostMountPath {
                root: cwd,
                relative: PathBuf::from("src/lib.rs"),
                read_only: false,
            })
        );
    }

    #[test]
    fn host_mapping_prefers_the_most_specific_mount_and_preserves_read_only() {
        let session = SandboxSession::new_for_test(SandboxSpec {
            mounts: vec![
                MountSpec {
                    host: PathBuf::from("/host/workspace"),
                    guest: PathBuf::from("/workspace"),
                    read_only: false,
                },
                MountSpec {
                    host: PathBuf::from("/host/vendor"),
                    guest: PathBuf::from("/workspace/vendor"),
                    read_only: true,
                },
            ],
            shm_size: Some("0".to_string()),
            ..Default::default()
        });

        assert_eq!(
            session.host_path_resolution_for_guest(Path::new("/workspace/vendor/lib.rs")),
            HostPathResolution::Mapped(HostMountPath {
                root: PathBuf::from("/host/vendor"),
                relative: PathBuf::from("lib.rs"),
                read_only: true,
            })
        );
        assert_eq!(
            session.host_workdir(),
            Some(PathBuf::from("/host/workspace"))
        );
        assert_eq!(
            session.host_workspace_mounts(),
            Some(vec![
                HostWorkspaceMount {
                    relative: PathBuf::new(),
                    source: HostMountPath {
                        root: PathBuf::from("/host/workspace"),
                        relative: PathBuf::new(),
                        read_only: false,
                    },
                },
                HostWorkspaceMount {
                    relative: PathBuf::from("vendor"),
                    source: HostMountPath {
                        root: PathBuf::from("/host/vendor"),
                        relative: PathBuf::new(),
                        read_only: true,
                    },
                },
            ])
        );
    }

    #[test]
    fn host_workdir_uses_the_deepest_mount_that_contains_it() {
        let session = SandboxSession::new_for_test(SandboxSpec {
            mounts: vec![
                MountSpec {
                    host: PathBuf::from("/host/workspace"),
                    guest: PathBuf::from("/workspace"),
                    read_only: false,
                },
                MountSpec {
                    host: PathBuf::from("/host/vendor"),
                    guest: PathBuf::from("/workspace/vendor"),
                    read_only: true,
                },
            ],
            workdir: PathBuf::from("/workspace/vendor"),
            shm_size: Some("0".to_string()),
            ..Default::default()
        });

        assert_eq!(session.host_workdir(), Some(PathBuf::from("/host/vendor")));
    }

    #[cfg(unix)]
    #[test]
    fn host_mapping_falls_back_for_symlinked_mount_paths() {
        use std::os::unix::fs::symlink;

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nac_sandbox_symlink_mapping_{}_{unique}",
            std::process::id()
        ));
        let mount_root = root.join("mount");
        let outside = root.join("outside");
        std::fs::create_dir_all(&mount_root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, mount_root.join("escape")).unwrap();

        let session = SandboxSession::new_for_test(SandboxSpec {
            mounts: vec![MountSpec {
                host: mount_root.clone(),
                guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                read_only: false,
            }],
            shm_size: Some("0".to_string()),
            ..Default::default()
        });

        let mapped =
            session.host_path_resolution_for_guest(Path::new("/workspace/escape/file.txt"));
        assert_eq!(
            mapped,
            HostPathResolution::UnsafeMounted { read_only: false }
        );

        let workdir_session = SandboxSession::new_for_test(SandboxSpec {
            mounts: vec![MountSpec {
                host: mount_root,
                guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                read_only: false,
            }],
            workdir: PathBuf::from("/workspace/escape"),
            shm_size: Some("0".to_string()),
            ..Default::default()
        });
        assert_eq!(workdir_session.host_workdir(), None);
        let _ = std::fs::remove_dir_all(root);
    }
}
