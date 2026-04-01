use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};

mod podman;

pub const DEFAULT_SANDBOX_IMAGE: &str = "python:3.13-bookworm";
pub const DEFAULT_SANDBOX_WORKDIR: &str = "/workspace";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MountSpec {
    pub host: PathBuf,
    pub guest: PathBuf,
    pub read_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxSpec {
    pub image: String,
    pub mounts: Vec<MountSpec>,
    pub workdir: PathBuf,
}

#[derive(Clone)]
pub struct SandboxSession {
    inner: Arc<podman::PodmanSession>,
}

impl SandboxSession {
    pub async fn create(spec: SandboxSpec, session_key: String, owner: bool) -> Result<Self> {
        let inner = Arc::new(podman::PodmanSession::new(spec, session_key, owner));
        inner.ensure_ready().await?;
        Ok(Self { inner })
    }

    pub fn workdir_display(&self) -> String {
        self.inner.spec().workdir.display().to_string()
    }

    pub fn image(&self) -> &str {
        &self.inner.spec().image
    }

    pub fn status_text(&self) -> String {
        format!("on (podman, image={})", self.image())
    }

    pub fn worker_cli_args(&self) -> Vec<OsString> {
        self.inner.worker_cli_args()
    }

    pub fn resolve_path(&self, path: &str) -> Result<PathBuf> {
        let requested = PathBuf::from(path);
        let spec = self.inner.spec();

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
        self.inner.exec(program, args, stdin).await
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

pub fn build_sandbox_spec(
    image: String,
    workdir: String,
    mounts: Vec<MountSpec>,
) -> Result<SandboxSpec> {
    let workdir = PathBuf::from(workdir);
    if !workdir.is_absolute() {
        return Err(anyhow!(
            "sandbox workdir '{}' must be an absolute path",
            workdir.display()
        ));
    }

    Ok(SandboxSpec {
        image,
        mounts,
        workdir,
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
        let session = SandboxSession {
            inner: Arc::new(podman::PodmanSession::new(
                SandboxSpec {
                    image: DEFAULT_SANDBOX_IMAGE.to_string(),
                    mounts: vec![mount],
                    workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                },
                "test-session".to_string(),
                false,
            )),
        };

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
