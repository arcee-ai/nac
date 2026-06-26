use std::ffi::OsString;
use std::path::Path;
use std::process::Stdio as StdStdio;
use std::process::{Command as StdCommand, Stdio};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use portable_pty::CommandBuilder as PtyCommandBuilder;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

use super::podman::{
    make_sandbox_pidfile, sanitize_name, shell_escape_path, SANDBOX_EXEC_WRAPPER,
    SANDBOX_KILL_WRAPPER, SANDBOX_PTY_WRAPPER,
};
use super::{MountSpec, SandboxSpec};

pub(crate) struct SmolVmSession {
    spec: SandboxSpec,
    session_key: String,
    owner: bool,
    vm_name: String,
}

impl SmolVmSession {
    pub(crate) fn new(spec: SandboxSpec, session_key: String, owner: bool) -> Self {
        let vm_name = format!("nac-{}", sanitize_name(&session_key));
        Self {
            spec,
            session_key,
            owner,
            vm_name,
        }
    }

    pub(crate) fn spec(&self) -> &SandboxSpec {
        &self.spec
    }

    pub(crate) async fn ensure_ready(&self) -> Result<()> {
        let exists = self.vm_exists().await?;
        if !exists {
            if !self.owner {
                bail!(
                    "sandbox session '{}' is not available; start the parent nac process first",
                    self.session_key
                );
            }
            self.create_vm().await?;
            return Ok(());
        }

        // Start the VM if it's stopped.  smolvm machine start is safe to
        // call on an already-running VM (it reports success), but we
        // propagate any real errors.
        self.start_vm().await?;

        Ok(())
    }

    pub(crate) fn worker_cli_args(&self) -> Vec<OsString> {
        let mut args = vec![
            OsString::from("--sandbox"),
            OsString::from("--no-mount-cwd"),
            OsString::from("--sandbox-backend"),
            OsString::from("smolvm"),
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
        // smolvm does not support --shm-size; skip it.
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
        stdin: Option<Vec<u8>>,
    ) -> Result<std::process::Output> {
        let mut command = Command::new("smolvm");
        command.args(self.exec_args(program, args, stdin.is_some(), false, None, &[]));

        if stdin.is_some() {
            command.stdin(Stdio::piped());
        }
        command.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .with_context(|| "failed to spawn 'smolvm machine exec'")?;

        if let Some(input) = stdin {
            if let Some(mut stdin_pipe) = child.stdin.take() {
                stdin_pipe.write_all(&input).await?;
            }
        }

        child
            .wait_with_output()
            .await
            .with_context(|| "failed to wait for 'smolvm machine exec'")
    }

    pub(crate) fn child_process_command(
        &self,
        program: &str,
        args: &[String],
        envs: &[(String, String)],
    ) -> Command {
        let mut command = Command::new("smolvm");
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
        let mut cmd = PtyCommandBuilder::new("smolvm");
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
        let mut command = Command::new("smolvm");
        command.args(self.exec_args("bash", &pipe_args, false, false, cwd, envs));
        command.stdin(Stdio::null());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        (command, pidfile)
    }

    pub(crate) async fn terminal_pipe_kill(&self, pidfile: &str) -> Result<()> {
        let mut command = Command::new("smolvm");
        command
            .arg("machine")
            .arg("exec")
            .arg("--name")
            .arg(&self.vm_name)
            .arg("--")
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
        let mut command_args = vec![
            OsString::from("machine"),
            OsString::from("exec"),
            OsString::from("--name"),
            OsString::from(self.vm_name.clone()),
        ];

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

        // smolvm uses `--` to separate its flags from the guest command.
        command_args.push(OsString::from("--"));
        command_args.push(OsString::from(program));
        for arg in args {
            command_args.push(OsString::from(arg));
        }
        command_args
    }

    async fn vm_exists(&self) -> Result<bool> {
        let output = Command::new("smolvm")
            .arg("machine")
            .arg("status")
            .arg("--name")
            .arg(&self.vm_name)
            .output()
            .await
            .with_context(|| "failed to execute 'smolvm machine status'")?;
        Ok(output.status.success())
    }

    async fn start_vm(&self) -> Result<()> {
        let output = Command::new("smolvm")
            .arg("machine")
            .arg("start")
            .arg("--name")
            .arg(&self.vm_name)
            .output()
            .await
            .with_context(|| "failed to execute 'smolvm machine start'")?;
        if !output.status.success() {
            // VM might already be running — that's OK.
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("already running") && !stderr.contains("running") {
                bail!(
                    "failed to start sandbox VM '{}': {}",
                    self.vm_name,
                    stderr.trim()
                );
            }
        }
        Ok(())
    }

    async fn create_vm(&self) -> Result<()> {
        let mut command = Command::new("smolvm");
        command.args(self.create_vm_args());
        let output = command
            .output()
            .await
            .with_context(|| "failed to execute 'smolvm machine run'")?;
        if !output.status.success() {
            bail!(
                "failed to create sandbox VM '{}': {}",
                self.vm_name,
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(())
    }

    fn create_vm_args(&self) -> Vec<OsString> {
        let mut args = vec![
            OsString::from("machine"),
            OsString::from("run"),
            OsString::from("-d"),
            OsString::from("--net"),
            OsString::from("--name"),
            OsString::from(self.vm_name.clone()),
            OsString::from("--image"),
            OsString::from(self.spec.image.clone()),
            OsString::from("--cpus"),
            OsString::from(self.spec.cpus.to_string()),
            OsString::from("--mem"),
            OsString::from(self.spec.memory_mib.to_string()),
        ];

        for mount in &self.spec.mounts {
            args.push(OsString::from("-v"));
            args.push(OsString::from(volume_arg(mount)));
        }

        // smolvm does not support --shm-size; skip it.

        if !self.spec.gpu_devices.is_empty() {
            args.push(OsString::from("--gpu"));
        }

        args.push(OsString::from("--workdir"));
        args.push(OsString::from(self.spec.workdir.display().to_string()));

        args.push(OsString::from("--"));
        args.push(OsString::from("sh"));
        args.push(OsString::from("-lc"));
        args.push(OsString::from(format!(
            "mkdir -p '{}' && exec sleep infinity",
            shell_escape_path(&self.spec.workdir)
        )));
        args
    }
}

impl Drop for SmolVmSession {
    fn drop(&mut self) {
        if !self.owner {
            return;
        }

        let _ = StdCommand::new("smolvm")
            .arg("machine")
            .arg("delete")
            .arg("--name")
            .arg(&self.vm_name)
            .arg("-f")
            .stdout(StdStdio::null())
            .stderr(StdStdio::null())
            .spawn();
    }
}

fn volume_arg(mount: &MountSpec) -> String {
    if mount.read_only {
        format!(
            "{}:{}:ro",
            mount.host.display(),
            mount.guest.display()
        )
    } else {
        format!("{}:{}", mount.host.display(), mount.guest.display())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{SandboxBackendType, DEFAULT_SANDBOX_IMAGE, DEFAULT_SANDBOX_WORKDIR};
    use std::path::PathBuf;

    fn sample_session() -> SmolVmSession {
        SmolVmSession::new(
            SandboxSpec {
                backend: SandboxBackendType::SmolVm,
                image: DEFAULT_SANDBOX_IMAGE.to_string(),
                mounts: vec![MountSpec {
                    host: PathBuf::from("/tmp/project"),
                    guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                    read_only: false,
                }],
                workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                gpu_devices: Vec::new(),
                shm_size: Some("0".to_string()),
                cpus: 2,
                memory_mib: 2048,
            },
            "abc123".to_string(),
            false,
        )
    }

    #[test]
    fn worker_cli_args_include_backend_and_image() {
        let args = sample_session().worker_cli_args();
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(rendered.contains(&"--sandbox".to_string()));
        assert!(rendered.contains(&"--no-mount-cwd".to_string()));
        assert!(rendered.contains(&"--sandbox-backend".to_string()));
        assert!(rendered.contains(&"smolvm".to_string()));
        assert!(rendered.contains(&"--sandbox-session-key".to_string()));
        assert!(rendered.contains(&"/tmp/project:/workspace".to_string()));
    }

    #[test]
    fn create_vm_args_include_net_and_image() {
        let args = sample_session().create_vm_args();
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(rendered.starts_with(&[
            "machine".to_string(),
            "run".to_string(),
            "-d".to_string(),
            "--net".to_string(),
        ]));
        assert!(rendered.contains(&"--name".to_string()));
        assert!(rendered.contains(&"--image".to_string()));
        assert!(rendered.contains(&DEFAULT_SANDBOX_IMAGE.to_string()));
        assert!(rendered.contains(&"-v".to_string()));
        assert!(rendered.contains(&"/tmp/project:/workspace".to_string()));
        assert!(rendered.contains(&"--workdir".to_string()));
        assert!(rendered
            .iter()
            .any(|value| value.contains("sleep infinity")));
        // smolvm should NOT include --shm-size
        assert!(!rendered.contains(&"--shm-size".to_string()));
        // smolvm should NOT include --userns
        assert!(!rendered.contains(&"--userns".to_string()));
    }

    #[test]
    fn create_vm_args_include_gpu_flag() {
        let session = SmolVmSession::new(
            SandboxSpec {
                backend: SandboxBackendType::SmolVm,
                image: DEFAULT_SANDBOX_IMAGE.to_string(),
                mounts: Vec::new(),
                workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                gpu_devices: vec!["all".to_string()],
                shm_size: None,
                cpus: 2,
                memory_mib: 2048,
            },
            "gpu".to_string(),
            false,
        );
        let rendered: Vec<String> = session
            .create_vm_args()
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(rendered.contains(&"--gpu".to_string()));
        // smolvm uses --gpu, not --device
        assert!(!rendered.contains(&"--device".to_string()));
    }

    #[test]
    fn exec_args_use_double_dash_separator() {
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
        assert_eq!(rendered.first().map(String::as_str), Some("machine"));
        assert!(rendered.contains(&"exec".to_string()));
        assert!(rendered.contains(&"--name".to_string()));
        assert!(rendered.contains(&"-i".to_string()));
        assert!(!rendered.contains(&"-t".to_string()));
        // The `--` separator must be present before the program
        let dash_pos = rendered
            .iter()
            .position(|v| v == "--")
            .expect("expected -- separator");
        assert_eq!(rendered[dash_pos + 1], "python3");
    }

    #[test]
    fn exec_args_include_env_vars() {
        let args = sample_session().exec_args(
            "bash",
            &["-c".to_string(), "echo $TERM".to_string()],
            false,
            false,
            None,
            &[
                ("TERM".to_string(), "dumb".to_string()),
                ("PAGER".to_string(), "cat".to_string()),
            ],
        );
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert!(rendered.contains(&"--env".to_string()));
        assert!(rendered.contains(&"TERM=dumb".to_string()));
        assert!(rendered.contains(&"PAGER=cat".to_string()));
    }

    #[test]
    fn terminal_pipe_command_produces_pidfile() {
        let session = sample_session();
        let (command, pidfile) = session.terminal_pipe_command(
            "echo hello",
            None,
            &[
                ("TERM".to_string(), "dumb".to_string()),
                ("PAGER".to_string(), "cat".to_string()),
            ],
        );
        assert!(pidfile.starts_with("/tmp/nac-exec-"));
        assert!(pidfile.ends_with(".pid"));
        let debug = format!("{command:?}");
        assert!(debug.contains("smolvm"), "expected smolvm: {debug}");
        assert!(debug.contains("machine"), "expected machine: {debug}");
        assert!(debug.contains("exec"), "expected exec: {debug}");
    }

    #[test]
    fn vm_name_uses_sanitized_session_key() {
        let session = SmolVmSession::new(
            SandboxSpec {
                backend: SandboxBackendType::SmolVm,
                image: DEFAULT_SANDBOX_IMAGE.to_string(),
                mounts: Vec::new(),
                workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                gpu_devices: Vec::new(),
                shm_size: None,
                cpus: 2,
                memory_mib: 2048,
            },
            "abc-123_DEF".to_string(),
            false,
        );
        assert_eq!(session.vm_name, "nac-abc-123-def");
    }
}