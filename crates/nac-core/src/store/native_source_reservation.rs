//! Durable local source custody, separate from AFM/Native authority and loans.
//! Constructors are crate-private and uninstalled. A reservation denies other
//! SQLite writers; it does not admit runtime preparation or settle remote work.
use super::*;
use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use uuid::Uuid;

#[path = "native_source_schema.rs"]
mod schema;
pub(super) use schema::create_tables;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(crate) enum SourceKind {
    Project,
    Model,
    Session,
}
impl SourceKind {
    fn key(&self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::Model => "model",
            Self::Session => "session",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SourceVersion {
    pub kind: SourceKind,
    pub resource_id: String,
    pub revision: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct NativeSourceBinding {
    pub operation_id: Uuid,
    pub source_id: Uuid,
    pub source_generation: i64,
    pub canonical_effect_sha256: [u8; 32],
    // Some is the existing prebound snapshot; None is explicit preparation
    // without a prompt snapshot. Only the original owner may seal that later.
    #[serde(deserialize_with = "required_snapshot_digest")]
    pub creation_snapshot_sha256: Option<[u8; 32]>,
    pub session_id: String,
    pub project_id: Option<String>,
    pub sources: Vec<SourceVersion>,
}

fn required_snapshot_digest<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<[u8; 32]>, D::Error> {
    Option::deserialize(deserializer)
}

/// Original in-process ownership is nonclone/nonserializable. The durable row
/// alone cannot reconstruct it after restart or an uncertain acknowledgement.
pub(crate) struct NativeSourceReservation {
    state: std::sync::Arc<SourceState>,
}
pub(crate) struct SourceState {
    path: PathBuf,
    binding: NativeSourceBinding,
    process: u32,
    cutoff: Instant,
    denied: AtomicBool,
    prepared_snapshot: std::sync::OnceLock<[u8; 32]>,
}
impl std::ops::Deref for NativeSourceReservation {
    type Target = SourceState;
    fn deref(&self) -> &SourceState {
        &self.state
    }
}
#[path = "native_source_commands.rs"]
pub(crate) mod commands;
use std::sync::Arc;
impl Drop for NativeSourceReservation {
    fn drop(&mut self) {
        self.deny();
    } // Never erase durable unresolved slots.
}
impl NativeSourceBinding {
    fn validate(&self) -> Result<()> {
        anyhow::ensure!(
            !self.operation_id.is_nil()
                && !self.source_id.is_nil()
                && self.source_generation >= 0
                && self.canonical_effect_sha256 != [0; 32]
                && self
                    .creation_snapshot_sha256
                    .is_none_or(|digest| digest != [0; 32])
                && !self.session_id.is_empty()
                && self.session_id.len() <= 256
                && !self.sources.is_empty()
                && self.sources.len() <= 64,
            "invalid native source reservation"
        );
        let mut keys = std::collections::BTreeSet::new();
        for s in &self.sources {
            anyhow::ensure!(
                !s.resource_id.is_empty()
                    && s.resource_id.len() <= 256
                    && s.revision >= 0
                    && keys.insert((s.kind.clone(), s.resource_id.clone())),
                "invalid native source key"
            );
        }
        anyhow::ensure!(
            keys.contains(&(SourceKind::Session, self.session_id.clone())),
            "missing intended session source"
        );
        if let Some(project) = &self.project_id {
            anyhow::ensure!(
                keys.contains(&(SourceKind::Project, project.clone())),
                "missing project source"
            );
        }
        Ok(())
    }
}

pub(crate) fn source_revision(c: &Connection, kind: SourceKind, id: &str) -> Result<i64> {
    Ok(c.query_row(
        "SELECT revision FROM native_source_revisions WHERE kind=?1 AND resource_id=?2",
        params![kind.key(), id],
        |r| r.get(0),
    )
    .optional()?
    .unwrap_or(0))
}

#[path = "native_prepared_snapshot.rs"]
mod prepared_snapshot;
pub(crate) use prepared_snapshot::create_table as create_prepared_snapshot_table;

impl NativeSourceReservation {
    /// Bind actual protected preparation once; resource-only, never admission.
    /// Errors deny and retain the original source slots, including unknown commit.
    pub(crate) fn bind_prepared_snapshot(
        &self,
        snapshot: &crate::sessions::SessionSnapshot,
    ) -> Result<()> {
        let result = commands::bind_snapshot(self, snapshot);
        if result.is_err() {
            self.deny();
        }
        result
    }
    /// Called only by the future actual closed factory AFTER its upstream
    /// owners are retained. This local mechanism does not validate them.
    pub(crate) fn reserve(
        path: &Path,
        binding: NativeSourceBinding,
        original_cutoff: Instant,
    ) -> Result<Self> {
        commands::reserve(path, binding, original_cutoff)
    }
    pub(crate) fn check_current(&self) -> Result<()> {
        commands::run(self, commands::Action::Observe)
    }
    pub(crate) fn begin_preparation(&self) -> Result<()> {
        commands::run(self, commands::Action::Begin)
    }
    pub(crate) fn release_known_no_start(self) -> Result<()> {
        commands::run(&self, commands::Action::NoStart)
    }
    pub(crate) fn mark_uncertain(&self) -> Result<()> {
        self.deny();
        commands::run(self, commands::Action::Uncertain)
    }
    fn reserve_local(
        path: &Path,
        mut binding: NativeSourceBinding,
        original_cutoff: Instant,
    ) -> Result<Self> {
        anyhow::ensure!(
            Instant::now() < original_cutoff,
            "native source original cutoff expired"
        );
        binding.validate()?;
        binding
            .sources
            .sort_by(|a, b| (&a.kind, &a.resource_id).cmp(&(&b.kind, &b.resource_id)));
        let path = std::fs::canonicalize(path)?;
        let mut c = open_runtime_connection(&path)?;
        let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id=?1)",
            [&binding.session_id],
            |r| r.get(0),
        )?;
        anyhow::ensure!(!exists, "intended CREATE session already exists");
        for s in &binding.sources {
            if s.kind == SourceKind::Session {
                if s.resource_id == binding.session_id {
                    anyhow::ensure!(
                        s.revision == 0,
                        "intended session identity previously existed"
                    );
                } else {
                    let exists: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id=?1)",
                        [&s.resource_id],
                        |r| r.get(0),
                    )?;
                    anyhow::ensure!(exists, "missing selected session source");
                }
            }
            if s.kind != SourceKind::Session {
                let (table, key) = match s.kind {
                    SourceKind::Project => ("projects", "project_id"),
                    SourceKind::Model => ("model_configurations", "config_id"),
                    SourceKind::Session => unreachable!(),
                };
                let exists: bool = tx.query_row(
                    &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE {key}=?1)"),
                    [&s.resource_id],
                    |r| r.get(0),
                )?;
                anyhow::ensure!(exists && s.revision > 0, "missing selected native source");
            }
            anyhow::ensure!(
                source_revision(&tx, s.kind.clone(), &s.resource_id)? == s.revision,
                "native source changed before reservation"
            );
        }
        tx.execute("INSERT INTO native_source_reservations(operation_id,binding_json,source_id,source_generation,session_id,state) VALUES(?1,?2,?3,?4,?5,'pending')",
            params![binding.operation_id.to_string(),serde_json::to_string(&binding)?,binding.source_id.to_string(),binding.source_generation,binding.session_id])?;
        for s in &binding.sources {
            tx.execute(
                "INSERT INTO native_source_slots VALUES(?1,?2,?3,?4)",
                params![
                    s.kind.key(),
                    s.resource_id,
                    binding.operation_id.to_string(),
                    s.revision
                ],
            )?;
        }
        tx.commit()?;
        Ok(Self {
            state: Arc::new(SourceState {
                path,
                binding,
                process: std::process::id(),
                cutoff: original_cutoff,
                denied: AtomicBool::new(false),
                prepared_snapshot: std::sync::OnceLock::new(),
            }),
        })
    }
}
impl SourceState {
    /// Bounded original-memory digest, not reconstruction from durable readback.
    pub(crate) fn prepared_snapshot_sha256(&self) -> Result<[u8; 32]> {
        self.check_denial()?;
        self.binding
            .creation_snapshot_sha256
            .or_else(|| self.prepared_snapshot.get().copied())
            .ok_or_else(|| anyhow!("actual protected snapshot not bound"))
    }
    fn check(&self, c: &Connection, expected_state: &str) -> Result<()> {
        anyhow::ensure!(
            self.process == std::process::id(),
            "native source process changed"
        );
        let (json, state): (String, String) = c.query_row(
            "SELECT binding_json,state FROM native_source_reservations WHERE operation_id=?1",
            [self.binding.operation_id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        anyhow::ensure!(
            json == serde_json::to_string(&self.binding)? && state == expected_state,
            "native source owner unavailable"
        );
        let count: i64 = c.query_row(
            "SELECT COUNT(*) FROM native_source_slots WHERE operation_id=?1",
            [self.binding.operation_id.to_string()],
            |r| r.get(0),
        )?;
        anyhow::ensure!(
            count as usize == self.binding.sources.len(),
            "native source slots changed"
        );
        for s in &self.binding.sources {
            anyhow::ensure!(source_revision(c,s.kind.clone(),&s.resource_id)? == c.query_row(
                "SELECT revision FROM native_source_slots WHERE kind=?1 AND resource_id=?2 AND operation_id=?3",
                params![s.kind.key(),s.resource_id,self.binding.operation_id.to_string()],|r|r.get::<_,i64>(0))?, "reserved native source revision changed");
        }
        prepared_snapshot::check_persisted(self, c)?;
        Ok(())
    }

    fn check_current_local(&self) -> Result<()> {
        let result = (|| {
            self.check_denial()?;
            let c = open_runtime_connection(&self.path)?;
            let state: String = c.query_row(
                "SELECT state FROM native_source_reservations WHERE operation_id=?1",
                [self.binding.operation_id.to_string()],
                |r| r.get(0),
            )?;
            anyhow::ensure!(
                state == "pending" || state == "preparing" || state == "prepared",
                "native source no longer current"
            );
            self.check(&c, &state)
        })();
        if result.is_err() {
            self.deny();
        }
        result
    }
    /// In-memory observation only, safe inside existing Core locks/transactions.
    pub(crate) fn check_denial(&self) -> Result<()> {
        anyhow::ensure!(
            !self.denied.load(Ordering::Acquire)
                && self.process == std::process::id()
                && Instant::now() < self.cutoff,
            "native source owner denied"
        );
        Ok(())
    }
    pub(crate) fn deny(&self) {
        self.denied.store(true, Ordering::Release);
    }
    pub(crate) fn original_cutoff(&self) -> Instant {
        self.cutoff
    }
    pub(crate) fn original_process_is_current(&self) -> bool {
        self.process == std::process::id()
    }
    pub(crate) fn check_recorded_prepared(&self, c: &Connection) -> Result<()> {
        anyhow::ensure!(
            self.original_process_is_current(),
            "CREATE original process changed"
        );
        self.check(c, "prepared")
    }
    pub(crate) fn bound_store_path(&self) -> &Path {
        &self.path
    }
    pub(crate) fn binding(&self) -> &NativeSourceBinding {
        &self.binding
    }
    fn begin_preparation_local(&self) -> Result<()> {
        self.check_current_local()?;
        let mut c = open_runtime_connection(&self.path)?;
        let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        self.check(&tx, "pending")?;
        self.check_denial()?;
        tx.execute(
            "UPDATE native_source_reservations SET state='preparing' WHERE operation_id=?1",
            [self.binding.operation_id.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Only before preparation is ever admitted. Drop never calls this; pending
    /// and uncertain outcomes remain durable across process/caller loss.
    fn release_known_no_start_local(&self) -> Result<()> {
        let mut c = open_runtime_connection(&self.path)?;
        let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        self.check(&tx, "pending")?;
        tx.execute(
            "DELETE FROM native_source_slots WHERE operation_id=?1",
            [self.binding.operation_id.to_string()],
        )?;
        tx.execute(
            "UPDATE native_source_reservations SET state='no_start' WHERE operation_id=?1",
            [self.binding.operation_id.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn mark_uncertain_local(&self) -> Result<()> {
        self.deny();
        let mut c = open_runtime_connection(&self.path)?;
        let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let state: String = tx.query_row(
            "SELECT state FROM native_source_reservations WHERE operation_id=?1",
            [self.binding.operation_id.to_string()],
            |r| r.get(0),
        )?;
        anyhow::ensure!(
            state == "preparing" || state == "prepared",
            "native source not admitted"
        );
        self.check(&tx, &state)?;
        tx.execute(
            "UPDATE native_source_reservations SET state='uncertain' WHERE operation_id=?1",
            [self.binding.operation_id.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Typed existing creation writer only. Exemptions exist solely inside a
    /// nested savepoint and are restored before returning to the commit owner.
    /// No callback, arbitrary SQL, new runtime builder or release is accepted.
    pub(crate) fn insert_creation(
        &self,
        tx: &Transaction<'_>,
        path: &Path,
        snapshot: &crate::sessions::SessionSnapshot,
    ) -> Result<()> {
        anyhow::ensure!(
            std::fs::canonicalize(path)? == self.path
                && tx.path().is_some_and(|p| Path::new(p) == self.path)
                && snapshot.session_id == self.binding.session_id
                && snapshot.project_id == self.binding.project_id
                && creation_snapshot_sha256(snapshot)? == self.prepared_snapshot_sha256()?,
            "native source creation scope mismatch"
        );
        anyhow::ensure!(
            !self.denied.load(Ordering::Acquire) && Instant::now() < self.cutoff,
            "native source owner denied"
        );
        self.check(tx, "preparing")?;
        tx.execute_batch("SAVEPOINT native_owned_creation")?;
        let result = (|| {
            tx.execute(
                "DELETE FROM native_source_slots WHERE operation_id=?1",
                [self.binding.operation_id.to_string()],
            )?;
            crate::sessions::insert_new_session_in_transaction(tx, path, snapshot)?;
            for s in &self.binding.sources {
                let revision = source_revision(tx, s.kind.clone(), &s.resource_id)?;
                tx.execute(
                    "INSERT INTO native_source_slots VALUES(?1,?2,?3,?4)",
                    params![
                        s.kind.key(),
                        s.resource_id,
                        self.binding.operation_id.to_string(),
                        revision
                    ],
                )?;
            }
            tx.execute(
                "UPDATE native_source_reservations SET state='prepared' WHERE operation_id=?1",
                [self.binding.operation_id.to_string()],
            )?;
            self.check_denial()?;
            Ok::<_, anyhow::Error>(())
        })();
        match result {
            Ok(()) => {
                tx.execute_batch("RELEASE native_owned_creation")?;
                Ok(())
            }
            Err(error) => {
                tx.execute_batch(
                    "ROLLBACK TO native_owned_creation; RELEASE native_owned_creation",
                )?;
                Err(error)
            }
        }
    }
}

pub(crate) fn creation_snapshot_sha256(
    snapshot: &crate::sessions::SessionSnapshot,
) -> Result<[u8; 32]> {
    use sha2::{Digest, Sha256};
    let value = serde_json::json!({
        "session":snapshot.session_id,"project":snapshot.project_id,
        "behavior":snapshot.behavior.as_str(),"cwd":snapshot.cwd,
        "model":snapshot.model,"endpoint":snapshot.base_url,
        "insecure":snapshot.allow_insecure_http,"backend":snapshot.backend.as_str(),
        "effort":snapshot.reasoning_effort,"sandbox":snapshot.sandbox_spec.as_ref().map(crate::sessions::serialize_source_sandbox).transpose()?,
        "ssh":snapshot.ssh.as_ref().map(|s|(&s.host,s.port,&s.identity_file)),
        "credential_selector":snapshot.api_key_env,"headers":snapshot.extra_headers,
        "light":snapshot.light_model,"threshold":snapshot.orchestrator_compaction_threshold,
        "version":snapshot.config_version,"initial_messages":snapshot.messages
    });
    Ok(Sha256::digest(serde_json::to_vec(&value)?).into())
}

/// Historical fixtures reconstruct schemas before38 by dropping columns that
/// cannot coexist with38's actual source-field triggers. Never a runtime path.
#[cfg(test)]
pub(crate) fn remove_schema_for_legacy_fixture(c: &Connection) -> Result<()> {
    let mut stmt = c.prepare(
        "SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'native_source_%'",
    )?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    for name in names {
        c.execute_batch(&format!("DROP TRIGGER {name}"))?;
    }
    c.execute_batch("DROP TABLE IF EXISTS native_source_prepared_snapshots; DROP TABLE native_source_slots; DROP TABLE native_source_reservations; DROP TABLE native_source_revisions;")?;
    Ok(())
}

#[cfg(test)]
#[path = "native_source_reservation_tests.rs"]
mod tests;
