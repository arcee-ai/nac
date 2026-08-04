//! Shared construction of OpenSSH invocations.
//!
//! The execution backend and the workspace git channel talk to the same remote
//! host, so they have to agree on quoting, on the multiplexing options and on
//! where the control socket lives. All of it is built here, once, which is what
//! lets the second caller reuse the connection the first one opened.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use crate::paths::PathContext;

/// Connection options every nac ssh invocation carries.
///
/// Multiplexing is what makes a chatty caller affordable: the first command
/// pays for the handshake and the rest travel over the socket it left behind.
/// `BatchMode` is the other half of the contract — nac never has a terminal to
/// answer a passphrase prompt, so a host that would ask must fail instead.
pub(crate) fn ssh_args(control_path: &Path) -> Vec<String> {
    vec![
        "-o".to_string(),
        "ControlMaster=auto".to_string(),
        "-o".to_string(),
        format!("ControlPath={}", control_path.display()),
        "-o".to_string(),
        "ControlPersist=60s".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
    ]
}

/// Where the multiplexed connection to `ssh_host` is shared from.
///
/// The name carries a hash as well as the sanitized host because sanitizing
/// alone collides: `a/b` and `a:b` would otherwise name the same socket.
pub(crate) fn ssh_control_path(ssh_host: &str, paths: &PathContext) -> PathBuf {
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

/// Create the directory the control socket lives in, tightening its mode so a
/// shared machine cannot reach another user's multiplexed connection.
pub(crate) fn prepare_control_socket_dir(control_path: &Path) -> std::io::Result<()> {
    let Some(dir) = control_path.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// A remote command line that runs `words` in `dir` with `envs` set.
///
/// The words are expected to be quoted already; `dir` and the environment
/// assignments are quoted here.
pub(crate) fn remote_command_in_dir(
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

pub(crate) fn quoted_program_and_args(program: &str, args: &[String]) -> Vec<String> {
    let mut words = Vec::with_capacity(args.len() + 1);
    words.push(shell_quote(program));
    words.extend(args.iter().map(|arg| shell_quote(arg)));
    words
}

pub(crate) fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Quoting that leaves a leading `~` expandable, because a remote home is
/// spelled that way and the local process cannot resolve it.
pub(crate) fn shell_quote_path(value: &str) -> String {
    if value == "~" {
        return "~".to_string();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return format!("~/{}", shell_quote(rest));
    }
    shell_quote(value)
}

fn stable_hash(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
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
