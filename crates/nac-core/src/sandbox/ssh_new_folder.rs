//! Creating one project folder on an OpenSSH host, for the remote picker.
//!
//! Runs over the same multiplexed connection as the remote listing and, like
//! it, as a POSIX shell script so nothing has to be installed on the host. The
//! folder is made on the host the picker browses — never on this machine.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

use crate::paths::PathContext;
use crate::project_folders::{AuthorizedRemoteFolder, NewFolderError};

use super::ssh_command::{prepare_control_socket_dir, quoted_program_and_args, SshConnection};

/// The same bound as a listing: long enough for a slow handshake, short enough
/// that a wedged host does not hold the request open.
const CREATE_TIMEOUT: Duration = Duration::from_secs(20);

/// Exit status ssh reserves for its own failures rather than the command's.
const SSH_TRANSPORT_EXIT: i32 = 255;

/// Creates `$2` inside `$1`, which must still be the physical directory the
/// listing reported. Replies with one line:
///
/// ```text
/// created            exactly one new directory now exists
/// exists             something already has that name; nothing was changed
/// missing | notdir | denied | moved
/// failed\t<reason>   mkdir refused; nothing was created
/// unverified         mkdir succeeded but the result is not a plain directory
/// ```
pub(crate) const REMOTE_NEW_FOLDER_SCRIPT: &str = r#"parent=$1
name=$2

if [ ! -e "$parent" ]; then
	printf 'missing\n'
	exit 0
fi
if [ ! -d "$parent" ]; then
	printf 'notdir\n'
	exit 0
fi
cd -P -- "$parent" 2>/dev/null || {
	printf 'denied\n'
	exit 0
}
# The listing reported the physical path. A parent that now resolves elsewhere
# was moved or replaced by a symlink after it was listed, and is refused.
here=$(pwd -P) || {
	printf 'denied\n'
	exit 0
}
if [ "$here" != "$parent" ]; then
	printf 'moved\n'
	exit 0
fi

# Relative to the directory this shell now stands in, so a later swap of the
# parent's path cannot redirect it. No -p: exactly one directory, and anything
# already there — a folder, a file, a dangling link — is an error, never reused.
if [ -e "$name" ] || [ -h "$name" ]; then
	printf 'exists\n'
	exit 0
fi
if ! failure=$(mkdir -- "$name" 2>&1); then
	if [ -e "$name" ] || [ -h "$name" ]; then
		printf 'exists\n'
	else
		printf 'failed\t%s\n' "$failure"
	fi
	exit 0
fi
if [ -h "$name" ] || [ ! -d "$name" ]; then
	printf 'unverified\n'
	exit 0
fi
printf 'created\n'
"#;

/// The command line handed to the host's login shell. Every word is quoted, so
/// the name and parent reach the script as `$1`/`$2` and are never parsed.
pub(crate) fn remote_new_folder_command(folder: &AuthorizedRemoteFolder) -> String {
    let args = [
        "-c".to_string(),
        REMOTE_NEW_FOLDER_SCRIPT.to_string(),
        // $0 for the script, so its own arguments start at $1.
        "nac-new-folder".to_string(),
        folder.parent().to_string(),
        folder.name().to_string(),
    ];
    quoted_program_and_args("sh", &args).join(" ")
}

/// Creates `folder` on `connection` and returns its path on the host.
pub async fn create_remote_folder(
    connection: &SshConnection,
    folder: &AuthorizedRemoteFolder,
    paths: &PathContext,
) -> Result<String, NewFolderError> {
    let control_path = connection.control_path(paths);
    prepare_control_socket_dir(&control_path).map_err(|error| NewFolderError::Unreachable {
        host: connection.describe(),
        reason: format!("failed to create the ssh control directory: {error}"),
    })?;

    let mut command = Command::new("ssh");
    command.args(connection.ssh_args(&control_path));
    command.arg("--");
    command.arg(&connection.host);
    command.arg(remote_new_folder_command(folder));
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);

    let output = timeout(CREATE_TIMEOUT, command.output())
        .await
        .map_err(|_| NewFolderError::Unreachable {
            host: connection.describe(),
            reason: format!("no answer within {} seconds", CREATE_TIMEOUT.as_secs()),
        })?
        .map_err(|error| NewFolderError::Unreachable {
            host: connection.describe(),
            reason: format!("could not run ssh: {error} (is the OpenSSH client installed?)"),
        })?;

    if !output.status.success() {
        let reason = super::ssh_browse::first_stderr_line(&output.stderr);
        if output.status.code() == Some(SSH_TRANSPORT_EXIT) || output.status.code().is_none() {
            return Err(NewFolderError::Unreachable {
                host: connection.describe(),
                reason,
            });
        }
        return Err(NewFolderError::Failed(format!(
            "creating a folder on ssh host '{}' failed: {reason}",
            connection.describe()
        )));
    }
    parse_reply(&output.stdout, folder)
}

pub(crate) fn parse_reply(
    stdout: &[u8],
    folder: &AuthorizedRemoteFolder,
) -> Result<String, NewFolderError> {
    let text = String::from_utf8_lossy(stdout);
    let parent = folder.parent().to_string();
    let path = folder.path();
    for line in text.lines() {
        match line {
            "created" => return Ok(path),
            "exists" => return Err(NewFolderError::AlreadyExists(path)),
            "missing" => return Err(NewFolderError::ParentNotFound(parent)),
            "notdir" => return Err(NewFolderError::ParentNotADirectory(parent)),
            "moved" => return Err(NewFolderError::ParentChanged(parent)),
            "denied" => {
                return Err(NewFolderError::Refused {
                    path: parent,
                    reason: "permission denied".to_string(),
                })
            }
            "unverified" => {
                return Err(NewFolderError::Failed(format!(
                    "created '{path}' but could not confirm it is a folder"
                )))
            }
            _ => {
                if let Some(reason) = line.strip_prefix("failed\t") {
                    return Err(NewFolderError::Refused {
                        path,
                        reason: reason.to_string(),
                    });
                }
            }
        }
    }
    Err(NewFolderError::Failed(format!(
        "the ssh host did not confirm whether '{path}' was created"
    )))
}

#[cfg(test)]
#[path = "ssh_new_folder_tests.rs"]
mod tests;
