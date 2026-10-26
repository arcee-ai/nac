//! Servers the user disconnected; every session of this NAC home refuses them until reconnected.

use std::collections::{BTreeMap, BTreeSet};
use std::time::{SystemTime, UNIX_EPOCH};

use nac_credential_store::{
    read_auth_string_from_path, with_credential_lock, write_auth_string_to_path,
};
use serde::Serialize;

use super::*;

const DISCONNECTED_FILE: &str = "mcp_disconnected.json";

/// A mounted session keeps the identity it loaded, so rename and delete never change what it may use.
#[derive(Serialize, Deserialize)]
struct ConnectionRecord {
    names: BTreeMap<String, u64>,
    /// Identities sessions may use; any other identity is refused.
    admitted: BTreeSet<u64>,
    next: u64,
}

impl ConnectionRecord {
    /// Seeded from the clock so a rebuilt record never reissues an identity an older session holds.
    fn new() -> Self {
        Self {
            names: BTreeMap::new(),
            admitted: BTreeSet::new(),
            next: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(1, |elapsed| elapsed.as_nanos() as u64),
        }
    }

    fn identity(&mut self, name: &str, admitted: bool) -> u64 {
        if let Some(identity) = self.names.get(name) {
            return *identity;
        }
        let identity = self.next;
        self.next = self.next.wrapping_add(1);
        self.names.insert(name.to_string(), identity);
        if admitted {
            self.admitted.insert(identity);
        }
        identity
    }

    fn is_disconnected(&self, name: &str) -> bool {
        self.names
            .get(name)
            .is_some_and(|identity| !self.admitted.contains(identity))
    }
}

/// What an edit does when the record cannot be read; an unreadable record already blocks every session.
enum Unreadable<'a> {
    Fail,
    Skip,
    Rebuild(&'a mut dyn FnMut() -> ConnectionRecord),
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

    fn read(&self) -> Result<ConnectionRecord> {
        read_auth_string_from_path(&self.path)?
            .map(|raw| serde_json::from_str(&raw).context("MCP connection state is invalid"))
            .unwrap_or_else(|| Ok(ConnectionRecord::new()))
    }

    fn with_record<T: Default>(
        &self,
        unreadable: Unreadable<'_>,
        change: impl FnOnce(&mut ConnectionRecord) -> T,
    ) -> Result<T> {
        with_credential_lock(&self.path.with_extension("json.lock"), || {
            let mut record = match (self.read(), unreadable) {
                (Ok(record), _) => record,
                (Err(error), Unreadable::Fail) => return Err(error),
                (Err(_), Unreadable::Skip) => return Ok(T::default()),
                (Err(_), Unreadable::Rebuild(rebuild)) => rebuild(),
            };
            let before = serde_json::to_string(&record)?;
            let result = change(&mut record);
            let after = serde_json::to_string(&record)?;
            if after != before {
                write_auth_string_to_path(&self.path, &after)?;
            }
            Ok(result)
        })
    }

    /// The identity a new session mounts `server_name` under, or `None` while it is disconnected.
    pub(super) fn mount(&self, server_name: &str) -> Result<Option<u64>> {
        self.with_record(Unreadable::Fail, |record| {
            let identity = record.identity(server_name, true);
            record.admitted.contains(&identity).then_some(identity)
        })
    }

    pub(super) fn is_admitted(&self, identity: u64) -> Result<bool> {
        Ok(self.read()?.admitted.contains(&identity))
    }

    pub(super) fn is_disconnected(&self, server_name: &str) -> Result<bool> {
        Ok(self.read()?.is_disconnected(server_name))
    }

    /// Records one server's state; an unreadable record is rebuilt with every `configured` server disconnected.
    pub(super) fn set_disconnected<'a>(
        &self,
        server_name: &str,
        disconnected: bool,
        configured: impl IntoIterator<Item = &'a String>,
    ) -> Result<()> {
        let mut configured = Some(configured);
        let mut repair = || {
            let mut record = ConnectionRecord::new();
            for name in configured.take().into_iter().flatten() {
                record.identity(name, false);
            }
            record
        };
        self.with_record(Unreadable::Rebuild(&mut repair), |record| {
            let identity = record.identity(server_name, !disconnected);
            if disconnected {
                record.admitted.remove(&identity);
            } else {
                record.admitted.insert(identity);
            }
        })
    }

    /// Moves `from`'s identity to `to`, so sessions that mounted `from` follow the renamed server.
    pub(super) fn rename(&self, from: &str, to: &str) -> Result<()> {
        self.with_record(Unreadable::Skip, |record| {
            if let Some(identity) = record.names.remove(from) {
                record.names.insert(to.to_string(), identity);
            }
        })
    }

    /// Releases a deleted server's name; sessions that mounted it keep its last state.
    pub(super) fn forget(&self, server_name: &str) -> Result<()> {
        self.with_record(Unreadable::Skip, |record| {
            record.names.remove(server_name);
        })
    }
}
