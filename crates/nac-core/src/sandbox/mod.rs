use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use portable_pty::CommandBuilder as PtyCommandBuilder;
use serde::{Deserialize, Serialize};

mod backend;
mod podman;
mod smolvm;
mod ssh;

#[cfg(test)]
pub use backend::execution_backend_from_sandbox;
pub use backend::{select_execution_backend, ExecutionBackend, FileIoMode};
pub use ssh::SshBackend;

pub const DEFAULT_SANDBOX_IMAGE: &str = "python:3.13-bookworm";
pub const DEFAULT_SANDBOX_WORKDIR: &str = "/workspace";

/// Identifies which sandbox backend implementation to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxBackendType {
    Podman,
    SmolVm,
}

impl Default for SandboxBackendType {
    fn default() -> Self {
        SandboxBackendType::Podman
    }
}

impl SandboxBackendType {
    pub fn as_str(&self) -> &'static str {
        match self {
            SandboxBackendType::Podman => "podman",
            SandboxBackendType::SmolVm => "smolvm",
        }
    }

    pub fn from_str(s: &str) -> Result<Self> {
        match s {
            "podman" => Ok(Self::Podman),
            "smolvm" => Ok(Self::SmolVm),
            other => Err(anyhow!(
                "invalid sandbox backend '{}': expected 'podman' or 'smolvm'",
                other
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
pub struct SandboxSpec {
    pub backend: SandboxBackendType,
    pub image: String,
    pub mounts: Vec<MountSpec>,
    pub workdir: PathBuf,
    pub gpu_devices: Vec<String>,
    pub shm_size: Option<String>,
    pub cpus: u8,
    pub memory_mib: u32,
}

#[derive(Clone)]
#[allow(private_interfaces)]
pub enum SandboxSession {
    Podman(Arc<podman::PodmanSession>),
    SmolVm(Arc<smolvm::SmolVmSession>),
}

impl SandboxSession {
    pub async fn create(spec: SandboxSpec, session_key: String, owner: bool) -> Result<Self> {
        let session = match spec.backend {
            SandboxBackendType::Podman => {
                let inner = Arc::new(podman::PodmanSession::new(spec, session_key, owner));
                inner.ensure_ready().await?;
                Self::Podman(inner)
            }
            SandboxBackendType::SmolVm => {
                let inner = Arc::new(smolvm::SmolVmSession::new(spec, session_key, owner));
                inner.ensure_ready().await?;
                Self::SmolVm(inner)
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

    pub fn image(&self) -> &str {
        &self.spec().image
    }

    pub fn spec(&self) -> &SandboxSpec {
        match self {
            Self::Podman(inner) => inner.spec(),
            Self::SmolVm(inner) => inner.spec(),
        }
    }

    pub fn status_text(&self) -> String {
        let backend = self.spec().backend.as_str();
        format!("on ({backend}, image={})", self.image())
    }

    pub async fn ensure_ready(&self) -> Result<()> {
        match self {
            Self::Podman(inner) => inner.ensure_ready().await,
            Self::SmolVm(inner) => inner.ensure_ready().await,
        }
    }

    pub fn worker_cli_args(&self) -> Vec<OsString> {
        match self {
            Self::Podman(inner) => inner.worker_cli_args(),
            Self::SmolVm(inner) => inner.worker_cli_args(),
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
                "Path '{}' is not mounted into the sandbox. Use /workspace or an explicitly mounted guest path.",
                path
            ));
        }

        Ok(requested)
    }

    pub async fn exec(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<Vec<u8>>,
    ) -> Result<std::process::Output> {
        match self {
            Self::Podman(inner) => inner.exec(program, args, stdin).await,
            Self::SmolVm(inner) => inner.exec(program, args, stdin).await,
        }
    }

    pub fn child_process_command(
        &self,
        program: &str,
        args: &[String],
        envs: &[(String, String)],
    ) -> tokio::process::Command {
        match self {
            Self::Podman(inner) => inner.child_process_command(program, args, envs),
            Self::SmolVm(inner) => inner.child_process_command(program, args, envs),
        }
    }

    pub fn terminal_pty_command(
        &self,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (PtyCommandBuilder, String) {
        match self {
            Self::Podman(inner) => inner.terminal_pty_command(cwd, envs),
            Self::SmolVm(inner) => inner.terminal_pty_command(cwd, envs),
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
            Self::SmolVm(inner) => inner.terminal_pipe_command(cmd, cwd, envs),
        }
    }

    pub async fn terminal_pipe_kill(&self, pidfile: &str) -> Result<()> {
        match self {
            Self::Podman(inner) => inner.terminal_pipe_kill(pidfile).await,
            Self::SmolVm(inner) => inner.terminal_pipe_kill(pidfile).await,
        }
    }

    /// Explicitly destroy the sandbox (container or VM), regardless of
    /// remaining `Arc` references.  Best-effort and idempotent.  Only
    /// acts if this session is the owner.
    pub async fn destroy(&self) -> Result<()> {
        match self {
            Self::Podman(inner) => inner.destroy().await,
            Self::SmolVm(inner) => inner.destroy().await,
        }
    }

    #[cfg(test)]
    pub(crate) fn new_for_test(spec: SandboxSpec) -> Self {
        match spec.backend {
            SandboxBackendType::Podman => Self::Podman(Arc::new(podman::PodmanSession::new(
                spec,
                "test-session".to_string(),
                false,
            ))),
            SandboxBackendType::SmolVm => Self::SmolVm(Arc::new(smolvm::SmolVmSession::new(
                spec,
                "test-session".to_string(),
                false,
            ))),
        }
    }
}

pub fn parse_mount_spec(raw: &str, read_only: bool, cwd: &Path) -> Result<MountSpec> {
    let (host_raw, guest_raw) = raw
        .split_once(':')
        .ok_or_else(|| anyhow!("invalid mount '{}': expected HOST:GUEST", raw))?;

    if host_raw.is_empty() || guest_raw.is_empty() {
        return Err(anyhow!("invalid mount '{}': expected HOST:GUEST", raw));
    }

    let host = absolutize_host_path(host_raw, cwd)
        .with_context(|| format!("invalid host path in mount '{}'", raw))?;
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
    for mount in &spec.mounts {
        if spec.workdir.starts_with(&mount.guest) {
            let suffix = spec
                .workdir
                .strip_prefix(&mount.guest)
                .unwrap_or_else(|_| Path::new(""));
            return Some(join_host_path(&mount.host, suffix));
        }
    }
    None
}

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

#[cfg(test)]
mod tests {
    use super::*;

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
            backend: SandboxBackendType::Podman,
            image: DEFAULT_SANDBOX_IMAGE.to_string(),
            mounts: vec![mount],
            workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
            gpu_devices: Vec::new(),
            shm_size: Some("0".to_string()),
            cpus: 2,
            memory_mib: 2048,
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
    }
}
