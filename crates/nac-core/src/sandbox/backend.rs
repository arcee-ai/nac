//! Closed execution target abstraction for agent commands and file IO.
//!
//! The supported targets are deliberately finite: local host execution, a
//! Podman [`SandboxSession`], or an OpenSSH [`super::SshBackend`]. Keeping this
//! as an enum avoids trait-object/boxed-future plumbing while still giving
//! tools and terminals one small surface to call.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use anyhow::{Context, Result};
use portable_pty::CommandBuilder as PtyCommandBuilder;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::SandboxSession;

/// How the `read`/`write`/`edit` tools reach the target filesystem.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileIoMode {
    /// The workspace filesystem is directly accessible from this process;
    /// file tools use native Rust file IO.
    Native,
    /// The workspace filesystem is reachable only by executing helper scripts
    /// on the target (Podman container or SSH host).
    RemoteExec,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionTargetKind {
    Local,
    Sandbox,
    Ssh,
}

/// Where commands spawned on behalf of the agent execute.
pub enum ExecutionBackend {
    Local { workspace_cwd: PathBuf },
    Sandbox(SandboxSession),
    Ssh(super::SshBackend),
}

impl ExecutionBackend {
    #[cfg(test)]
    pub fn kind(&self) -> ExecutionTargetKind {
        match self {
            Self::Local { .. } => ExecutionTargetKind::Local,
            Self::Sandbox(_) => ExecutionTargetKind::Sandbox,
            Self::Ssh(_) => ExecutionTargetKind::Ssh,
        }
    }

    pub fn file_io(&self) -> FileIoMode {
        match self {
            Self::Local { .. } => FileIoMode::Native,
            Self::Sandbox(_) | Self::Ssh(_) => FileIoMode::RemoteExec,
        }
    }

    pub fn remote_io_label(&self) -> &'static str {
        match self {
            Self::Local { .. } => "local workspace",
            Self::Sandbox(_) => "sandbox",
            Self::Ssh(_) => "remote host",
        }
    }

    /// Bring the target to a usable state (e.g. start a container or verify ssh).
    /// Cheap when already ready.
    pub async fn ensure_ready(&self) -> Result<()> {
        match self {
            Self::Local { .. } => Ok(()),
            Self::Sandbox(session) => session.inner.ensure_ready().await,
            Self::Ssh(ssh) => ssh.ensure_ready().await,
        }
    }

    /// Map a user/tool supplied path to the namespace commands run in.
    pub fn resolve_path(&self, path: &str) -> Result<PathBuf> {
        match self {
            Self::Local { workspace_cwd } => {
                let requested = PathBuf::from(path);
                if requested.is_absolute() {
                    Ok(requested)
                } else {
                    Ok(workspace_cwd.join(requested))
                }
            }
            Self::Sandbox(session) => session.resolve_path(path),
            Self::Ssh(ssh) => ssh.resolve_path(path),
        }
    }

    /// Resolve a cwd for terminal commands. `None` means use target default.
    pub fn resolve_terminal_cwd(&self, requested: Option<&str>) -> Result<Option<PathBuf>> {
        match self {
            Self::Local { workspace_cwd } => match requested {
                Some(workdir) => Ok(Some(self.resolve_path(workdir)?)),
                None => Ok(Some(workspace_cwd.clone())),
            },
            Self::Sandbox(session) => requested
                .map(|workdir| session.resolve_path(workdir))
                .transpose(),
            Self::Ssh(ssh) => ssh.resolve_terminal_cwd(requested),
        }
    }

    /// Run a one-shot program to completion, optionally piping stdin. Used by
    /// file tools for RemoteExec targets; local support is retained for tests.
    pub async fn exec(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<Vec<u8>>,
    ) -> Result<std::process::Output> {
        match self {
            Self::Local { workspace_cwd } => {
                let mut command = Command::new(program);
                command.args(args).current_dir(workspace_cwd);
                if stdin.is_some() {
                    command.stdin(Stdio::piped());
                }
                command.stdout(Stdio::piped()).stderr(Stdio::piped());

                let mut child = command
                    .spawn()
                    .with_context(|| format!("failed to spawn '{program}'"))?;

                if let Some(input) = stdin {
                    if let Some(mut stdin_pipe) = child.stdin.take() {
                        stdin_pipe.write_all(&input).await?;
                    }
                }

                child
                    .wait_with_output()
                    .await
                    .with_context(|| format!("failed to wait for '{program}'"))
            }
            Self::Sandbox(session) => session.exec(program, args, stdin).await,
            Self::Ssh(ssh) => ssh.exec(program, args, stdin).await,
        }
    }

    pub fn terminal_pipe_command(
        &self,
        cmd: &str,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (Command, Option<String>) {
        match self {
            Self::Local { .. } => {
                let mut command = Command::new("bash");
                command.arg("-c").arg(cmd);
                if let Some(cwd) = cwd {
                    command.current_dir(cwd);
                }
                for (key, value) in envs {
                    command.env(key, value);
                }
                (command, None)
            }
            Self::Sandbox(session) => {
                let (command, pidfile) = session.terminal_pipe_command(cmd, cwd, envs);
                (command, Some(pidfile))
            }
            Self::Ssh(ssh) => ssh.terminal_pipe_command(cmd, cwd, envs),
        }
    }

    pub async fn terminal_pipe_kill(&self, pidfile: &str) -> Result<()> {
        match self {
            Self::Local { .. } => Ok(()),
            Self::Sandbox(session) => session.terminal_pipe_kill(pidfile).await,
            Self::Ssh(ssh) => ssh.terminal_pipe_kill(pidfile).await,
        }
    }

    pub fn terminal_pty_command(
        &self,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (PtyCommandBuilder, Option<String>) {
        match self {
            Self::Local { .. } => {
                let mut cmd = PtyCommandBuilder::new("bash");
                for (key, value) in envs {
                    cmd.env(key, value);
                }
                if let Some(cwd) = cwd {
                    cmd.cwd(cwd);
                }
                (cmd, None)
            }
            Self::Sandbox(session) => {
                let (cmd, pidfile) = session.terminal_pty_command(cwd, envs);
                (cmd, Some(pidfile))
            }
            Self::Ssh(ssh) => ssh.terminal_pty_command(cwd, envs),
        }
    }

    /// Extra CLI flags appended to worker subprocesses so they reattach to the
    /// same target. Empty for local execution.
    pub fn worker_cli_args(&self) -> Vec<OsString> {
        match self {
            Self::Local { .. } => Vec::new(),
            Self::Sandbox(session) => session.worker_cli_args(),
            Self::Ssh(ssh) => ssh.worker_cli_args(),
        }
    }

    /// Directory terminal sessions land in when no explicit cwd is requested.
    pub fn default_terminal_cwd(&self) -> PathBuf {
        match self {
            Self::Local { workspace_cwd } => workspace_cwd.clone(),
            Self::Sandbox(session) => PathBuf::from(session.workdir_display()),
            Self::Ssh(ssh) => ssh.default_terminal_cwd(),
        }
    }

    /// Whether the session workspace cwd is a directory on this machine.
    pub fn workspace_cwd_is_local(&self) -> bool {
        match self {
            Self::Local { .. } | Self::Sandbox(_) => true,
            Self::Ssh(_) => false,
        }
    }
}

/// Select a local or podman execution target.
pub fn execution_backend_from_sandbox(
    sandbox: Option<SandboxSession>,
    workspace_cwd: &Path,
) -> Arc<ExecutionBackend> {
    Arc::new(match sandbox {
        Some(session) => ExecutionBackend::Sandbox(session),
        None => ExecutionBackend::Local {
            workspace_cwd: workspace_cwd.to_path_buf(),
        },
    })
}

/// Select the execution target from a session's full configuration: SSH target,
/// podman sandbox, or local execution rooted at `workspace_cwd`.
pub fn select_execution_backend(
    ssh_host: Option<String>,
    sandbox: Option<SandboxSession>,
    workspace_cwd: &Path,
) -> Result<Arc<ExecutionBackend>> {
    match (ssh_host, sandbox) {
        (Some(ssh_host), Some(_)) => anyhow::bail!(
            "invalid session configuration: ssh_host '{}' and a podman sandbox cannot both be set; remote sessions cannot run inside a local sandbox",
            ssh_host
        ),
        (Some(ssh_host), None) => Ok(Arc::new(ExecutionBackend::Ssh(super::SshBackend::new(
            ssh_host,
            workspace_cwd.to_path_buf(),
        )))),
        (None, sandbox) => Ok(execution_backend_from_sandbox(sandbox, workspace_cwd)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{SandboxSpec, DEFAULT_SANDBOX_IMAGE, DEFAULT_SANDBOX_WORKDIR};

    fn local() -> ExecutionBackend {
        ExecutionBackend::Local {
            workspace_cwd: PathBuf::from("/workspace-root"),
        }
    }

    fn sandbox() -> SandboxSession {
        SandboxSession::new_for_test(SandboxSpec {
            image: DEFAULT_SANDBOX_IMAGE.to_string(),
            mounts: Vec::new(),
            workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
            gpu_devices: Vec::new(),
            shm_size: None,
        })
    }

    #[test]
    fn select_backend_uses_ssh_for_remote_sessions() {
        let backend = select_execution_backend(
            Some("build-box".to_string()),
            None,
            Path::new("/remote/project"),
        )
        .unwrap();
        assert_eq!(backend.file_io(), FileIoMode::RemoteExec);
        assert_eq!(backend.kind(), ExecutionTargetKind::Ssh);
        assert!(!backend.workspace_cwd_is_local());
        assert_eq!(
            backend.default_terminal_cwd(),
            PathBuf::from("/remote/project")
        );
        assert_eq!(
            backend.worker_cli_args(),
            vec![OsString::from("--ssh-host"), OsString::from("build-box")]
        );
    }

    #[test]
    fn select_backend_rejects_ssh_plus_sandbox() {
        let error = match select_execution_backend(
            Some("build-box".to_string()),
            Some(sandbox()),
            Path::new("/x"),
        ) {
            Ok(_) => panic!("ssh + sandbox must be rejected"),
            Err(error) => error,
        };
        assert!(
            error.to_string().contains("cannot both be set"),
            "got: {error}"
        );
    }

    #[test]
    fn select_backend_without_ssh_matches_sandbox_selection() {
        let local = select_execution_backend(None, None, Path::new("/workspace-root")).unwrap();
        assert_eq!(local.file_io(), FileIoMode::Native);
        assert_eq!(local.kind(), ExecutionTargetKind::Local);
        assert!(local.workspace_cwd_is_local());

        let podman = select_execution_backend(None, Some(sandbox()), Path::new("/unused")).unwrap();
        assert_eq!(podman.file_io(), FileIoMode::RemoteExec);
        assert_eq!(podman.kind(), ExecutionTargetKind::Sandbox);
        assert!(podman.workspace_cwd_is_local());
    }

    #[test]
    fn local_resolve_path_matches_workspace_resolution() {
        let backend = local();
        assert_eq!(
            backend.resolve_path("notes.txt").unwrap(),
            PathBuf::from("/workspace-root/notes.txt")
        );
        assert_eq!(
            backend.resolve_path("/abs/file").unwrap(),
            PathBuf::from("/abs/file")
        );
    }

    #[test]
    fn local_resolve_terminal_cwd_defaults_to_workspace() {
        let backend = local();
        assert_eq!(
            backend.resolve_terminal_cwd(None).unwrap(),
            Some(PathBuf::from("/workspace-root"))
        );
        assert_eq!(
            backend.resolve_terminal_cwd(Some("subdir")).unwrap(),
            Some(PathBuf::from("/workspace-root/subdir"))
        );
    }

    #[test]
    fn sandbox_resolve_terminal_cwd_leaves_default_unset() {
        let backend = ExecutionBackend::Sandbox(sandbox());
        assert_eq!(backend.resolve_terminal_cwd(None).unwrap(), None);
        assert_eq!(
            backend.resolve_terminal_cwd(Some("sub")).unwrap(),
            Some(PathBuf::from("/workspace/sub"))
        );
    }

    #[test]
    fn local_terminal_pipe_command_is_plain_bash() {
        let backend = local();
        let envs = vec![("TERM".to_string(), "dumb".to_string())];
        let (command, pidfile) =
            backend.terminal_pipe_command("echo hi", Some(Path::new("/tmp")), &envs);
        assert!(pidfile.is_none());
        let debug = format!("{command:?}");
        assert!(debug.contains("bash"), "expected bash: {debug}");
        assert!(debug.contains("echo hi"), "expected cmd: {debug}");
        assert!(debug.contains("TERM=\"dumb\""), "expected env: {debug}");
        assert!(debug.contains("/tmp"), "expected cwd: {debug}");
    }

    #[test]
    fn sandbox_terminal_pipe_command_delegates_with_pidfile() {
        let backend = ExecutionBackend::Sandbox(sandbox());
        let envs = vec![("TERM".to_string(), "dumb".to_string())];
        let (command, pidfile) = backend.terminal_pipe_command("echo hi", None, &envs);
        let pidfile = pidfile.expect("sandbox pipe command must produce a pidfile");
        assert!(pidfile.starts_with("/tmp/nac-exec-"));
        let debug = format!("{command:?}");
        assert!(debug.contains("podman"), "expected podman: {debug}");
    }

    #[test]
    fn local_terminal_pty_command_is_plain_bash() {
        let backend = local();
        let envs = vec![("TERM".to_string(), "dumb".to_string())];
        let (cmd, pidfile) = backend.terminal_pty_command(None, &envs);
        assert!(pidfile.is_none());
        let debug = format!("{cmd:?}");
        assert!(debug.contains("bash"), "expected bash: {debug}");
    }

    #[tokio::test]
    async fn local_ensure_ready_is_noop() {
        assert!(local().ensure_ready().await.is_ok());
    }

    #[tokio::test]
    async fn local_exec_runs_program_with_stdin() {
        let backend = ExecutionBackend::Local {
            workspace_cwd: std::env::current_dir().unwrap(),
        };
        let args = vec!["-c".to_string(), "cat".to_string()];
        let output = backend
            .exec("sh", &args, Some(b"hello-backend".to_vec()))
            .await
            .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout), "hello-backend");
    }
}
