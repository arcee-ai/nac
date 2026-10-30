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
    /// Every identity each name has held, keyed by when it received it.
    history: BTreeMap<String, BTreeMap<u64, u64>>,
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
            history: BTreeMap::new(),
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

    fn record_holder(&mut self, name: &str, identity: u64) {
        let sequence = self.mint(false);
        self.history
            .entry(name.to_string())
            .or_default()
            .insert(sequence, identity);
    }

    fn bind(&mut self, name: &str, identity: u64) {
        self.names.insert(name.to_string(), identity);
        self.record_holder(name, identity);
    }

    fn identity(&mut self, name: &str, admitted: bool) -> u64 {
        if let Some(identity) = self.names.get(name) {
            return *identity;
        }
        let identity = self.mint(admitted);
        self.bind(name, identity);
        identity
    }

    /// Removes `name`, giving a server that never had an identity one, so its sessions keep a state.
    fn release(&mut self, name: &str) -> u64 {
        let identity = match self.names.remove(name) {
            Some(identity) => identity,
            None => self.mint(true),
        };
        self.record_holder(name, identity);
        identity
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
                .or_else(|| self.first_identity_since(mount))
                .is_none_or(|identity| self.admitted.contains(&identity))
    }

    /// A server without an identity at mount time takes the first one its name received afterwards.
    fn first_identity_since(&self, mount: &Mount) -> Option<u64> {
        self.history
            .get(&mount.name)?
            .range(mount.watermark..)
            .next()
            .map(|(_, identity)| *identity)
    }
}

/// What a session mounted: the record it read with the configuration, and the server's identity.
pub(super) struct Mount {
    epoch: Option<u64>,
    identity: Option<u64>,
    watermark: u64,
    name: String,
}

/// The record as read together with one configuration revision.
pub(super) struct ConnectionSnapshot(Option<ConnectionRecord>);

impl ConnectionSnapshot {
    pub(super) fn mount(&self, server_name: &str) -> Mount {
        Mount {
            epoch: self.0.as_ref().map(|record| record.epoch),
            identity: self
                .0
                .as_ref()
                .and_then(|record| record.names.get(server_name).copied()),
            watermark: self.0.as_ref().map_or(0, |record| record.next),
            name: server_name.to_string(),
        }
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

    /// Read under the config lease, so every name maps to the identity it had in that revision.
    pub(super) fn snapshot(&self) -> Result<ConnectionSnapshot> {
        self.read().map(ConnectionSnapshot)
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

    /// Gives a newly created server its own identity, so it never inherits an earlier holder's state.
    pub(super) fn claim(&self, server_name: &str) -> Result<()> {
        self.with_record(Unreadable::Skip, |record| {
            if record.names.contains_key(server_name) {
                record.release(server_name);
            }
            let identity = record.mint(true);
            record.bind(server_name, identity);
        })
    }

    /// Write-ahead binding: either config name keeps the same state if publication is interrupted.
    pub(super) fn prepare_rename(&self, from: &str, to: &str) -> Result<()> {
        self.with_record(Unreadable::Fail, |record| {
            let identity = record.identity(from, true);
            record.bind(to, identity);
        })
    }

    /// Removes the old alias only after configuration publication succeeded.
    pub(super) fn finish_rename(&self, from: &str, to: &str) -> Result<()> {
        self.with_record(Unreadable::Fail, |record| {
            if record.names.get(from) == record.names.get(to) {
                record.release(from);
            }
        })
    }

    /// Moves `from`'s identity to `to`, so sessions that mounted `from` follow the renamed server.
    pub(super) fn rename(&self, from: &str, to: &str) -> Result<()> {
        self.with_record(Unreadable::Skip, |record| {
            let identity = record.release(from);
            record.bind(to, identity);
        })
    }

    /// Releases a deleted server's name; sessions that mounted it keep its last state.
    pub(super) fn forget(&self, server_name: &str) -> Result<()> {
        self.with_record(Unreadable::Skip, |record| {
            record.release(server_name);
        })
    }
}
