//! Ownership-closure calculation for the direct-only retirement migration.

use super::*;
use std::collections::{BTreeMap, BTreeSet};

pub(super) struct RetirementLeases {
    _process: Option<crate::sessions::StoreProcessLease>,
    _host: crate::sessions::HostMaintenanceLease,
    _relationships: Vec<crate::sessions::SessionRelationshipLease>,
    _operations: Vec<crate::sessions::SessionOperationLease>,
    _resources: Vec<crate::sessions::SessionResourceMutationLease>,
}

/// Acquire without waiting: a prior owner must drain using its compatible
/// binary rather than have its authority erased by the schema upgrade.
pub(super) fn acquire_retirement_leases(
    path: &Path,
    sessions: &BTreeSet<String>,
) -> Result<RetirementLeases> {
    let context = || {
        "retirement could not exclude a prior owner; drain using a compatible prior NAC binary, or explicitly reset a disposable store"
    };
    let process = if crate::store::coordinator::is_execution_store(path) {
        // The executor holds its process lease through the queued command.
        None
    } else {
        Some(
            crate::sessions::StoreProcessLease::try_acquire(path)
                .map_err(|error| anyhow!("{}: {error}", context()))?,
        )
    };
    let host = crate::sessions::HostMaintenanceLease::try_acquire(path)
        .map_err(|error| anyhow!("{}: {error}", context()))?;
    let mut relationships = Vec::new();
    let mut operations = Vec::new();
    let mut resources = Vec::new();
    for id in sessions {
        relationships.push(
            crate::sessions::SessionRelationshipLease::try_acquire(path, id)
                .map_err(|error| anyhow!("{}: {error}", context()))?,
        );
        operations.push(
            crate::sessions::SessionOperationLease::try_acquire(path, id)
                .map_err(|error| anyhow!("{}: {error}", context()))?,
        );
        resources.push(
            crate::sessions::SessionResourceMutationLease::try_acquire(path, id)
                .map_err(|error| anyhow!("{}: {error}", context()))?,
        );
    }
    Ok(RetirementLeases {
        _process: process,
        _host: host,
        _relationships: relationships,
        _operations: operations,
        _resources: resources,
    })
}

/// Compute the complete owned set before deleting any relationship rows.
/// Fork and task provenance are deliberately not ownership edges.
pub(super) fn doomed_sessions(conn: &Connection) -> Result<BTreeSet<String>> {
    let mut sessions = BTreeMap::new();
    let mut statement = conn.prepare("SELECT session_id, behavior FROM sessions")?;
    for row in statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (id, behavior) = row?;
        if !matches!(
            behavior.as_str(),
            "direct" | "orchestrator" | "direct-with-orchestrator"
        ) {
            anyhow::bail!("unsupported stored session behavior '{behavior}' for {id}");
        }
        sessions.insert(id, behavior);
    }

    let mut owners: BTreeMap<String, String> = BTreeMap::new();
    let mut roots: BTreeMap<String, String> = BTreeMap::new();
    for (sql, managed) in [
        ("SELECT child_session_id, parent_session_id, root_session_id FROM traditional_children", false),
        ("SELECT orchestrator_session_id, parent_session_id, root_session_id FROM managed_orchestrators", true),
    ] {
        let mut statement = conn.prepare(sql)?;
        for row in statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })? {
            let (child, parent, root) = row?;
            if !sessions.contains_key(&child) || !sessions.contains_key(&parent) || !sessions.contains_key(&root) {
                anyhow::bail!("retirement ownership references a missing session");
            }
            if (managed && (sessions[&child] != "orchestrator" || sessions[&parent] != "direct-with-orchestrator"))
                || (!managed && sessions[&child] != "direct") {
                anyhow::bail!("session {child} has contradictory ownership behavior");
            }
            if owners.insert(child.clone(), parent).is_some() {
                anyhow::bail!("session {child} has contradictory ownership");
            }
            roots.insert(child, root);
        }
    }

    // Walk toward the root per node: this both detects cycles, including cycles
    // outside the doomed set, and includes direct descendants at any depth.
    let mut doomed = BTreeSet::new();
    for id in sessions.keys() {
        let mut seen = BTreeSet::new();
        let mut cursor = id.as_str();
        let mut retired = false;
        loop {
            if !seen.insert(cursor) {
                anyhow::bail!("cyclic session ownership involving {cursor}");
            }
            retired |= sessions[cursor] != "direct";
            match owners.get(cursor) {
                Some(parent) => cursor = parent,
                None => break,
            }
        }
        if let Some(root) = roots.get(id) {
            if root == id || root != cursor {
                anyhow::bail!("session {id} has a contradictory ownership root");
            }
        }
        if retired {
            doomed.insert(id.clone());
        }
    }
    Ok(doomed)
}

/// Persisted container bindings and remote-terminal receipts are cleanup
/// authority, not evidence that a stopped process has already been cleaned up.
pub(super) fn ensure_resources_drained(conn: &Connection, doomed: &BTreeSet<String>) -> Result<()> {
    for id in doomed {
        let unresolved: bool = conn.query_row(
            "SELECT sandbox_json IS NOT NULL OR EXISTS (
                SELECT 1 FROM terminal_remote_cleanups WHERE session_id = sessions.session_id
             ) FROM sessions WHERE session_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if unresolved {
            anyhow::bail!(
                "retired session {id} has unresolved resource cleanup; drain it using a compatible prior NAC binary, or explicitly reset a disposable store"
            );
        }
    }
    Ok(())
}

/// This is a data-only purge. Session-owned FK rows cascade; older orchestration
/// tables predate those FKs and must be removed in their existing dependency order.
pub(super) fn purge_owned_rows(conn: &Connection, doomed: &BTreeSet<String>) -> Result<()> {
    for id in doomed {
        for sql in [
            "DELETE FROM episodes WHERE session_id = ?1",
            "DELETE FROM workset_items WHERE session_id = ?1",
            "DELETE FROM threads WHERE session_id = ?1",
            "DELETE FROM worksets WHERE session_id = ?1",
            "DELETE FROM sessions WHERE session_id = ?1",
        ] {
            conn.execute(sql, [id])?;
        }
    }
    Ok(())
}

pub(super) fn all_session_ids(conn: &Connection) -> Result<BTreeSet<String>> {
    let mut statement = conn.prepare("SELECT session_id FROM sessions")?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

#[cfg(test)]
#[path = "retirement_tests.rs"]
mod tests;
