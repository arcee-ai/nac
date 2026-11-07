//! Creating one project folder from the working-folder picker.
//!
//! This is an authenticated human product operation: the request has already
//! passed delivery's host, origin and managed admission, and core issues the
//! narrow authority to create exactly one named child after validating the
//! name, binding the listed parent and evaluating hard and configured Deny. It
//! never enters the agent approval lifecycle and never creates grants.

use nac_core::permissions::PermissionRule;
use nac_core::project_folders::{AuthorizedLocalFolder, AuthorizedRemoteFolder, NewFolderError};
use nac_core::runtime::{self, NacConfig};

use crate::{SessionManager, SshRequest};

pub(crate) struct NewFolder {
    pub(crate) parent: String,
    pub(crate) name: String,
}

pub(crate) struct ProjectFolderApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> ProjectFolderApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    /// Configured rules as the server's own configuration states them now. A
    /// configuration that cannot be read refuses the operation rather than
    /// running it without its Deny rules.
    fn configured_rules(&self, target: &NewFolder) -> Result<Vec<PermissionRule>, NewFolderError> {
        NacConfig::load_without_model_from_cwd(&self.manager.inner.root_cwd)
            .map(|config| config.permissions.rules)
            .map_err(|error| NewFolderError::Denied {
                path: format!("{}/{}", target.parent.trim_end_matches('/'), target.name),
                reason: format!("permission configuration could not be read: {error:#}"),
            })
    }

    /// Creates the folder on the machine running this server.
    pub(crate) async fn create_local(&self, folder: NewFolder) -> Result<String, NewFolderError> {
        let rules = self.configured_rules(&folder)?;
        let store_path = self.manager.inner.store_path.clone();
        tokio::task::spawn_blocking(move || {
            AuthorizedLocalFolder::issue(&folder.parent, &folder.name, rules, &store_path)?
                .create()
                .map(|path| path.display().to_string())
        })
        .await
        .map_err(|error| {
            NewFolderError::Failed(format!("folder creation did not finish: {error}"))
        })?
    }

    /// Creates the folder on the SSH host the picker is browsing. Without a
    /// host this refuses; it never falls back to this machine.
    pub(crate) async fn create_ssh(
        &self,
        ssh: SshRequest,
        folder: NewFolder,
    ) -> Result<String, NewFolderError> {
        let rules = self.configured_rules(&folder)?;
        let authorized = AuthorizedRemoteFolder::issue(
            &folder.parent,
            &folder.name,
            rules,
            &self.manager.inner.store_path,
        )?;
        runtime::create_ssh_folder(
            &ssh.into_options(),
            &authorized,
            &self.manager.inner.root_cwd,
        )
        .await
    }
}
