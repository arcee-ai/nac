//! Where nac runs git for a session.
//!
//! Every git command in the workspace layer goes through a target rather than
//! straight to a local process, because a session's checkout is not always on
//! this machine. The two shapes are a local directory and a directory on an
//! OpenSSH host; both answer the same questions, so the callers above stay
//! unaware of which one they hold.
//!
//! Running git where the files are is what makes the remote case affordable:
//! git does the work over there and only its output crosses the connection.
//! The connection itself is the multiplexed one the execution backend already
//! opened, so a command costs a round trip rather than a handshake.

use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Output, Stdio};

use anyhow::{anyhow, bail, Context, Result};

use crate::paths::PathContext;
use crate::sandbox::ssh_command::{
    prepare_control_socket_dir, quoted_program_and_args, remote_command_in_dir, ssh_args,
};

/// Exit status ssh reserves for its own failures, as opposed to the remote
/// command's. Anything else came back from the far end.
const SSH_TRANSPORT_EXIT: i32 = 255;
/// What a shell reports when the program does not exist.
const SHELL_COMMAND_NOT_FOUND_EXIT: i32 = 127;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitTarget {
    Local {
        root: PathBuf,
    },
    Ssh {
        host: String,
        remote_cwd: PathBuf,
        control_path: PathBuf,
    },
}

/// A working-tree entry as the filesystem holding it reports it.
///
/// The reading policies of the callers differ — one treats a missing file as
/// empty, the other as an error — so this reports what is there and leaves the
/// decision to them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WorktreeRead {
    Missing,
    /// Neither a regular file nor a symlink: a directory, a socket, a device.
    NotRegular,
    Symlink {
        target: Vec<u8>,
        /// The directory holding the link resolves outside the repository.
        escapes: bool,
    },
    Regular {
        size: u64,
        /// The file resolves outside the repository, through a symlinked
        /// directory component.
        escapes: bool,
        /// None when the file is larger than the limit the caller asked for.
        bytes: Option<Vec<u8>>,
    },
}

/// Reports a working-tree entry, and its contents unless `limit` is exceeded.
///
/// One round trip on a remote host, which is why the answer carries everything
/// a caller could need rather than what it asked for.
const REMOTE_WORKTREE_SCRIPT: &str = r#"import base64, json, os, stat, sys
root, rel, limit, mode = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
path = os.path.join(root, rel)
resolved_root = os.path.realpath(root)


def within(child, parent):
    try:
        return os.path.commonpath([child, parent]) == parent
    except ValueError:
        return False


def emit(payload):
    sys.stdout.write(json.dumps(payload))
    raise SystemExit(0)


try:
    info = os.lstat(path)
except FileNotFoundError:
    emit({"kind": "missing"})
except OSError as error:
    emit({"kind": "error", "message": str(error)})

if stat.S_ISLNK(info.st_mode):
    parent = os.path.dirname(path) or root
    try:
        escapes = not within(os.path.realpath(parent), resolved_root)
        target = os.readlink(path)
    except OSError as error:
        emit({"kind": "error", "message": str(error)})
    emit({
        "kind": "symlink",
        "escapes": escapes,
        "target": base64.b64encode(os.fsencode(target)).decode("ascii"),
    })

if not stat.S_ISREG(info.st_mode):
    emit({"kind": "other"})

try:
    escapes = not within(os.path.realpath(path), resolved_root)
except OSError as error:
    emit({"kind": "error", "message": str(error)})

size = info.st_size
if mode != "read" or size > limit:
    emit({"kind": "regular", "escapes": escapes, "size": size, "bytes": None})

try:
    with open(path, "rb") as handle:
        payload = handle.read(limit + 1)
except OSError as error:
    emit({"kind": "error", "message": str(error)})

emit({
    "kind": "regular",
    "escapes": escapes,
    "size": size,
    "bytes": base64.b64encode(payload).decode("ascii"),
})
"#;

impl GitTarget {
    pub fn local(root: impl Into<PathBuf>) -> Self {
        Self::Local { root: root.into() }
    }

    /// A checkout on an OpenSSH host. `config_cwd` is the *local* directory
    /// nac's own paths resolve against, because that is where the shared
    /// control socket lives.
    pub fn ssh(host: String, remote_cwd: PathBuf, config_cwd: &Path) -> Self {
        let control_path =
            crate::sandbox::ssh_command::ssh_control_path(&host, &PathContext::new(config_cwd));
        Self::Ssh {
            host,
            remote_cwd,
            control_path,
        }
    }

    /// Where git starts looking for the repository.
    pub fn root(&self) -> &Path {
        match self {
            Self::Local { root } => root,
            Self::Ssh { remote_cwd, .. } => remote_cwd,
        }
    }

    /// The checkout as a local path, which only a local target has. Callers
    /// that hand paths to something other than git need this.
    pub fn local_path(&self) -> Option<&Path> {
        match self {
            Self::Local { root } => Some(root),
            Self::Ssh { .. } => None,
        }
    }

    pub fn ssh_host(&self) -> Option<&str> {
        match self {
            Self::Local { .. } => None,
            Self::Ssh { host, .. } => Some(host),
        }
    }

    /// How the checkout is named in messages the user reads.
    pub fn describe(&self) -> String {
        match self {
            Self::Local { root } => root.display().to_string(),
            Self::Ssh {
                host, remote_cwd, ..
            } => format!("{host}:{}", remote_cwd.display()),
        }
    }

    /// Whether the workspace layer can work against this checkout at all.
    ///
    /// Asking for git's version first is what separates "the machine is not
    /// answering" and "there is no git over there" from "that directory is not
    /// a repository": the version call needs nothing but git itself, so a
    /// failure there cannot be blamed on the directory.
    pub fn probe(&self) -> Result<()> {
        let output = self.output(self.root(), &["--version"])?;
        if !output.status.success() {
            if let Some(reason) = self.unavailable_reason(&output) {
                bail!("{reason}");
            }
            bail!(
                "git is not usable for '{}': {}",
                self.describe(),
                first_stderr_line(&output.stderr)
            );
        }
        self.repo_root().map(|_| ())
    }

    /// The repository containing this target, and the check that answers
    /// whether the workspace layer can work here at all.
    ///
    /// Every failure a caller can act on is separated out here: an unreachable
    /// host, a host without git, and a directory that is not a repository all
    /// read differently and are fixed differently.
    pub fn repo_root(&self) -> Result<PathBuf> {
        let output = self.output(self.root(), &["rev-parse", "--show-toplevel"])?;
        if !output.status.success() {
            if let Some(reason) = self.unavailable_reason(&output) {
                bail!("{reason}");
            }
            bail!(
                "'{}' is not a git repository: {}",
                self.describe(),
                first_stderr_line(&output.stderr)
            );
        }

        let raw = String::from_utf8(output.stdout)
            .map_err(|_| anyhow!("git repository path is not valid UTF-8"))?;
        let path = raw.trim_end();
        if path.is_empty() {
            bail!("git repository not found in '{}'", self.describe());
        }

        match self {
            // Working-tree paths are compared against this root to catch a file
            // that resolves out of the repository, so the root has to be as
            // resolved as they are. The remote reader resolves both ends over
            // there, where the filesystem is.
            Self::Local { .. } => PathBuf::from(path)
                .canonicalize()
                .context("failed to resolve git repository root"),
            Self::Ssh { .. } => Ok(PathBuf::from(path)),
        }
    }

    pub(crate) fn output(&self, cwd: &Path, args: &[&str]) -> Result<Output> {
        self.output_with_env(cwd, &[], args)
    }

    pub(crate) fn output_with_env(
        &self,
        cwd: &Path,
        envs: &[(&str, &str)],
        args: &[&str],
    ) -> Result<Output> {
        self.program_output(cwd, envs, "git", args)
    }

    /// Whether a failed command failed before git could answer. `None` means
    /// the output is git's own, and its stderr is worth showing.
    pub(crate) fn unavailable_reason(&self, output: &Output) -> Option<String> {
        self.unavailable_reason_for("git", output)
    }

    /// The same question for any program nac runs on the far end, so a missing
    /// interpreter is not reported as a missing git.
    fn unavailable_reason_for(&self, program: &str, output: &Output) -> Option<String> {
        let code = output.status.code();
        let stderr = String::from_utf8_lossy(&output.stderr);
        match self {
            Self::Local { .. } => None,
            Self::Ssh { host, .. } => {
                if code == Some(SSH_TRANSPORT_EXIT) {
                    return Some(format!(
                        "cannot reach ssh host '{host}': {}",
                        first_stderr_line(&output.stderr)
                    ));
                }
                if code == Some(SHELL_COMMAND_NOT_FOUND_EXIT)
                    || stderr.contains(&format!("{program}: command not found"))
                {
                    return Some(format!("{program} is not installed on ssh host '{host}'"));
                }
                None
            }
        }
    }

    pub(crate) fn mkdir_p(&self, dir: &Path) -> Result<()> {
        match self {
            Self::Local { .. } => std::fs::create_dir_all(dir)
                .with_context(|| format!("failed to create {}", dir.display())),
            Self::Ssh { .. } => {
                let args = ["-p".to_string(), dir.display().to_string()];
                let output = self.program_output(self.root(), &[], "mkdir", &args)?;
                if !output.status.success() {
                    bail!(
                        "failed to create {} on ssh host: {}",
                        dir.display(),
                        first_stderr_line(&output.stderr)
                    );
                }
                Ok(())
            }
        }
    }

    /// Best-effort removal: a file that is already gone is a success, which is
    /// what the callers cleaning up after themselves want.
    pub(crate) fn remove_file(&self, path: &Path) -> Result<()> {
        match self {
            Self::Local { .. } => match std::fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => {
                    Err(error).with_context(|| format!("failed to remove {}", path.display()))
                }
            },
            Self::Ssh { .. } => {
                let args = ["-f".to_string(), path.display().to_string()];
                let output = self.program_output(self.root(), &[], "rm", &args)?;
                if !output.status.success() {
                    bail!(
                        "failed to remove {} on ssh host: {}",
                        path.display(),
                        first_stderr_line(&output.stderr)
                    );
                }
                Ok(())
            }
        }
    }

    /// Whether the working tree still has something at `relpath`. An entry nac
    /// cannot stat counts as present, so a permission problem never reads as a
    /// deletion.
    pub(crate) fn worktree_exists(&self, repo_root: &Path, relpath: &str) -> bool {
        match self {
            Self::Local { .. } => std::fs::symlink_metadata(repo_root.join(relpath))
                .map(|_| true)
                .unwrap_or_else(|error| error.kind() != std::io::ErrorKind::NotFound),
            Self::Ssh { .. } => !matches!(
                self.remote_worktree(repo_root, relpath, 0, "stat"),
                Ok(WorktreeRead::Missing)
            ),
        }
    }

    pub(crate) fn read_worktree(
        &self,
        repo_root: &Path,
        relpath: &str,
        limit: u64,
    ) -> Result<WorktreeRead> {
        match self {
            Self::Local { .. } => local_worktree(repo_root, relpath, limit),
            Self::Ssh { .. } => self.remote_worktree(repo_root, relpath, limit, "read"),
        }
    }

    fn remote_worktree(
        &self,
        repo_root: &Path,
        relpath: &str,
        limit: u64,
        mode: &str,
    ) -> Result<WorktreeRead> {
        let args = [
            "-c".to_string(),
            REMOTE_WORKTREE_SCRIPT.to_string(),
            repo_root.display().to_string(),
            relpath.to_string(),
            limit.to_string(),
            mode.to_string(),
        ];
        let output = self.program_output(repo_root, &[], "python3", &args)?;
        if !output.status.success() {
            if let Some(reason) = self.unavailable_reason_for("python3", &output) {
                bail!("{reason}");
            }
            bail!(
                "failed to read '{}' on the remote host: {}",
                relpath,
                first_stderr_line(&output.stderr)
            );
        }
        parse_remote_worktree(&output.stdout, relpath)
    }

    fn program_output(
        &self,
        cwd: &Path,
        envs: &[(&str, &str)],
        program: &str,
        args: &[impl AsRef<str>],
    ) -> Result<Output> {
        match self {
            Self::Local { .. } => {
                let mut command = StdCommand::new(program);
                command.current_dir(cwd);
                for arg in args {
                    command.arg(arg.as_ref());
                }
                for (key, value) in envs {
                    command.env(key, value);
                }
                command
                    .stdin(Stdio::null())
                    .output()
                    .map_err(|error| match error.kind() {
                        // Spawning reports the same error for a missing program
                        // and a missing working directory, and the two are fixed
                        // very differently, so neither is asserted here.
                        std::io::ErrorKind::NotFound => anyhow!(
                            "could not run {program} in '{}': the program or the directory is missing",
                            cwd.display()
                        ),
                        _ => anyhow!("could not run {program}: {error}"),
                    })
            }
            Self::Ssh {
                host, control_path, ..
            } => {
                prepare_control_socket_dir(control_path).with_context(|| {
                    format!(
                        "failed to create ssh control directory for {}",
                        control_path.display()
                    )
                })?;
                let args: Vec<String> = args.iter().map(|arg| arg.as_ref().to_string()).collect();
                let words = quoted_program_and_args(program, &args);
                let envs: Vec<(String, String)> = envs
                    .iter()
                    .map(|(key, value)| (key.to_string(), value.to_string()))
                    .collect();
                let remote = remote_command_in_dir(cwd, &envs, &words);

                let mut command = StdCommand::new("ssh");
                command.args(ssh_args(control_path));
                command.arg("--");
                command.arg(host);
                command.arg(remote);
                command
                    .stdin(Stdio::null())
                    .output()
                    .map_err(|error| anyhow!("could not run ssh: {error}"))
            }
        }
    }
}

fn local_worktree(repo_root: &Path, relpath: &str, limit: u64) -> Result<WorktreeRead> {
    let path = repo_root.join(relpath);
    // symlink_metadata does not follow links, so a link pointing outside the
    // repository is reported as what it is and never read through.
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorktreeRead::Missing)
        }
        Err(error) => return Err(error).with_context(|| format!("cannot stat '{}'", relpath)),
    };

    if metadata.file_type().is_symlink() {
        let parent = path.parent().unwrap_or(repo_root);
        let resolved_parent = parent
            .canonicalize()
            .with_context(|| format!("failed to resolve parent for {}", relpath))?;
        let target = std::fs::read_link(&path)
            .with_context(|| format!("failed to read symlink target for {}", relpath))?;
        return Ok(WorktreeRead::Symlink {
            target: target
                .as_os_str()
                .to_string_lossy()
                .into_owned()
                .into_bytes(),
            escapes: !resolved_parent.starts_with(repo_root),
        });
    }

    if !metadata.is_file() {
        return Ok(WorktreeRead::NotRegular);
    }

    let resolved = path
        .canonicalize()
        .with_context(|| format!("failed to resolve {}", relpath))?;
    let escapes = !resolved.starts_with(repo_root);
    let size = metadata.len();
    if size > limit {
        return Ok(WorktreeRead::Regular {
            size,
            escapes,
            bytes: None,
        });
    }

    let bytes = std::fs::read(&path).with_context(|| format!("failed to read {}", relpath))?;
    Ok(WorktreeRead::Regular {
        size,
        escapes,
        bytes: Some(bytes),
    })
}

fn parse_remote_worktree(stdout: &[u8], relpath: &str) -> Result<WorktreeRead> {
    let payload: serde_json::Value = serde_json::from_slice(stdout)
        .with_context(|| format!("failed to parse the remote report for '{}'", relpath))?;
    let kind = payload
        .get("kind")
        .and_then(|kind| kind.as_str())
        .ok_or_else(|| anyhow!("the remote report for '{}' has no kind", relpath))?;

    match kind {
        "missing" => Ok(WorktreeRead::Missing),
        "other" => Ok(WorktreeRead::NotRegular),
        "error" => {
            let message = payload
                .get("message")
                .and_then(|message| message.as_str())
                .unwrap_or("the remote host reported no details");
            bail!("cannot stat '{}': {}", relpath, message)
        }
        "symlink" => Ok(WorktreeRead::Symlink {
            target: decode_base64_field(&payload, "target", relpath)?.unwrap_or_default(),
            escapes: payload
                .get("escapes")
                .and_then(|escapes| escapes.as_bool())
                .unwrap_or(false),
        }),
        "regular" => Ok(WorktreeRead::Regular {
            size: payload
                .get("size")
                .and_then(|size| size.as_u64())
                .unwrap_or(0),
            escapes: payload
                .get("escapes")
                .and_then(|escapes| escapes.as_bool())
                .unwrap_or(false),
            bytes: decode_base64_field(&payload, "bytes", relpath)?,
        }),
        other => bail!("the remote report for '{}' is unknown: {}", relpath, other),
    }
}

fn decode_base64_field(
    payload: &serde_json::Value,
    field: &str,
    relpath: &str,
) -> Result<Option<Vec<u8>>> {
    let Some(encoded) = payload.get(field).and_then(|value| value.as_str()) else {
        return Ok(None);
    };
    base64_decode(encoded)
        .map(Some)
        .with_context(|| format!("the remote report for '{}' is not valid base64", relpath))
}

fn base64_decode(encoded: &str) -> Result<Vec<u8>> {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut lookup = [u8::MAX; 256];
    for (index, byte) in ALPHABET.iter().enumerate() {
        lookup[*byte as usize] = index as u8;
    }

    let mut out = Vec::with_capacity(encoded.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in encoded.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        let value = lookup[byte as usize];
        if value == u8::MAX {
            bail!("invalid base64 character");
        }
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Ok(out)
}

pub(crate) fn first_stderr_line(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("no details reported")
        .to_string()
}
