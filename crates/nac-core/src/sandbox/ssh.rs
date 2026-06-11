//! SSH execution target: agent commands and file IO run on a remote host.
//!
//! The target string is handed directly to OpenSSH, so users can use aliases
//! from `~/.ssh/config` or freeform destinations like `user@example.com`.

use std::collections::hash_map::DefaultHasher;
use std::ffi::OsString;
use std::hash::{Hash, Hasher};
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

/// How long a remote kill-tree invocation may take before we give up.
const REMOTE_KILL_TIMEOUT: Duration = Duration::from_secs(5);

/// Per-user remote directory for pidfiles used to clean up SSH terminal trees.
/// Created with 0700 permissions before a wrapped terminal command starts.
const SSH_PIDFILE_DIR: &str = "~/.cache/nac/exec";

pub struct SshBackend {
    ssh_host: String,
    /// The session's working directory on the remote host.
    remote_cwd: PathBuf,
    /// Multiplexing control socket for this OpenSSH target.
    control_path: PathBuf,
}

impl SshBackend {
    #[cfg(test)]
    pub fn new(ssh_host: String, remote_cwd: PathBuf) -> Self {
        let config_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self::new_with_paths(ssh_host, remote_cwd, &PathContext::new(config_cwd))
    }

    pub(crate) fn new_with_paths(
        ssh_host: String,
        remote_cwd: PathBuf,
        paths: &PathContext,
    ) -> Self {
        let control_path = ssh_control_path(&ssh_host, paths);
        Self {
            ssh_host,
            remote_cwd,
            control_path,
        }
    }

    /// Common ssh client arguments: multiplexing and non-interactive auth. The
    /// target is appended after `--` so a hostile target string cannot inject
    /// ssh options.
    fn ssh_args(&self) -> Vec<String> {
        vec![
            "-o".to_string(),
            "ControlMaster=auto".to_string(),
            "-o".to_string(),
            format!("ControlPath={}", self.control_path.display()),
            "-o".to_string(),
            "ControlPersist=60s".to_string(),
            "-o".to_string(),
            "BatchMode=yes".to_string(),
            "-o".to_string(),
            "ConnectTimeout=10".to_string(),
        ]
    }

    /// Build a `tokio::process::Command` that runs `remote_command` through the
    /// multiplexed OpenSSH connection.
    fn ssh_command(&self, remote_command: &str) -> Command {
        let mut command = Command::new("ssh");
        command.args(self.ssh_args());
        command.arg("--");
        command.arg(&self.ssh_host);
        command.arg(remote_command);
        command
    }

    /// Compose `cd <dir> && [env K=V ...] <words...>` for the remote shell.
    fn remote_command_in_dir(
        &self,
        dir: &Path,
        envs: &[(String, String)],
        words: &[String],
    ) -> String {
        let mut parts = vec![
            "cd".to_string(),
            shell_quote_path(&dir.display().to_string()),
            "&&".to_string(),
        ];
        if !envs.is_empty() {
            parts.push("env".to_string());
            for (key, value) in envs {
                parts.push(shell_quote(&format!("{key}={value}")));
            }
        }
        parts.extend(words.iter().cloned());
        parts.join(" ")
    }

    fn quoted_program_and_args(program: &str, args: &[String]) -> Vec<String> {
        let mut words = Vec::with_capacity(args.len() + 1);
        words.push(shell_quote(program));
        words.extend(args.iter().map(|arg| shell_quote(arg)));
        words
    }

    pub(crate) async fn ensure_ready(&self) -> Result<()> {
        if let Some(dir) = self.control_path.parent() {
            std::fs::create_dir_all(dir).with_context(|| {
                format!("failed to create ssh control directory {}", dir.display())
            })?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
        }

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
                self.ssh_host,
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
            // For relative/tilde remote cwd values (notably the default `~`),
            // commands already run after `cd <remote_cwd>`, so keep relative
            // tool paths relative to that shell cwd instead of manufacturing
            // `~/path` or `relative/path` arguments that Python would resolve
            // from the post-cd directory incorrectly.
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
        stdin: Option<Vec<u8>>,
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

        let mut child = command
            .spawn()
            .with_context(|| format!("failed to spawn 'ssh' for '{program}'"))?;

        if let Some(input) = stdin {
            if let Some(mut stdin_pipe) = child.stdin.take() {
                stdin_pipe.write_all(&input).await?;
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
            shell_quote_path(&pidfile),
        ];
        let remote = self.remote_command_in_dir(dir, envs, &words);
        let mut cmd = PtyCommandBuilder::new("ssh");
        cmd.arg("-tt");
        cmd.args(self.ssh_args());
        cmd.arg("--");
        cmd.arg(&self.ssh_host);
        cmd.arg(remote);
        (cmd, Some(pidfile))
    }

    pub(crate) fn worker_cli_args(&self) -> Vec<OsString> {
        vec![
            OsString::from("--ssh-host"),
            OsString::from(self.ssh_host.clone()),
        ]
    }

    pub(crate) fn default_terminal_cwd(&self) -> PathBuf {
        self.remote_cwd.clone()
    }

    #[cfg(test)]
    pub(crate) fn control_path_for_test(&self) -> &Path {
        &self.control_path
    }
}

/// Per-target multiplexing socket under a nac-owned local config directory:
/// `$NAC_HOME/ssh/<sanitized target>-<hash>.sock` (typically
/// `~/.config/nac/ssh/...`), falling back to temp when no home can be resolved.
/// Relative `$NAC_HOME`/`$XDG_CONFIG_HOME` values are resolved by the caller's
/// [`PathContext`] so SSH workers use the same local base cwd as config/store.
fn ssh_control_path(ssh_host: &str, paths: &PathContext) -> PathBuf {
    let dir = paths
        .nac_home_dir()
        .unwrap_or_else(|| std::env::temp_dir().join("nac"))
        .join("ssh");
    dir.join(format!(
        "{}-{:016x}.sock",
        sanitize_socket_name(ssh_host),
        stable_hash(ssh_host)
    ))
}

fn stable_hash(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
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

fn sanitize_socket_name(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    let shortened: String = trimmed.chars().take(48).collect();
    if shortened.is_empty() {
        "host".to_string()
    } else {
        shortened
    }
}

/// POSIX single-quote escaping: the result is always a single shell word.
fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Quote a path for the remote shell while preserving tilde expansion for `~`
/// and `~/...`. Quoting exact `~` as `'~'` would make the default remote cwd a
/// literal directory named `~` instead of the user's home.
fn shell_quote_path(value: &str) -> String {
    if value == "~" {
        return "~".to_string();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return format!("~/{}", shell_quote(rest));
    }
    shell_quote(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backend() -> SshBackend {
        SshBackend::new("build-box".to_string(), PathBuf::from("/srv/work/project"))
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
            "build-box".to_string(),
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

        match original_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
        match original_xdg {
            Some(value) => unsafe { std::env::set_var("XDG_CONFIG_HOME", value) },
            None => unsafe { std::env::remove_var("XDG_CONFIG_HOME") },
        }
    }

    #[test]
    fn control_socket_name_includes_hash_to_avoid_sanitization_collisions() {
        let paths =
            PathContext::new(std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let first = ssh_control_path("a/b", &paths);
        let second = ssh_control_path("a:b", &paths);
        assert_ne!(first, second);
        assert!(first.to_string_lossy().contains("a-b-"));
    }
}
