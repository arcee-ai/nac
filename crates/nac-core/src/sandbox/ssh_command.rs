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

/// How much of the host name the control socket is named after. The rest of the
/// budget goes to the hash, to `.sock`, to the directory it lives in and to the
/// suffix ssh appends while opening the master connection.
const SOCKET_NAME_HOST_CHARS: usize = 16;

/// How to reach one host, stated in full rather than left to `~/.ssh/config`.
///
/// Everything OpenSSH would otherwise take from a config file lives here, so a
/// remote session can be described entirely from the launch form. A host that
/// *is* configured in `~/.ssh/config` still works: an alias as `host` with no
/// port and no key leaves ssh to resolve the rest as it always did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SshConnection {
    /// `host` or `user@host`, exactly as `ssh` takes it.
    pub host: String,
    /// None leaves the port to ssh, which is what an alias or a default 22 wants.
    pub port: Option<u16>,
    /// A private key on *this* machine, already absolute: nac spawns `ssh`
    /// directly, so no shell is around to expand a leading `~`.
    pub identity_file: Option<PathBuf>,
}

impl SshConnection {
    pub fn new(host: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port: None,
            identity_file: None,
        }
    }

    /// A connection from what the user typed, with the key path made absolute
    /// against the local directory nac itself resolves paths against: `~` is
    /// expanded there and anything else relative is joined to it.
    pub fn resolved(
        host: impl Into<String>,
        port: Option<u16>,
        identity_file: Option<&Path>,
        paths: &PathContext,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            identity_file: identity_file.map(|path| absolute_local_path(path, paths)),
        }
    }

    /// Connection options every nac ssh invocation carries.
    ///
    /// Multiplexing is what makes a chatty caller affordable: the first command
    /// pays for the handshake and the rest travel over the socket it left
    /// behind. `BatchMode` is the other half of the contract — nac never has a
    /// terminal to answer a passphrase prompt, so a host that would ask must
    /// fail instead. `IdentitiesOnly` follows an explicit key, so a crowded
    /// agent cannot offer a different one first and get itself rejected.
    ///
    /// `Compression` pays off because everything nac moves over this connection
    /// is text: status porcelain, path listings, patches and source blobs. The
    /// worst case is the file reader, which spends a third of its bytes on the
    /// base64 framing that keeps binary content intact — and that framing is
    /// exactly what compresses back out. It belongs here rather than at a call
    /// site: with `ControlMaster` the master's settings govern every session
    /// that later joins the socket, so a subset of callers asking for it would
    /// get whatever the first one happened to open.
    pub(crate) fn ssh_args(&self, control_path: &Path) -> Vec<String> {
        let mut args = vec![
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
            "-o".to_string(),
            "Compression=yes".to_string(),
        ];
        if let Some(port) = self.port {
            args.push("-p".to_string());
            args.push(port.to_string());
        }
        if let Some(identity) = self.identity_file.as_deref() {
            args.push("-i".to_string());
            args.push(identity.display().to_string());
            args.push("-o".to_string());
            args.push("IdentitiesOnly=yes".to_string());
        }
        args
    }

    /// Where the multiplexed connection to this host is shared from.
    ///
    /// The name carries a hash as well as the sanitized host because sanitizing
    /// alone collides: `a/b` and `a:b` would otherwise name the same socket. The
    /// hash covers the port and the key too, so two sessions reaching the same
    /// name as different users or with different keys cannot end up sharing one
    /// connection.
    ///
    /// It also stays short. A unix socket path is limited to about a hundred
    /// bytes, and ssh appends a random suffix of its own while the master is
    /// being set up, so a host spelled out in full — `user@sub.domain.example`
    /// — is enough to push the whole path over the limit and fail the
    /// connection outright. The hash is what keeps connections apart; the host
    /// is only there to make the socket recognizable.
    pub(crate) fn control_path(&self, paths: &PathContext) -> PathBuf {
        let dir = paths
            .nac_home_dir()
            .unwrap_or_else(|| std::env::temp_dir().join("nac"))
            .join("ssh");
        dir.join(format!(
            "{}-{:016x}.sock",
            sanitize_socket_name(&self.host),
            stable_hash(&self.identity())
        ))
    }

    /// How the connection is named in messages the user reads.
    pub fn describe(&self) -> String {
        match self.port {
            Some(port) => format!("{}:{port}", self.host),
            None => self.host.clone(),
        }
    }

    /// Everything that makes this a distinct connection, for hashing and for
    /// keying caches that must not confuse one host's two identities.
    pub fn identity(&self) -> String {
        format!(
            "{}\u{1f}{}\u{1f}{}",
            self.host,
            self.port.map(|port| port.to_string()).unwrap_or_default(),
            self.identity_file
                .as_deref()
                .map(|path| path.display().to_string())
                .unwrap_or_default()
        )
    }
}

/// The key path as an absolute local path.
///
/// A leading `~` is expanded because the value arrives as text from the launch
/// form and would otherwise reach `ssh` literally, which is spawned without a
/// shell to expand it. Anything else relative is resolved against nac's own
/// local directory, so a value like `keys/ci` names the same file when it is
/// validated, when the session runs, and after a restart from elsewhere —
/// leaving it relative would let those three disagree.
fn absolute_local_path(path: &Path, paths: &PathContext) -> PathBuf {
    let text = path.to_string_lossy();
    let tilde_rest = if text == "~" {
        Some("")
    } else {
        text.strip_prefix("~/")
    };

    let Some(rest) = tilde_rest else {
        return paths.resolve(path);
    };
    // Without a home directory there is nothing to expand against. The literal
    // value is kept, because a tilde joined to the local directory would name a
    // file nobody meant and would report itself as that path when it is missing.
    match paths.home_dir() {
        Some(home) if rest.is_empty() => home,
        Some(home) => home.join(rest),
        None => path.to_path_buf(),
    }
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
    let shortened: String = trimmed.chars().take(SOCKET_NAME_HOST_CHARS).collect();
    if shortened.is_empty() {
        "host".to_string()
    } else {
        shortened
    }
}
