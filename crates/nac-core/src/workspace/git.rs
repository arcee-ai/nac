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
    prepare_control_socket_dir, quoted_program_and_args, remote_command_in_dir, SshConnection,
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
        connection: SshConnection,
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
///
/// Deliberately POSIX shell rather than an interpreter nac would have to hope
/// for. git is the one thing this layer may demand, because the layer is about
/// git; anything else is a host nac cannot work on for no good reason, and
/// clusters that forbid installing software are exactly where remote execution
/// earns its keep. Everything used here is a shell builtin or a utility as old
/// as `wc`, and nothing is written to the host.
///
/// The answer is a header line followed by raw bytes: contents travel as
/// themselves rather than base64, which is a third less to send, and the header
/// says whether any bytes follow at all. Emitted forms are:
///
/// ```text
/// missing
/// other
/// error <message>
/// symlink <0|1>\n<target bytes>
/// regular <0|1> <size> none
/// regular <0|1> <size> raw\n<contents>
/// ```
const REMOTE_WORKTREE_SCRIPT: &str = r#"root=$1
rel=$2
limit=$3
mode=$4

case $root in
*/) path=$root$rel ;;
*) path=$root/$rel ;;
esac
dir=${path%/*}
[ -n "$dir" ] || dir=/
base=${path##*/}

fail() {
	printf 'error %s\n' "$1"
	exit 0
}

# Component-wise prefix test, so a sibling checkout like /repo-other is not read
# as something inside /repo. Quoting the expansion keeps a path holding glob
# characters from being taken for a pattern.
inside_root() {
	[ "$2" = / ] && return 0
	rest=${1#"$2"}
	[ "$rest" = "$1" ] && return 1
	[ -z "$rest" ] && return 0
	case $rest in
	/*) return 0 ;;
	esac
	return 1
}

# cd plus pwd -P is the shell's own realpath, with no dependency to install.
resolve_dir() {
	cd "$1" 2>/dev/null && pwd -P
}

# Names the leading directory nac cannot enter, if there is one.
#
# A path that cannot be reached is not the same as a path that is not there, and
# the difference matters: reporting the first as missing would show an
# unreadable directory as a wholesale deletion. Walking down from the root is
# what separates them, because a component below a directory that cannot be
# entered cannot even be tested for existence. Each step is a subshell so the
# walk leaves the working directory alone.
unreachable_component() {
	probe=$root
	rest=$rel
	while [ "$rest" != "${rest#*/}" ]; do
		comp=${rest%%/*}
		rest=${rest#*/}
		probe=$probe/$comp
		if [ ! -e "$probe" ] && [ ! -L "$probe" ]; then
			return 1
		fi
		if ! (cd "$probe" 2>/dev/null); then
			printf '%s' "$comp"
			return 0
		fi
	done
	return 1
}

resolved_root=$(resolve_dir "$root") || fail 'cannot resolve the repository root'

# A symlink is answered as one before anything follows it, so a link pointing
# out of the repository never serves what it points at. Its escape is decided by
# the directory holding it, which is the only part of the path already trusted.
if [ -L "$path" ]; then
	resolved_dir=$(resolve_dir "$dir") || fail 'cannot resolve the parent directory'
	target=$(readlink "$path") || fail 'cannot read the symlink target'
	if inside_root "$resolved_dir" "$resolved_root"; then
		printf 'symlink 0\n'
	else
		printf 'symlink 1\n'
	fi
	printf '%s' "$target"
	exit 0
fi

if [ ! -e "$path" ]; then
	blocked=$(unreachable_component) && fail "cannot enter '$blocked'"
	printf 'missing\n'
	exit 0
fi

if [ ! -f "$path" ]; then
	printf 'other\n'
	exit 0
fi

resolved_dir=$(resolve_dir "$dir") || fail 'cannot resolve the parent directory'
case $resolved_dir in
/) resolved_path=/$base ;;
*) resolved_path=$resolved_dir/$base ;;
esac
if inside_root "$resolved_path" "$resolved_root"; then
	escapes=0
else
	escapes=1
fi

# An unreadable file fails here rather than being reported as empty, which is
# what a caller diffing it would otherwise show as a wholesale deletion.
size=$(wc -c <"$path" | tr -d '[:space:]')
[ -n "$size" ] || fail 'cannot measure the file'

if [ "$mode" != read ] || [ "$size" -gt "$limit" ]; then
	printf 'regular %s %s none\n' "$escapes" "$size"
	exit 0
fi

printf 'regular %s %s raw\n' "$escapes" "$size"
cat "$path"
"#;

impl GitTarget {
    pub fn local(root: impl Into<PathBuf>) -> Self {
        Self::Local { root: root.into() }
    }

    /// A checkout on an OpenSSH host. `config_cwd` is the *local* directory
    /// nac's own paths resolve against, because that is where the shared
    /// control socket lives.
    pub fn ssh(connection: SshConnection, remote_cwd: PathBuf, config_cwd: &Path) -> Self {
        let control_path = connection.control_path(&PathContext::new(config_cwd));
        Self::Ssh {
            connection,
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
            Self::Ssh { connection, .. } => Some(&connection.host),
        }
    }

    /// The connection behind this checkout, which callers keying a cache need in
    /// full: the same host name reached with another key is another checkout.
    pub fn ssh_connection(&self) -> Option<&SshConnection> {
        match self {
            Self::Local { .. } => None,
            Self::Ssh { connection, .. } => Some(connection),
        }
    }

    /// How the checkout is named in messages the user reads.
    pub fn describe(&self) -> String {
        match self {
            Self::Local { root } => root.display().to_string(),
            Self::Ssh {
                connection,
                remote_cwd,
                ..
            } => format!("{}:{}", connection.describe(), remote_cwd.display()),
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
            Self::Ssh { connection, .. } => {
                let host = connection.describe();
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
            // $0 for the script, so the reader's own arguments start at $1.
            "nac-worktree".to_string(),
            repo_root.display().to_string(),
            relpath.to_string(),
            limit.to_string(),
            mode.to_string(),
        ];
        let output = self.program_output(repo_root, &[], "sh", &args)?;
        if !output.status.success() {
            if let Some(reason) = self.unavailable_reason_for("sh", &output) {
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
                connection,
                control_path,
                ..
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
                command.args(connection.ssh_args(control_path));
                command.arg("--");
                command.arg(&connection.host);
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

/// Splits the reader's answer into its header line and the bytes after it.
///
/// Contents are taken as everything past the first newline, so a file needs no
/// length prefix and no encoding: whatever the header announced is simply the
/// rest of the stream.
fn parse_remote_worktree(stdout: &[u8], relpath: &str) -> Result<WorktreeRead> {
    if stdout.is_empty() {
        bail!("the remote host reported nothing for '{}'", relpath);
    }

    let (header, body) = match stdout.iter().position(|byte| *byte == b'\n') {
        Some(index) => (&stdout[..index], &stdout[index + 1..]),
        None => (stdout, &stdout[stdout.len()..]),
    };
    let header = String::from_utf8_lossy(header);
    let header = header.trim_end();
    let (kind, rest) = header.split_once(' ').unwrap_or((header, ""));

    match kind {
        "missing" => Ok(WorktreeRead::Missing),
        "other" => Ok(WorktreeRead::NotRegular),
        "error" => {
            let message = if rest.is_empty() {
                "the remote host reported no details"
            } else {
                rest
            };
            bail!("cannot stat '{}': {}", relpath, message)
        }
        "symlink" => Ok(WorktreeRead::Symlink {
            target: body.to_vec(),
            escapes: rest.trim() == "1",
        }),
        "regular" => {
            let mut fields = rest.split_whitespace();
            let escapes = fields.next() == Some("1");
            let size = fields
                .next()
                .and_then(|size| size.parse::<u64>().ok())
                .ok_or_else(|| {
                    anyhow!("the remote report for '{}' has no readable size", relpath)
                })?;
            let bytes = match fields.next() {
                Some("raw") => Some(body.to_vec()),
                _ => None,
            };
            Ok(WorktreeRead::Regular {
                size,
                escapes,
                bytes,
            })
        }
        other => bail!("the remote report for '{}' is unknown: {}", relpath, other),
    }
}

pub(crate) fn first_stderr_line(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("no details reported")
        .to_string()
}
