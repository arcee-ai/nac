use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio as StdStdio;
use std::process::{Command as StdCommand, Stdio};

use anyhow::{bail, Context, Result};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::{MountSpec, SandboxSpec};

pub(crate) struct PodmanSession {
    spec: SandboxSpec,
    session_key: String,
    owner: bool,
    container_name: String,
}

impl PodmanSession {
    pub(crate) fn new(spec: SandboxSpec, session_key: String, owner: bool) -> Self {
        let container_name = format!("nac-{}", sanitize_name(&session_key));
        Self {
            spec,
            session_key,
            owner,
            container_name,
        }
    }

    pub(crate) fn spec(&self) -> &SandboxSpec {
        &self.spec
    }

    pub(crate) async fn ensure_ready(&self) -> Result<()> {
        let exists = self.container_exists().await?;
        if !exists {
            if !self.owner {
                bail!(
                    "sandbox session '{}' is not available; start the parent nac process first",
                    self.session_key
                );
            }
            self.create_container().await?;
            return Ok(());
        }

        if !self.container_running().await? {
            self.start_container().await?;
        }

        Ok(())
    }

    pub(crate) fn worker_cli_args(&self) -> Vec<OsString> {
        let mut args = vec![
            OsString::from("--sandbox"),
            OsString::from("--no-mount-cwd"),
            OsString::from("--sandbox-image"),
            OsString::from(self.spec.image.clone()),
            OsString::from("--sandbox-workdir"),
            OsString::from(self.spec.workdir.display().to_string()),
            OsString::from("--sandbox-session-key"),
            OsString::from(self.session_key.clone()),
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

        args
    }

    pub(crate) async fn exec(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<Vec<u8>>,
    ) -> Result<std::process::Output> {
        let mut command = Command::new("podman");
        command
            .arg("exec")
            .arg("--workdir")
            .arg(&self.spec.workdir)
            .arg(&self.container_name)
            .arg(program);
        for arg in args {
            command.arg(arg);
        }

        if stdin.is_some() {
            command.stdin(Stdio::piped());
        }
        command.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .with_context(|| "failed to spawn 'podman exec'")?;

        if let Some(input) = stdin {
            if let Some(mut stdin_pipe) = child.stdin.take() {
                stdin_pipe.write_all(&input).await?;
            }
        }

        child
            .wait_with_output()
            .await
            .with_context(|| "failed to wait for 'podman exec'")
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
            bail!(
                "failed to create sandbox container '{}': {}",
                self.container_name,
                String::from_utf8_lossy(&output.stderr).trim()
            );
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
            bail!(
                "failed to start sandbox container '{}': {}",
                self.container_name,
                String::from_utf8_lossy(&output.stderr).trim()
            );
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
        ];

        if let Some((uid, gid)) = current_uid_gid() {
            args.push(OsString::from("--user"));
            args.push(OsString::from(format!("{uid}:{gid}")));
        }

        for mount in &self.spec.mounts {
            args.push(OsString::from("-v"));
            args.push(OsString::from(volume_arg(mount)));
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
            .status();
    }
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

fn sanitize_name(input: &str) -> String {
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

fn shell_escape_path(path: &PathBuf) -> String {
    path.display().to_string().replace('\'', "'\"'\"'")
}

#[cfg(unix)]
fn current_uid_gid() -> Option<(u32, u32)> {
    Some((unsafe { libc::geteuid() }, unsafe { libc::getegid() }))
}

#[cfg(not(unix))]
fn current_uid_gid() -> Option<(u32, u32)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{DEFAULT_SANDBOX_IMAGE, DEFAULT_SANDBOX_WORKDIR};

    fn sample_session() -> PodmanSession {
        PodmanSession::new(
            SandboxSpec {
                image: DEFAULT_SANDBOX_IMAGE.to_string(),
                mounts: vec![MountSpec {
                    host: PathBuf::from("/tmp/project"),
                    guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                    read_only: false,
                }],
                workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
            },
            "abc123".to_string(),
            false,
        )
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
        assert!(rendered
            .iter()
            .any(|value| value.contains("sleep infinity")));
    }
}
