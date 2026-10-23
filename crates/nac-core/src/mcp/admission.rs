//! Servers the user disconnected; every session of this NAC home refuses them until reconnected.

use std::collections::BTreeSet;

use nac_credential_store::{
    read_auth_string_from_path, with_credential_lock, write_auth_string_to_path,
};
use serde::Serialize;

use super::*;

const DISCONNECTED_FILE: &str = "mcp_disconnected.json";

#[derive(Default, Serialize, Deserialize)]
struct DisconnectedServers {
    servers: BTreeSet<String>,
}

/// The disconnect record of the NAC home that also holds the MCP configuration.
#[derive(Clone)]
pub(super) struct ConnectionState {
    path: PathBuf,
}

impl ConnectionState {
    pub(super) fn for_home(paths: &PathContext) -> Result<Self> {
        let home = paths
            .nac_home_dir()
            .ok_or_else(|| anyhow!("no home directory is available for MCP connection state"))?;
        Ok(Self {
            path: home.join(DISCONNECTED_FILE),
        })
    }

    fn read(&self) -> Result<DisconnectedServers> {
        read_auth_string_from_path(&self.path)?
            .map(|raw| serde_json::from_str(&raw).context("MCP connection state is invalid"))
            .unwrap_or_else(|| Ok(DisconnectedServers::default()))
    }

    pub(super) fn is_disconnected(&self, server_name: &str) -> Result<bool> {
        Ok(self.read()?.servers.contains(server_name))
    }

    /// Records one server's state; an unreadable record is rebuilt with all `configured` servers disconnected.
    pub(super) fn set_disconnected<'a>(
        &self,
        server_name: &str,
        disconnected: bool,
        configured: impl IntoIterator<Item = &'a String>,
    ) -> Result<()> {
        self.edit(
            |servers| {
                if disconnected {
                    servers.insert(server_name.to_string());
                } else {
                    servers.remove(server_name);
                }
            },
            configured,
        )
    }

    /// Marks `to` disconnected when `from` is; an unreadable record already blocks every server.
    pub(super) fn copy_mark(&self, from: &str, to: &str) -> Result<()> {
        with_credential_lock(&self.path.with_extension("json.lock"), || {
            let Ok(mut state) = self.read() else {
                return Ok(());
            };
            if state.servers.contains(from) && state.servers.insert(to.to_string()) {
                write_auth_string_to_path(&self.path, &serde_json::to_string(&state)?)?;
            }
            Ok(())
        })
    }

    fn edit<'a>(
        &self,
        change: impl FnOnce(&mut BTreeSet<String>),
        configured: impl IntoIterator<Item = &'a String>,
    ) -> Result<()> {
        with_credential_lock(&self.path.with_extension("json.lock"), || {
            let mut state = self.read().unwrap_or_else(|_| DisconnectedServers {
                servers: configured.into_iter().cloned().collect(),
            });
            change(&mut state.servers);
            write_auth_string_to_path(&self.path, &serde_json::to_string(&state)?)
        })
    }
}
