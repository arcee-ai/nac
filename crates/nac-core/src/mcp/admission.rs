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

fn disconnected_path(cwd: &Path) -> Result<PathBuf> {
    PathContext::new(cwd)
        .nac_home_dir()
        .map(|dir| dir.join(DISCONNECTED_FILE))
        .ok_or_else(|| anyhow!("no home directory is available for MCP connection state"))
}

fn read_disconnected(path: &Path) -> Result<DisconnectedServers> {
    read_auth_string_from_path(path)?
        .map(|raw| serde_json::from_str(&raw).context("MCP connection state is invalid"))
        .unwrap_or_else(|| Ok(DisconnectedServers::default()))
}

pub(super) fn is_disconnected(cwd: &Path, server_name: &str) -> Result<bool> {
    Ok(read_disconnected(&disconnected_path(cwd)?)?
        .servers
        .contains(server_name))
}

pub(super) fn set_disconnected(cwd: &Path, server_name: &str, disconnected: bool) -> Result<()> {
    let path = disconnected_path(cwd)?;
    with_credential_lock(&path.with_extension("json.lock"), || {
        let mut state = read_disconnected(&path)?;
        let changed = if disconnected {
            state.servers.insert(server_name.to_string())
        } else {
            state.servers.remove(server_name)
        };
        if changed {
            write_auth_string_to_path(&path, &serde_json::to_string(&state)?)?;
        }
        Ok(())
    })
}
