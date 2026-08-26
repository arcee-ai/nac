//! OpenSSH execution backend.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use portable_pty::CommandBuilder as PtyCommandBuilder;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

use crate::paths::PathContext;

use super::podman::{SANDBOX_EXEC_WRAPPER, SANDBOX_KILL_WRAPPER, SANDBOX_PTY_WRAPPER};
use super::ssh_command::{
    prepare_control_socket_dir, quoted_program_and_args, remote_command_in_dir, shell_quote,
    shell_quote_path, SshConnection,
};

const REMOTE_KILL_TIMEOUT: Duration = Duration::from_secs(5);

const SSH_PIDFILE_DIR: &str = "~/.cache/nac/exec";

pub struct SshBackend {
    connection: SshConnection,
    remote_cwd: PathBuf,
    control_path: PathBuf,
}

impl SshBackend {
    #[cfg(test)]
    pub fn new(ssh_host: String, remote_cwd: PathBuf) -> Self {
        let config_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self::new_with_paths(
            SshConnection::new(ssh_host),
            remote_cwd,
            &PathContext::new(config_cwd),
        )
    }

    pub(crate) fn new_with_paths(
        connection: SshConnection,
        remote_cwd: PathBuf,
        paths: &PathContext,
    ) -> Self {
        let control_path = connection.control_path(paths);
        Self {
            connection,
            remote_cwd,
            control_path,
        }
    }

    fn ssh_args(&self) -> Vec<String> {
        self.connection.ssh_args(&self.control_path)
    }

    fn ssh_command(&self, remote_command: &str) -> Command {
        let mut command = Command::new("ssh");
        command.args(self.ssh_args());
        command.arg("--");
        command.arg(&self.connection.host);
        command.arg(remote_command);
        command
    }

    pub(crate) fn sftp_workspace_path(&self) -> PathBuf {
        let Some(path) = self.remote_cwd.to_str() else {
            return self.remote_cwd.clone();
        };
        if path == "~" {
            return PathBuf::from(".");
        }
        if let Some(path) = path.strip_prefix("~/") {
            return if path.is_empty() {
                PathBuf::from(".")
            } else {
                PathBuf::from(path)
            };
        }
        self.remote_cwd.clone()
    }
    pub(crate) fn sftp_command(&self) -> Result<Command> {
        prepare_control_socket_dir(&self.control_path).with_context(|| {
            format!(
                "failed to create ssh control directory for {}",
                self.control_path.display()
            )
        })?;
        let mut command = Command::new("ssh");
        command.args(self.ssh_args());
        command.arg("-s");
        command.arg("--");
        command.arg(&self.connection.host);
        command.arg("sftp");
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.kill_on_drop(true);
        Ok(command)
    }

    fn remote_command_in_dir(
        &self,
        dir: &Path,
        envs: &[(String, String)],
        words: &[String],
    ) -> String {
        remote_command_in_dir(dir, envs, words)
    }

    fn quoted_program_and_args(program: &str, args: &[String]) -> Vec<String> {
        quoted_program_and_args(program, args)
    }

    pub(crate) async fn ensure_ready(&self) -> Result<()> {
        prepare_control_socket_dir(&self.control_path).with_context(|| {
            format!(
                "failed to create ssh control directory for {}",
                self.control_path.display()
            )
        })?;

        let remote = self.remote_command_in_dir(&self.remote_cwd, &[], &["true".to_string()]);
        let mut command = self.ssh_command(&remote);
        command.stdin(Stdio::null());
        command.stdout(Stdio::null());
        command.stderr(Stdio::piped());
        let output = command
            .output()
            .await
            .context("failed to spawn 'ssh' (is the OpenSSH client installed?)")?;
        if !output.status.success() {
            bail!(
                "ssh connection to '{}' failed or remote cwd '{}' is unusable: {}",
                self.connection.describe(),
                self.remote_cwd.display(),
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(())
    }

    pub(crate) fn resolve_path(&self, path: &str) -> Result<PathBuf> {
        let requested = PathBuf::from(path);
        if requested.is_absolute() || path == "~" || path.starts_with("~/") {
            return Ok(requested);
        }

        if self.remote_cwd.is_absolute() {
            Ok(self.remote_cwd.join(requested))
        } else {
            Ok(requested)
        }
    }

    pub(crate) fn resolve_terminal_cwd(&self, requested: Option<&str>) -> Result<Option<PathBuf>> {
        requested
            .map(|workdir| self.resolve_workdir(workdir))
            .transpose()
    }

    fn resolve_workdir(&self, workdir: &str) -> Result<PathBuf> {
        let requested = PathBuf::from(workdir);
        if requested.is_absolute() || workdir == "~" || workdir.starts_with("~/") {
            return Ok(requested);
        }
        Ok(self.remote_cwd.join(requested))
    }

    pub(crate) async fn exec(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<&[u8]>,
    ) -> Result<std::process::Output> {
        let words = Self::quoted_program_and_args(program, args);
        let remote = self.remote_command_in_dir(&self.remote_cwd, &[], &words);
        let mut command = self.ssh_command(&remote);
        if stdin.is_some() {
            command.stdin(Stdio::piped());
        } else {
            command.stdin(Stdio::null());
        }
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        command.kill_on_drop(true);

        let mut child = command
            .spawn()
            .with_context(|| format!("failed to spawn 'ssh' for '{program}'"))?;

        if let Some(input) = stdin {
            if let Some(mut stdin_pipe) = child.stdin.take() {
                stdin_pipe.write_all(input).await?;
            }
        }

        child
            .wait_with_output()
            .await
            .with_context(|| format!("failed to wait for 'ssh' running '{program}'"))
    }

    pub(crate) fn terminal_pipe_command(
        &self,
        cmd: &str,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (Command, Option<String>) {
        let pidfile = make_ssh_pidfile();
        let dir = cwd.unwrap_or(&self.remote_cwd);
        let words = vec![
            "bash".to_string(),
            "-lc".to_string(),
            shell_quote(&ssh_wrapper_script(SANDBOX_EXEC_WRAPPER)),
            "nac-exec".to_string(),
            shell_quote(cmd),
            shell_quote_path(&pidfile),
        ];
        let remote = self.remote_command_in_dir(dir, envs, &words);
        let mut command = self.ssh_command(&remote);
        command.stdin(Stdio::null());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        (command, Some(pidfile))
    }

    pub(crate) async fn terminal_pipe_kill(&self, pidfile: &str) -> Result<()> {
        let remote = format!(
            "sh -c {} nac-kill {}",
            shell_quote(SANDBOX_KILL_WRAPPER),
            shell_quote_path(pidfile)
        );
        let mut command = self.ssh_command(&remote);
        command.stdin(Stdio::null());
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());
        let _ = timeout(REMOTE_KILL_TIMEOUT, command.status()).await;
        Ok(())
    }

    pub(crate) fn terminal_pty_command(
        &self,
        cmd_str: &str,
        cwd: Option<&Path>,
        envs: &[(String, String)],
    ) -> (PtyCommandBuilder, Option<String>) {
        let pidfile = make_ssh_pidfile();
        let dir = cwd.unwrap_or(&self.remote_cwd);
        let words = vec![
            "bash".to_string(),
            "-lc".to_string(),
            shell_quote(&ssh_wrapper_script(SANDBOX_PTY_WRAPPER)),
            "nac-pty".to_string(),
            shell_quote(cmd_str),
            shell_quote_path(&pidfile),
            "pty".to_string(),
        ];
        let remote = self.remote_command_in_dir(dir, envs, &words);
        let mut cmd = PtyCommandBuilder::new("ssh");
        cmd.arg("-tt");
        cmd.args(self.ssh_args());
        cmd.arg("--");
        cmd.arg(&self.connection.host);
        cmd.arg(remote);
        (cmd, Some(pidfile))
    }

    /// What a managed worker needs to rebuild this exact connection, since it
    /// reaches the host itself and cannot inherit the parent's socket.
    pub(crate) fn worker_cli_args(&self) -> Vec<OsString> {
        let mut args = vec![
            OsString::from("--ssh-host"),
            OsString::from(self.connection.host.clone()),
        ];
        if let Some(port) = self.connection.port {
            args.push(OsString::from("--ssh-port"));
            args.push(OsString::from(port.to_string()));
        }
        if let Some(identity) = self.connection.identity_file.as_deref() {
            args.push(OsString::from("--ssh-identity-file"));
            args.push(OsString::from(identity));
        }
        args
    }

    pub(crate) fn default_terminal_cwd(&self) -> PathBuf {
        self.remote_cwd.clone()
    }

    #[cfg(test)]
    pub(crate) fn control_path_for_test(&self) -> &Path {
        &self.control_path
    }
}

fn make_ssh_pidfile() -> String {
    format!("{SSH_PIDFILE_DIR}/{}.pid", Uuid::new_v4().simple())
}

fn ssh_wrapper_script(wrapper: &str) -> String {
    format!(
        r#"umask 077
pidfile_dir="$HOME/.cache/nac/exec"
mkdir -p "$pidfile_dir" || exit 125
chmod 700 "$HOME/.cache/nac" "$pidfile_dir" || exit 125
{wrapper}"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backend() -> SshBackend {
        SshBackend::new("build-box".to_string(), PathBuf::from("/srv/work/project"))
    }

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    #[test]
    fn ssh_args_enable_multiplexing_and_batch_mode() {
        let args = backend().ssh_args();
        assert!(args.contains(&"ControlMaster=auto".to_string()));
        assert!(args.iter().any(|arg| arg.starts_with("ControlPath=")));
        assert!(args.contains(&"ControlPersist=60s".to_string()));
        assert!(args.contains(&"BatchMode=yes".to_string()));
        assert!(args.contains(&"ConnectTimeout=10".to_string()));
        assert!(!args.contains(&"-p".to_string()));
    }

    #[test]
    fn ssh_command_uses_target_after_option_separator() {
        let command = backend().ssh_command("true");
        let debug = format!("{command:?}");
        assert!(debug.contains("ssh"), "expected ssh command: {debug}");
        assert!(debug.contains("--"), "expected option separator: {debug}");
        assert!(debug.contains("build-box"), "expected target: {debug}");
        assert!(debug.contains("true"), "expected remote command: {debug}");
    }

    #[test]
    fn paths_resolve_against_remote_cwd_without_local_checks() {
        let backend = backend();
        assert_eq!(
            backend.resolve_path("src/lib.rs").unwrap(),
            PathBuf::from("/srv/work/project/src/lib.rs")
        );
        assert_eq!(
            backend.resolve_path("/etc/hosts").unwrap(),
            PathBuf::from("/etc/hosts")
        );
    }

    #[test]
    fn relative_paths_stay_relative_when_remote_cwd_is_tilde_for_file_io() {
        let backend = SshBackend::new("build-box".to_string(), PathBuf::from("~"));
        assert_eq!(
            backend.resolve_path("note.txt").unwrap(),
            PathBuf::from("note.txt")
        );
        assert_eq!(
            backend.resolve_path("~/note.txt").unwrap(),
            PathBuf::from("~/note.txt")
        );
    }

    #[test]
    fn sftp_workspace_paths_support_relative_absolute_and_tilde_roots() {
        let relative = SshBackend::new("build-box".to_string(), PathBuf::from("repo"));
        assert_eq!(relative.sftp_workspace_path(), PathBuf::from("repo"));
        let absolute = SshBackend::new("build-box".to_string(), PathBuf::from("/srv/repo"));
        assert_eq!(absolute.sftp_workspace_path(), PathBuf::from("/srv/repo"));
        let home = SshBackend::new("build-box".to_string(), PathBuf::from("~"));
        assert_eq!(home.sftp_workspace_path(), PathBuf::from("."));
        let home_slash = SshBackend::new("build-box".to_string(), PathBuf::from("~/"));
        assert_eq!(home_slash.sftp_workspace_path(), PathBuf::from("."));
        let home_repo = SshBackend::new("build-box".to_string(), PathBuf::from("~/repo"));
        assert_eq!(home_repo.sftp_workspace_path(), PathBuf::from("repo"));
    }

    #[test]
    fn relative_workdirs_join_remote_cwd_even_when_tilde_based() {
        let backend = SshBackend::new("build-box".to_string(), PathBuf::from("~/repo"));
        assert_eq!(
            backend.resolve_terminal_cwd(Some("subdir")).unwrap(),
            Some(PathBuf::from("~/repo/subdir"))
        );

        let home_backend = SshBackend::new("build-box".to_string(), PathBuf::from("~"));
        assert_eq!(
            home_backend.resolve_terminal_cwd(Some("subdir")).unwrap(),
            Some(PathBuf::from("~/subdir"))
        );
        assert_eq!(
            home_backend.resolve_terminal_cwd(Some("~/other")).unwrap(),
            Some(PathBuf::from("~/other"))
        );
    }

    #[test]
    fn exact_tilde_cwd_is_not_quoted_as_literal_directory() {
        let backend = SshBackend::new("build-box".to_string(), PathBuf::from("~"));
        let remote = backend.remote_command_in_dir(
            Path::new("~"),
            &[],
            &["'python3'".to_string(), "'-V'".to_string()],
        );
        assert!(remote.starts_with("cd ~ &&"), "got: {remote}");
        assert!(!remote.contains("cd '~'"), "got: {remote}");
    }

    #[test]
    fn tilde_prefixed_paths_keep_tilde_expansion() {
        assert_eq!(shell_quote_path("~"), "~");
        assert_eq!(shell_quote_path("~/work dir"), "~/'work dir'");
        assert_eq!(shell_quote_path("/tmp/work dir"), "'/tmp/work dir'");
    }

    #[test]
    fn remote_exec_command_wraps_in_cwd_and_quotes_words() {
        let backend = backend();
        let args = vec!["-lc".to_string(), "echo '$HOME'".to_string()];
        let words = SshBackend::quoted_program_and_args("bash", &args);
        let remote = backend.remote_command_in_dir(Path::new("/srv/work/project"), &[], &words);
        assert!(
            remote.starts_with("cd '/srv/work/project' &&"),
            "got: {remote}"
        );
        assert!(remote.contains("'bash'"), "got: {remote}");
        assert!(remote.contains("'echo '\\''$HOME'\\'''"), "got: {remote}");
    }

    #[test]
    fn terminal_commands_return_pidfiles_for_remote_cleanup() {
        let backend = backend();
        let envs = vec![("TERM".to_string(), "dumb".to_string())];
        let (command, pidfile) = backend.terminal_pipe_command("echo hi", None, &envs);
        let pidfile = pidfile.expect("ssh pipe command should produce pidfile");
        assert!(
            pidfile.starts_with("~/.cache/nac/exec/"),
            "unexpected pidfile path: {pidfile}"
        );
        assert!(
            pidfile.ends_with(".pid"),
            "unexpected pidfile path: {pidfile}"
        );
        assert_ne!(
            pidfile,
            make_ssh_pidfile(),
            "ssh pidfiles should include random names"
        );
        let debug = format!("{command:?}");
        assert!(debug.contains("ssh"), "expected ssh: {debug}");
        assert!(debug.contains("nac-exec"), "expected wrapper: {debug}");
        assert!(
            debug.contains("umask 077"),
            "expected restrictive umask: {debug}"
        );
        assert!(
            debug.contains("mkdir -p"),
            "expected remote pid dir setup: {debug}"
        );
        assert!(
            debug.contains("chmod 700"),
            "expected pid dir hardening: {debug}"
        );
        assert!(debug.contains("build-box"), "expected target: {debug}");
    }

    #[test]
    fn worker_cli_args_reattach_with_ssh_host() {
        assert_eq!(
            backend().worker_cli_args(),
            vec![OsString::from("--ssh-host"), OsString::from("build-box")]
        );
    }

    #[test]
    fn control_socket_relative_nac_home_uses_supplied_local_path_context() {
        let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let config_cwd = std::env::temp_dir().join(format!("nac-ssh-config-cwd-{unique}"));
        let nac_home = PathBuf::from(format!("relative-nac-home-{unique}"));
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
            std::env::remove_var("XDG_CONFIG_HOME");
        }

        let backend = SshBackend::new_with_paths(
            SshConnection::new("build-box"),
            PathBuf::from("~"),
            &PathContext::new(&config_cwd),
        );

        assert!(
            backend
                .control_path
                .starts_with(config_cwd.join(&nac_home).join("ssh")),
            "control socket should use config cwd, got {}",
            backend.control_path.display()
        );

        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
    }

    #[test]
    fn control_socket_name_includes_hash_to_avoid_sanitization_collisions() {
        let paths =
            PathContext::new(std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let first = SshConnection::new("a/b").control_path(&paths);
        let second = SshConnection::new("a:b").control_path(&paths);
        assert_ne!(first, second);
        assert!(first.to_string_lossy().contains("a-b-"));
    }

    /// The socket is shared per connection, and a port or a key is what makes
    /// one connection a different one even under the same host name.
    #[test]
    fn control_socket_separates_connections_that_differ_beyond_the_host() {
        let paths =
            PathContext::new(std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let plain = SshConnection::new("build-box").control_path(&paths);
        let other_port = SshConnection {
            host: "build-box".to_string(),
            port: Some(2222),
            identity_file: None,
        }
        .control_path(&paths);
        let other_key = SshConnection {
            host: "build-box".to_string(),
            port: None,
            identity_file: Some(PathBuf::from("/keys/ci")),
        }
        .control_path(&paths);
        assert_ne!(plain, other_port);
        assert_ne!(plain, other_key);
        assert_ne!(other_port, other_key);
    }

    #[test]
    fn ssh_args_carry_the_port_and_the_key_when_set() {
        let backend = SshBackend::new_with_paths(
            SshConnection {
                host: "build-box".to_string(),
                port: Some(2222),
                identity_file: Some(PathBuf::from("/keys/ci")),
            },
            PathBuf::from("/srv/work"),
            &PathContext::new(std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))),
        );
        let args = backend.ssh_args();
        let position = |value: &str| args.iter().position(|arg| arg == value);
        assert_eq!(
            args.get(position("-p").expect("port flag") + 1).unwrap(),
            "2222"
        );
        assert_eq!(
            args.get(position("-i").expect("identity flag") + 1)
                .unwrap(),
            "/keys/ci"
        );
        assert!(args.contains(&"IdentitiesOnly=yes".to_string()));
        assert_eq!(
            backend.worker_cli_args(),
            vec![
                OsString::from("--ssh-host"),
                OsString::from("build-box"),
                OsString::from("--ssh-port"),
                OsString::from("2222"),
                OsString::from("--ssh-identity-file"),
                OsString::from("/keys/ci"),
            ]
        );
    }
}
