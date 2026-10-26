//! Servers the user disconnected; every session of this NAC home refuses them until reconnected.

use std::collections::{BTreeMap, BTreeSet};
use std::time::{SystemTime, UNIX_EPOCH};

use nac_credential_store::{
    read_auth_string_from_path, with_credential_lock, write_auth_string_to_path,
};
use serde::Serialize;

use super::*;

const DISCONNECTED_FILE: &str = "mcp_disconnected.json";

/// Identities let a running session follow its server through rename and delete; mounting never writes.
#[derive(Serialize, Deserialize)]
struct ConnectionRecord {
    /// Changes when the record is rebuilt, so sessions mounted under an older record stay refused.
    epoch: u64,
    rebuilt: bool,
    names: BTreeMap<String, u64>,
    /// Names a server had before a rename or delete; sessions that mounted them follow its identity.
    retired: BTreeMap<String, u64>,
    /// Identities sessions may use; any other identity is refused.
    admitted: BTreeSet<u64>,
    next: u64,
}

impl ConnectionRecord {
    /// Seeded from the clock so a rebuilt record never reissues an identity an older session holds.
    fn new() -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(1, |elapsed| elapsed.as_nanos() as u64);
        Self {
            epoch: seed,
            rebuilt: false,
            names: BTreeMap::new(),
            retired: BTreeMap::new(),
            admitted: BTreeSet::new(),
            next: seed,
        }
    }

    fn mint(&mut self, admitted: bool) -> u64 {
        let identity = self.next;
        self.next = self.next.wrapping_add(1);
        if admitted {
            self.admitted.insert(identity);
        }
        identity
    }

    fn identity(&mut self, name: &str, admitted: bool) -> u64 {
        if let Some(identity) = self.names.get(name) {
            return *identity;
        }
        let identity = self.mint(admitted);
        self.names.insert(name.to_string(), identity);
        identity
    }

    fn resolve(&self, name: &str) -> Option<u64> {
        self.names
            .get(name)
            .or_else(|| self.retired.get(name))
            .copied()
    }

    fn is_disconnected(&self, name: &str) -> bool {
        self.names
            .get(name)
            .is_some_and(|identity| !self.admitted.contains(identity))
    }

    fn admits(&self, mount: &Mount) -> bool {
        let same_record = match mount.epoch {
            Some(epoch) => epoch == self.epoch,
            None => !self.rebuilt,
        };
        same_record
            && mount
                .identity
                .or_else(|| self.resolve(&mount.name))
                .is_none_or(|identity| self.admitted.contains(&identity))
    }
}

/// What a session mounted: the record it read and the server's identity there, once one exists.
pub(super) struct Mount {
    epoch: Option<u64>,
    identity: Option<u64>,
    name: String,
}

/// What an edit does when the record cannot be read; an unreadable record already blocks every session.
enum Unreadable<'a> {
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

    fn read(&self) -> Result<Option<ConnectionRecord>> {
        read_auth_string_from_path(&self.path)?
            .map(|raw| serde_json::from_str(&raw).context("MCP connection state is invalid"))
            .transpose()
    }

    fn with_record<T: Default>(
        &self,
        unreadable: Unreadable<'_>,
        change: impl FnOnce(&mut ConnectionRecord) -> T,
    ) -> Result<T> {
        with_credential_lock(&self.path.with_extension("json.lock"), || {
            let read = self
                .read()
                .map(|record| record.unwrap_or_else(ConnectionRecord::new));
            let mut record = match (read, unreadable) {
                (Ok(record), _) => record,
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

    /// What a new session mounts `server_name` as, or `None` while it is disconnected.
    pub(super) fn mount(&self, server_name: &str) -> Result<Option<Mount>> {
        let record = self.read()?;
        let mount = Mount {
            epoch: record.as_ref().map(|record| record.epoch),
            identity: record
                .as_ref()
                .and_then(|record| record.resolve(server_name)),
            name: server_name.to_string(),
        };
        let admitted = record.as_ref().is_none_or(|record| record.admits(&mount));
        Ok(admitted.then_some(mount))
    }

    pub(super) fn is_admitted(&self, mount: &Mount) -> Result<bool> {
        Ok(match self.read()? {
            Some(record) => record.admits(mount),
            None => mount.epoch.is_none(),
        })
    }

    pub(super) fn is_disconnected(&self, server_name: &str) -> Result<bool> {
        Ok(self
            .read()?
            .is_some_and(|record| record.is_disconnected(server_name)))
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
            record.rebuilt = true;
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

    /// Gives a newly created server its own identity, so it never inherits a retired name's state.
    pub(super) fn claim(&self, server_name: &str) -> Result<()> {
        self.with_record(Unreadable::Skip, |record| {
            record.identity(server_name, true);
        })
    }

    /// Moves `from`'s identity to `to`, so sessions that mounted `from` follow the renamed server.
    pub(super) fn rename(&self, from: &str, to: &str) -> Result<()> {
        self.with_record(Unreadable::Skip, |record| {
            let identity = match record.names.remove(from) {
                Some(identity) => identity,
                None => record.mint(true),
            };
            record.names.insert(to.to_string(), identity);
            record.retired.insert(from.to_string(), identity);
        })
    }

    /// Releases a deleted server's name; sessions that mounted it keep its last state.
    pub(super) fn forget(&self, server_name: &str) -> Result<()> {
        self.with_record(Unreadable::Skip, |record| {
            if let Some(identity) = record.names.remove(server_name) {
                record.retired.insert(server_name.to_string(), identity);
            }
        })
    }
}
