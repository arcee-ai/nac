//! Listing directories on an OpenSSH host, for the remote path picker.
//!
//! A remote session's working directory lives on the far end, where the server
//! cannot use `std::fs`, so the listing is asked for over the same multiplexed
//! connection the rest of the SSH layer uses. Answering it also answers whether
//! the connection works at all, which is what the launch form asks first.
//!
//! Deliberately a POSIX shell script rather than an interpreter or a helper nac
//! would have to put there: hosts that forbid installing software are exactly
//! where remote execution earns its keep. Nothing is written to the host, and
//! only names cross the connection — never file contents.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

use crate::paths::PathContext;

use super::ssh_command::{prepare_control_socket_dir, quoted_program_and_args, SshConnection};

/// The picker is a navigation aid, so a huge directory is truncated on the host
/// rather than sent in full.
const MAX_ENTRIES: usize = 1000;

/// Long enough for a handshake on a slow link, short enough that a wedged host
/// does not hold an HTTP request open.
const BROWSE_TIMEOUT: Duration = Duration::from_secs(20);

/// Exit status ssh reserves for its own failures rather than the command's.
const SSH_TRANSPORT_EXIT: i32 = 255;

/// One directory on the remote host, in the shape the picker navigates by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteListing {
    /// Where the host says it ended up, with `~` and symlinks resolved there.
    pub path: String,
    /// `None` at the filesystem root, which is where upward navigation stops.
    pub parent: Option<String>,
    pub home: Option<String>,
    pub entries: Vec<RemoteEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

/// Why a listing failed, kept apart because each one is fixed differently: a
/// path that is not there is the user's typo, a host that will not answer is
/// not.
#[derive(Debug)]
pub enum RemoteBrowseError {
    /// The connection was described in a way that cannot be tried at all.
    Invalid(String),
    /// The path does not exist on the host.
    NotFound(String),
    /// It exists but is not a directory.
    NotADirectory(String),
    /// It exists and cannot be entered or read.
    Unreadable { path: String, reason: String },
    /// ssh itself could not get there: no route, refused key, wrong port.
    Unreachable { host: String, reason: String },
    /// The connection worked but the answer did not come back usable.
    Remote(String),
}

impl std::fmt::Display for RemoteBrowseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(reason) => write!(formatter, "{reason}"),
            Self::NotFound(path) => {
                write!(formatter, "path '{path}' does not exist on the ssh host")
            }
            Self::NotADirectory(path) => {
                write!(
                    formatter,
                    "path '{path}' on the ssh host is not a directory"
                )
            }
            Self::Unreadable { path, reason } => write!(
                formatter,
                "could not read directory '{path}' on the ssh host: {reason}"
            ),
            Self::Unreachable { host, reason } => {
                write!(formatter, "cannot reach ssh host '{host}': {reason}")
            }
            Self::Remote(reason) => write!(formatter, "{reason}"),
        }
    }
}

impl std::error::Error for RemoteBrowseError {}

/// Reports one directory, its parent, the login home, and the directories in it.
///
/// `~` is expanded on the host, because only the host knows where its home is.
/// The reply is one line per fact, tab-separated, which keeps the far end to
/// shell builtins:
///
/// ```text
/// p\t<listed directory>
/// h\t<home directory>
/// u\t<parent>            (omitted at the filesystem root)
/// d\t<subdirectory name>
/// t                      (more entries exist than were listed)
/// missing | notdir | denied
/// ```
const REMOTE_BROWSE_SCRIPT: &str = r#"target=$1
limit=$2
hidden=$3

case $target in
'') target=$HOME ;;
'~') target=$HOME ;;
'~/'*) target=$HOME/${target#'~/'} ;;
esac

# Separated so the caller can tell a typo from a directory it may not enter.
if [ ! -e "$target" ]; then
	printf 'missing\n'
	exit 0
fi
if [ ! -d "$target" ]; then
	printf 'notdir\n'
	exit 0
fi

# cd plus pwd -P is the shell's own realpath, with no dependency to install, and
# it doubles as the readability test: a directory that cannot be entered cannot
# be listed either.
cd -- "$target" 2>/dev/null || {
	printf 'denied\n'
	exit 0
}
pwd=$(pwd -P) || {
	printf 'denied\n'
	exit 0
}

printf 'p\t%s\n' "$pwd"
[ -n "${HOME:-}" ] && printf 'h\t%s\n' "$HOME"
case $pwd in
/) ;;
*)
	parent=${pwd%/*}
	[ -n "$parent" ] || parent=/
	printf 'u\t%s\n' "$parent"
	;;
esac

# An unquoted glob is the listing: it leaves a directory nac cannot read as an
# empty one rather than as an error. Dot-prefixed names need globs of their own,
# written so that neither `.` nor `..` is ever matched. A name is tested with -d
# so a symlink to a directory stays navigable.
if [ "$hidden" = 1 ]; then
	set -- * .[!.]* ..?*
else
	set -- *
fi

count=0
for entry in "$@"; do
	[ -d "$entry" ] || continue
	count=$((count + 1))
	if [ "$count" -gt "$limit" ]; then
		printf 't\n'
		break
	fi
	printf 'd\t%s\n' "$entry"
done
"#;

/// Lists `path` on `connection`, or the login home when `path` is empty.
///
/// `hidden` includes dot-prefixed names, which the picker asks for only when the
/// user does. `paths` is nac's *local* path context: it locates the shared
/// control socket and resolves a `~` in the private key, both of which are on
/// this machine.
pub async fn browse_remote_directory(
    connection: &SshConnection,
    path: Option<&str>,
    hidden: bool,
    paths: &PathContext,
) -> Result<RemoteListing, RemoteBrowseError> {
    let requested = path.map(str::trim).unwrap_or_default().to_string();
    let control_path = connection.control_path(paths);
    prepare_control_socket_dir(&control_path).map_err(|error| RemoteBrowseError::Unreachable {
        host: connection.describe(),
        reason: format!("failed to create the ssh control directory: {error}"),
    })?;

    let args = [
        "-c".to_string(),
        REMOTE_BROWSE_SCRIPT.to_string(),
        // $0 for the script, so its own arguments start at $1.
        "nac-browse".to_string(),
        requested.clone(),
        MAX_ENTRIES.to_string(),
        if hidden { "1" } else { "0" }.to_string(),
    ];
    let remote = quoted_program_and_args("sh", &args).join(" ");

    let mut command = Command::new("ssh");
    command.args(connection.ssh_args(&control_path));
    command.arg("--");
    command.arg(&connection.host);
    command.arg(remote);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);

    let output = timeout(BROWSE_TIMEOUT, command.output())
        .await
        .map_err(|_| RemoteBrowseError::Unreachable {
            host: connection.describe(),
            reason: format!("no answer within {} seconds", BROWSE_TIMEOUT.as_secs()),
        })?
        .map_err(|error| RemoteBrowseError::Unreachable {
            host: connection.describe(),
            reason: format!("could not run ssh: {error} (is the OpenSSH client installed?)"),
        })?;

    if !output.status.success() {
        let reason = first_stderr_line(&output.stderr);
        // 255 is ssh's own failure; anything else came back from the far end,
        // where the only thing that can fail is the shell running the script.
        if output.status.code() == Some(SSH_TRANSPORT_EXIT) || output.status.code().is_none() {
            return Err(RemoteBrowseError::Unreachable {
                host: connection.describe(),
                reason,
            });
        }
        return Err(RemoteBrowseError::Remote(format!(
            "listing directories on ssh host '{}' failed: {reason}",
            connection.describe()
        )));
    }

    parse_listing(&output.stdout, &requested, connection)
}

fn parse_listing(
    stdout: &[u8],
    requested: &str,
    connection: &SshConnection,
) -> Result<RemoteListing, RemoteBrowseError> {
    let text = String::from_utf8_lossy(stdout);
    let described = if requested.is_empty() {
        "~".to_string()
    } else {
        requested.to_string()
    };

    let mut path: Option<String> = None;
    let mut home: Option<String> = None;
    let mut parent: Option<String> = None;
    let mut names: Vec<String> = Vec::new();
    let mut truncated = false;

    for line in text.lines() {
        match line.split_once('\t') {
            Some(("p", value)) => path = Some(value.to_string()),
            Some(("h", value)) => home = Some(value.to_string()),
            Some(("u", value)) => parent = Some(value.to_string()),
            Some(("d", value)) => names.push(value.to_string()),
            // A name holding a newline arrives split across lines, so its tail
            // has no marker; skipping it loses that one entry rather than the
            // listing. Nothing else unmarked is emitted.
            Some(_) | None => match line {
                "missing" => return Err(RemoteBrowseError::NotFound(described)),
                "notdir" => return Err(RemoteBrowseError::NotADirectory(described)),
                "denied" => {
                    return Err(RemoteBrowseError::Unreadable {
                        path: described,
                        reason: "permission denied".to_string(),
                    })
                }
                "t" => truncated = true,
                _ => {}
            },
        }
    }

    let Some(path) = path else {
        return Err(RemoteBrowseError::Remote(format!(
            "ssh host '{}' did not report a directory for '{described}'",
            connection.describe()
        )));
    };

    let mut entries: Vec<RemoteEntry> = names
        .into_iter()
        .map(|name| RemoteEntry {
            path: join_remote(&path, &name),
            name,
            is_directory: true,
        })
        .collect();
    // Sorted here rather than on the host so the order matches the local
    // picker's, whatever the remote locale would have done.
    entries.sort_by_key(|entry| entry.name.to_lowercase());

    Ok(RemoteListing {
        path,
        parent,
        home,
        entries,
        truncated,
    })
}

/// Remote paths are POSIX whatever this machine is, so they are joined as text
/// rather than through `Path`.
fn join_remote(directory: &str, name: &str) -> String {
    if directory.ends_with('/') {
        format!("{directory}{name}")
    } else {
        format!("{directory}/{name}")
    }
}

fn first_stderr_line(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    if line.is_empty() {
        "no error output".to_string()
    } else {
        line.to_string()
    }
}
