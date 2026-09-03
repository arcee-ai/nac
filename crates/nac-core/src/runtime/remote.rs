use super::*;

/// Lists a directory on the host these options describe, or the login home when
/// `path` is empty.
///
/// This is also how a launch form finds out whether the connection works: the
/// listing needs the same handshake a session would, and it leaves the
/// multiplexed connection behind for the session that follows. `config_cwd` is
/// the *local* directory nac's own paths resolve against, since the private key
/// and the control socket are on this machine.
pub async fn browse_ssh_directory(
    options: &SshOptions,
    path: Option<&str>,
    hidden: bool,
    config_cwd: &Path,
) -> std::result::Result<RemoteListing, RemoteBrowseError> {
    let paths = PathContext::new(config_cwd);
    options
        .validate(&paths)
        .map_err(|error| RemoteBrowseError::Invalid(error.to_string()))?;
    let connection = options.connection(&paths).ok_or_else(|| {
        RemoteBrowseError::Invalid("an ssh host is required to browse a remote directory".into())
    })?;
    browse_remote_directory(&connection, path, hidden, &paths).await
}

pub(super) fn trim_ssh_host(ssh_host: Option<String>) -> Option<String> {
    ssh_host
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn remote_cwd_or_home(cwd: PathBuf) -> PathBuf {
    if cwd.as_os_str().to_string_lossy().trim().is_empty() {
        PathBuf::from("~")
    } else {
        cwd
    }
}

pub(super) async fn canonical_remote_session_cwd(
    connection: &SshConnection,
    requested: &str,
    paths: &PathContext,
) -> Result<PathBuf> {
    // The login home spelling is already stable for one canonical connection
    // identity and intentionally remains portable across hosts.
    if requested == "~" {
        return Ok(PathBuf::from("~"));
    }
    #[cfg(test)]
    if let Some(path) = std::env::var_os("NAC_TEST_CANONICAL_REMOTE_CWD") {
        return Ok(PathBuf::from(path));
    }
    Ok(PathBuf::from(
        crate::sandbox::browse_remote_directory(connection, Some(requested), false, paths)
            .await
            .map_err(anyhow::Error::new)?
            .path,
    ))
}
