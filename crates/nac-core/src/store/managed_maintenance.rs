//! Durable host maintenance, blocker aggregation, and control-attempt replay.

use super::*;
use rusqlite::TransactionBehavior;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const ASSERTION_CLOCK_SKEW_SECONDS: i64 = 5;
const INCOMPLETE_ATTEMPT_RETENTION_SECONDS: i64 = 300;
const MAX_CONTROL_OPERATIONS: i64 = 10_000;
const MAX_CONTROL_ATTEMPTS: i64 = 10_000;
const CONTROL_ATTEMPT_LOCK_STRIPES: u8 = 64;
const PRE_CONTROL_SCHEMA_VERSION: i64 = 24;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ManagedMaintenanceState {
    Serving,
    Maintenance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ManagedUpgradeTarget {
    pub release_id: String,
    pub source_sha: String,
    pub product_version: String,
    pub schema_version: i64,
    pub minimum_schema_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ManagedAcceptedIdentity {
    pub managed_host_id: String,
    pub host_incarnation_id: String,
    pub operation_id: String,
    pub target: ManagedUpgradeTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedStartupPreflight {
    pub accepted_identity: Option<ManagedAcceptedIdentity>,
    pub requires_accept: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ManagedOperationBinding {
    pub managed_host_id: String,
    pub host_incarnation_id: String,
    pub issuer: String,
    pub audience: String,
    /// The controller issuer is also the operation's origin authority. It is
    /// stored separately so a future distinct-origin contract cannot silently
    /// reinterpret an existing operation.
    pub authority_origin: String,
    pub operation_id: String,
    pub target: ManagedUpgradeTarget,
    pub actor: String,
    pub beneficiary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedUpgradeSupersession {
    pub previous_operation_id: String,
    pub previous_target: ManagedUpgradeTarget,
    pub operation: ManagedOperationBinding,
    /// One-time controller-authorized adoption of a pre-control release. This
    /// is accepted only for the untouched serving ledger and is never exposed
    /// by the live private control endpoint.
    pub adopt_unbound_previous: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedControlAttemptAction {
    Status,
    Prepare,
    Retry,
    Supersede,
}

#[derive(Serialize)]
struct ManagedControlAttemptBinding<'a> {
    action: ManagedControlAttemptAction,
    operation: &'a ManagedOperationBinding,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_operation_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_target: Option<&'a ManagedUpgradeTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ManagedBlockerKind {
    ActiveRun,
    Compaction,
    TraditionalChild,
    ManagedOrchestrator,
    TerminalProcess,
    CloneOperation,
    WorkspaceMutation,
    OperationLease,
    ResourceLease,
    MaintenanceOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ManagedUpgradeBlocker {
    pub kind: ManagedBlockerKind,
    pub id: String,
    pub session_id: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ManagedMaintenanceSnapshot {
    pub state: ManagedMaintenanceState,
    pub operation_id: Option<String>,
    pub target: Option<ManagedUpgradeTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_identity: Option<ManagedAcceptedIdentity>,
    pub prepared_at: Option<String>,
    pub version: u64,
    pub blockers: Vec<ManagedUpgradeBlocker>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "result", rename_all = "snake_case")]
#[expect(
    clippy::large_enum_variant,
    reason = "this serialized control response stays allocation-free and preserves the public schema"
)]
pub enum ManagedPrepareOutcome {
    Blocked {
        blockers: Vec<ManagedUpgradeBlocker>,
    },
    SafeToStop {
        snapshot: ManagedMaintenanceSnapshot,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum ManagedSupersedeOutcome {
    Superseded {
        snapshot: ManagedMaintenanceSnapshot,
    },
}

#[derive(Debug)]
pub enum ManagedMaintenanceError {
    OperationBindingConflict,
    ReplayConflict,
    MaintenanceConflict,
    IncompatibleTarget,
    OperationCapacity,
    AttemptCapacity,
    Store(anyhow::Error),
}

pub struct ManagedWorkAdmission {
    _lease: crate::sessions::HostAdmissionLease,
}

/// Acquire shared host admission and check maintenance while it is held. The
/// exclusive prepare lease cannot cross this check-to-durable-start window.
pub fn try_admit_managed_work(path: &Path) -> Result<ManagedWorkAdmission> {
    let lease =
        crate::sessions::HostAdmissionLease::try_acquire(path).map_err(|error| anyhow!(error))?;
    let snapshot = managed_maintenance_snapshot(path)?;
    if snapshot.state == ManagedMaintenanceState::Maintenance {
        return Err(anyhow!("managed host is in maintenance"));
    }
    Ok(ManagedWorkAdmission { _lease: lease })
}

/// Managed-server admission additionally fences the serving release and host
/// incarnation once a forward replacement has been accepted.
pub fn try_admit_managed_work_for_identity(
    path: &Path,
    running: &ManagedAcceptedIdentity,
) -> Result<ManagedWorkAdmission> {
    let lease =
        crate::sessions::HostAdmissionLease::try_acquire(path).map_err(|error| anyhow!(error))?;
    let snapshot = managed_maintenance_snapshot(path)?;
    if snapshot.state == ManagedMaintenanceState::Maintenance {
        return Err(anyhow!("managed host is in maintenance"));
    }
    validate_accepted_identity(&snapshot, running)?;
    Ok(ManagedWorkAdmission { _lease: lease })
}

/// Retain shared host authority for a maintenance-time completion request.
/// Completion remains available while the ledger is in maintenance, but a
/// process whose accepted release identity is stale cannot mutate the store
/// after a replacement begins serving.
pub fn try_admit_managed_completion_for_identity(
    path: &Path,
    running: &ManagedAcceptedIdentity,
) -> Result<ManagedWorkAdmission> {
    let lease =
        crate::sessions::HostAdmissionLease::try_acquire(path).map_err(|error| anyhow!(error))?;
    let snapshot = managed_maintenance_snapshot(path)?;
    validate_accepted_identity(&snapshot, running)?;
    Ok(ManagedWorkAdmission { _lease: lease })
}

/// Version-1 managed hosts have no immutable release identity, but completion
/// requests still retain shared admission authority through their mutation.
pub fn try_admit_managed_completion(path: &Path) -> Result<ManagedWorkAdmission> {
    let lease =
        crate::sessions::HostAdmissionLease::try_acquire(path).map_err(|error| anyhow!(error))?;
    Ok(ManagedWorkAdmission { _lease: lease })
}

fn validate_accepted_identity(
    snapshot: &ManagedMaintenanceSnapshot,
    running: &ManagedAcceptedIdentity,
) -> Result<()> {
    if snapshot
        .accepted_identity
        .as_ref()
        .is_some_and(|accepted| accepted != running)
    {
        anyhow::bail!("managed host release identity is stale");
    }
    Ok(())
}

impl std::fmt::Display for ManagedMaintenanceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OperationBindingConflict => formatter
                .write_str("managed operation binding conflicts with its durable operation id"),
            Self::ReplayConflict => formatter.write_str(
                "managed control assertion replay conflicts with its original operation",
            ),
            Self::MaintenanceConflict => {
                formatter.write_str("managed maintenance belongs to another upgrade operation")
            }
            Self::IncompatibleTarget => {
                formatter.write_str("managed upgrade target is not forward-compatible")
            }
            Self::OperationCapacity => {
                formatter.write_str("managed control operation retention capacity has been reached")
            }
            Self::AttemptCapacity => {
                formatter.write_str("managed control attempt retention capacity has been reached")
            }
            Self::Store(_) => formatter.write_str("managed maintenance store operation failed"),
        }
    }
}

impl std::error::Error for ManagedMaintenanceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Store(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}

impl From<anyhow::Error> for ManagedMaintenanceError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

pub fn managed_maintenance_snapshot(path: &Path) -> Result<ManagedMaintenanceSnapshot> {
    let conn = open_runtime_connection(path)?;
    let mut snapshot = snapshot_with_connection(&conn, durable_blockers(&conn)?)?;
    append_maintenance_blocker(&mut snapshot);
    Ok(snapshot)
}

/// Validate an accepted maintenance target without initializing or migrating
/// the store. This must run before startup opens the database through the
/// ordinary schema path, so an unaccepted replacement cannot mutate it.
pub fn preflight_managed_forward_start(
    path: &Path,
    running: &ManagedUpgradeTarget,
    configured_host: Option<(&str, &str)>,
    startup_supersession: Option<&ManagedUpgradeSupersession>,
) -> std::result::Result<ManagedStartupPreflight, ManagedMaintenanceError> {
    let empty = || ManagedStartupPreflight {
        accepted_identity: None,
        requires_accept: false,
    };
    if !path.exists() {
        if startup_supersession.is_some() {
            return Err(ManagedMaintenanceError::MaintenanceConflict);
        }
        return Ok(empty());
    }
    if let Some(store_version) = super::schema::preflight_schema_version(path)? {
        if store_version > running.schema_version || store_version < running.minimum_schema_version
        {
            return Err(ManagedMaintenanceError::IncompatibleTarget);
        }
    }
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(anyhow::Error::new)?;
    let store_version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(anyhow::Error::new)?;
    if store_version > running.schema_version || store_version < running.minimum_schema_version {
        return Err(ManagedMaintenanceError::IncompatibleTarget);
    }
    let managed_control_object_count = managed_control_schema_object_count(&conn)?;
    if managed_control_object_count != 0 && managed_control_object_count != 4 {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    }
    let has_ledger = managed_control_object_count == 4;
    if !has_ledger {
        let Some(supersession) = startup_supersession else {
            return Ok(empty());
        };
        if !supersession.adopt_unbound_previous || store_version != PRE_CONTROL_SCHEMA_VERSION {
            return Err(ManagedMaintenanceError::MaintenanceConflict);
        }
        drop(conn);
        let accepted = supersede_managed_upgrade_at_startup(
            path,
            supersession,
            store_version,
            configured_host,
            true,
        )?;
        validate_running_identity(&accepted, running, configured_host)?;
        return Ok(ManagedStartupPreflight {
            accepted_identity: Some(accepted),
            requires_accept: true,
        });
    }
    let has_accepted_identity: bool = conn
        .query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM pragma_table_info('managed_host_maintenance')
                 WHERE name = 'accepted_identity_json'
             )",
            [],
            |row| row.get(0),
        )
        .map_err(anyhow::Error::new)?;
    let query = if has_accepted_identity {
        "SELECT state, operation_id, target_json, accepted_identity_json
         FROM managed_host_maintenance WHERE singleton = 1"
    } else {
        "SELECT state, operation_id, target_json, NULL
         FROM managed_host_maintenance WHERE singleton = 1"
    };
    let row = conn
        .query_row(query, [], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .optional()
        .map_err(anyhow::Error::new)?;
    let Some((state, operation_id, target_json, accepted_identity_json)) = row else {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    };
    if state == "serving" {
        let Some(json) = accepted_identity_json else {
            let Some(supersession) = startup_supersession else {
                return Ok(empty());
            };
            if !supersession.adopt_unbound_previous {
                return Err(ManagedMaintenanceError::MaintenanceConflict);
            }
            drop(conn);
            let accepted = supersede_managed_upgrade_at_startup(
                path,
                supersession,
                store_version,
                configured_host,
                false,
            )?;
            validate_running_identity(&accepted, running, configured_host)?;
            return Ok(ManagedStartupPreflight {
                accepted_identity: Some(accepted),
                requires_accept: true,
            });
        };
        let accepted: ManagedAcceptedIdentity =
            serde_json::from_str(&json).map_err(anyhow::Error::new)?;
        if validate_running_identity(&accepted, running, configured_host).is_err() {
            drop(conn);
            let supersession =
                startup_supersession.ok_or(ManagedMaintenanceError::MaintenanceConflict)?;
            let accepted = supersede_managed_upgrade_at_startup(
                path,
                supersession,
                store_version,
                configured_host,
                false,
            )?;
            validate_running_identity(&accepted, running, configured_host)?;
            return Ok(ManagedStartupPreflight {
                accepted_identity: Some(accepted),
                requires_accept: true,
            });
        }
        return Ok(ManagedStartupPreflight {
            accepted_identity: Some(accepted),
            requires_accept: false,
        });
    }
    if state != "maintenance" {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    }
    let target = target_json
        .ok_or(ManagedMaintenanceError::MaintenanceConflict)
        .and_then(|json| {
            serde_json::from_str::<ManagedUpgradeTarget>(&json)
                .map_err(anyhow::Error::new)
                .map_err(ManagedMaintenanceError::Store)
        })?;
    let operation_id = operation_id.ok_or(ManagedMaintenanceError::MaintenanceConflict)?;
    let binding_json = conn
        .query_row(
            "SELECT binding_json FROM managed_control_operations WHERE operation_id = ?1",
            params![operation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(anyhow::Error::new)?
        .ok_or(ManagedMaintenanceError::MaintenanceConflict)?;
    let binding: ManagedOperationBinding =
        serde_json::from_str(&binding_json).map_err(anyhow::Error::new)?;
    if binding.operation_id != operation_id || binding.target != target {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    }
    let accepted = ManagedAcceptedIdentity {
        managed_host_id: binding.managed_host_id,
        host_incarnation_id: binding.host_incarnation_id,
        operation_id: binding.operation_id,
        target: binding.target,
    };
    if validate_running_identity(&accepted, running, configured_host).is_err() {
        drop(conn);
        let supersession =
            startup_supersession.ok_or(ManagedMaintenanceError::MaintenanceConflict)?;
        let accepted = supersede_managed_upgrade_at_startup(
            path,
            supersession,
            store_version,
            configured_host,
            false,
        )?;
        validate_running_identity(&accepted, running, configured_host)?;
        return Ok(ManagedStartupPreflight {
            accepted_identity: Some(accepted),
            requires_accept: true,
        });
    }
    Ok(ManagedStartupPreflight {
        accepted_identity: Some(accepted),
        requires_accept: true,
    })
}

fn validate_running_identity(
    accepted: &ManagedAcceptedIdentity,
    running: &ManagedUpgradeTarget,
    configured_host: Option<(&str, &str)>,
) -> std::result::Result<(), ManagedMaintenanceError> {
    let Some((managed_host_id, host_incarnation_id)) = configured_host else {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    };
    if accepted.target != *running
        || running.schema_version != schema_version()
        || accepted.managed_host_id != managed_host_id
        || accepted.host_incarnation_id != host_incarnation_id
    {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    }
    Ok(())
}

fn burn_control_attempt(
    path: &Path,
    jti: &str,
    binding: &ManagedOperationBinding,
    operation_binding_json: &str,
    attempt_binding_json: &str,
    expires_at: i64,
    expected_identity: Option<&ManagedAcceptedIdentity>,
) -> std::result::Result<Option<String>, ManagedMaintenanceError> {
    let mut conn = open_runtime_connection(path).map_err(ManagedMaintenanceError::Store)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(anyhow::Error::new)?;
    if let Some(expected) = expected_identity {
        let snapshot = snapshot_with_connection(&transaction, Vec::new())
            .map_err(ManagedMaintenanceError::Store)?;
        if validate_accepted_identity(&snapshot, expected).is_err() {
            return Err(ManagedMaintenanceError::MaintenanceConflict);
        }
    }
    let now_epoch = current_epoch_seconds()?;
    transaction
        .execute(
            "DELETE FROM managed_control_attempts
         WHERE (outcome_json IS NOT NULL AND expires_at + ?1 < ?3)
            OR (outcome_json IS NULL AND expires_at + ?2 < ?3)",
            params![
                ASSERTION_CLOCK_SKEW_SECONDS,
                INCOMPLETE_ATTEMPT_RETENTION_SECONDS,
                now_epoch
            ],
        )
        .map_err(anyhow::Error::new)?;
    if let Some(outcome) = attempt_outcome(&transaction, jti, binding, attempt_binding_json)? {
        transaction.commit().map_err(anyhow::Error::new)?;
        return Ok(Some(outcome));
    }
    let attempt_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM managed_control_attempts WHERE jti = ?1)",
            params![jti],
            |row| row.get(0),
        )
        .map_err(anyhow::Error::new)?;
    if attempt_exists {
        transaction.commit().map_err(anyhow::Error::new)?;
        return Ok(None);
    }
    let attempt_count = transaction
        .query_row("SELECT COUNT(*) FROM managed_control_attempts", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(anyhow::Error::new)?;
    if !attempt_capacity_available(attempt_count) {
        return Err(ManagedMaintenanceError::AttemptCapacity);
    }
    let now = now_utc();
    match transaction
        .query_row(
            "SELECT binding_json FROM managed_control_operations WHERE operation_id = ?1",
            params![binding.operation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(anyhow::Error::new)?
    {
        Some(stored) if stored != operation_binding_json => {
            return Err(ManagedMaintenanceError::OperationBindingConflict)
        }
        Some(_) => {}
        None => {
            let operation_count = transaction
                .query_row(
                    "SELECT COUNT(*) FROM managed_control_operations",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(anyhow::Error::new)?;
            if !operation_capacity_available(operation_count) {
                return Err(ManagedMaintenanceError::OperationCapacity);
            }
            transaction
                .execute(
                    "INSERT INTO managed_control_operations
                         (operation_id, binding_json, latest_outcome_json, created_at, updated_at)
                     VALUES (?1, ?2, '{}', ?3, ?3)",
                    params![binding.operation_id, operation_binding_json, now],
                )
                .map_err(anyhow::Error::new)?;
        }
    }
    transaction
        .execute(
            "INSERT INTO managed_control_attempts
                 (jti, operation_id, binding_json, outcome_json, expires_at, created_at)
             VALUES (?1, ?2, ?3, NULL, ?4, ?5)",
            params![
                jti,
                binding.operation_id,
                attempt_binding_json,
                expires_at,
                now
            ],
        )
        .map_err(anyhow::Error::new)?;
    transaction.commit().map_err(anyhow::Error::new)?;
    Ok(None)
}

fn operation_capacity_available(operation_count: i64) -> bool {
    operation_count < MAX_CONTROL_OPERATIONS
}

fn attempt_capacity_available(attempt_count: i64) -> bool {
    attempt_count < MAX_CONTROL_ATTEMPTS
}

fn attempt_outcome(
    conn: &Connection,
    jti: &str,
    binding: &ManagedOperationBinding,
    binding_json: &str,
) -> std::result::Result<Option<String>, ManagedMaintenanceError> {
    let attempt = conn
        .query_row(
            "SELECT operation_id, binding_json, outcome_json
             FROM managed_control_attempts WHERE jti = ?1",
            params![jti],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(anyhow::Error::new)?;
    let Some((stored_operation, stored_binding, outcome)) = attempt else {
        return Ok(None);
    };
    if stored_operation != binding.operation_id || stored_binding != binding_json {
        return Err(ManagedMaintenanceError::ReplayConflict);
    }
    Ok(outcome)
}

pub fn record_managed_status(
    path: &Path,
    jti: &str,
    binding: &ManagedOperationBinding,
    expires_at: i64,
    mut process_blockers: Vec<ManagedUpgradeBlocker>,
) -> std::result::Result<ManagedMaintenanceSnapshot, ManagedMaintenanceError> {
    let _attempt_lease = acquire_control_attempt_lease(path, jti)?;
    let operation_binding_json = serde_json::to_string(binding).map_err(anyhow::Error::new)?;
    let attempt_binding_json = serde_json::to_string(&ManagedControlAttemptBinding {
        action: ManagedControlAttemptAction::Status,
        operation: binding,
        previous_operation_id: None,
        previous_target: None,
    })
    .map_err(anyhow::Error::new)?;
    if let Some(outcome) = burn_control_attempt(
        path,
        jti,
        binding,
        &operation_binding_json,
        &attempt_binding_json,
        expires_at,
        None,
    )? {
        return serde_json::from_str(&outcome)
            .map_err(anyhow::Error::new)
            .map_err(ManagedMaintenanceError::Store);
    }
    let mut conn = open_runtime_connection(path).map_err(ManagedMaintenanceError::Store)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(anyhow::Error::new)?;
    let now = now_utc();
    if let Some(outcome) = attempt_outcome(&transaction, jti, binding, &attempt_binding_json)? {
        return serde_json::from_str(&outcome)
            .map_err(anyhow::Error::new)
            .map_err(ManagedMaintenanceError::Store);
    }
    process_blockers
        .extend(durable_blockers(&transaction).map_err(ManagedMaintenanceError::Store)?);
    process_blockers.sort();
    process_blockers.dedup();
    let mut snapshot = snapshot_with_connection(&transaction, process_blockers)
        .map_err(ManagedMaintenanceError::Store)?;
    append_maintenance_blocker(&mut snapshot);
    let outcome = serde_json::to_string(&snapshot).map_err(anyhow::Error::new)?;
    transaction
        .execute(
            "UPDATE managed_control_attempts SET outcome_json = ?2 WHERE jti = ?1",
            params![jti, outcome],
        )
        .map_err(anyhow::Error::new)?;
    transaction
        .execute(
            "UPDATE managed_control_operations
             SET latest_outcome_json = ?2, updated_at = ?3, version = version + 1
             WHERE operation_id = ?1",
            params![binding.operation_id, outcome, now],
        )
        .map_err(anyhow::Error::new)?;
    transaction.commit().map_err(anyhow::Error::new)?;
    Ok(snapshot)
}

pub fn prepare_managed_upgrade(
    path: &Path,
    jti: &str,
    binding: &ManagedOperationBinding,
    action: ManagedControlAttemptAction,
    expires_at: i64,
    process_blockers: Vec<ManagedUpgradeBlocker>,
) -> std::result::Result<ManagedPrepareOutcome, ManagedMaintenanceError> {
    prepare_managed_upgrade_inner(
        path,
        jti,
        binding,
        action,
        expires_at,
        process_blockers,
        None,
    )
}

pub fn prepare_managed_upgrade_for_identity(
    path: &Path,
    jti: &str,
    binding: &ManagedOperationBinding,
    action: ManagedControlAttemptAction,
    expires_at: i64,
    process_blockers: Vec<ManagedUpgradeBlocker>,
    expected_identity: &ManagedAcceptedIdentity,
) -> std::result::Result<ManagedPrepareOutcome, ManagedMaintenanceError> {
    prepare_managed_upgrade_inner(
        path,
        jti,
        binding,
        action,
        expires_at,
        process_blockers,
        Some(expected_identity),
    )
}

fn prepare_managed_upgrade_inner(
    path: &Path,
    jti: &str,
    binding: &ManagedOperationBinding,
    action: ManagedControlAttemptAction,
    expires_at: i64,
    mut process_blockers: Vec<ManagedUpgradeBlocker>,
    expected_identity: Option<&ManagedAcceptedIdentity>,
) -> std::result::Result<ManagedPrepareOutcome, ManagedMaintenanceError> {
    let _attempt_lease = acquire_control_attempt_lease(path, jti)?;
    debug_assert!(
        matches!(
            action,
            ManagedControlAttemptAction::Prepare | ManagedControlAttemptAction::Retry
        ),
        "prepare accepts only prepare or retry attempt actions"
    );
    let operation_binding_json = serde_json::to_string(binding).map_err(anyhow::Error::new)?;
    let attempt_binding_json = serde_json::to_string(&ManagedControlAttemptBinding {
        action,
        operation: binding,
        previous_operation_id: None,
        previous_target: None,
    })
    .map_err(anyhow::Error::new)?;
    if let Some(outcome) = burn_control_attempt(
        path,
        jti,
        binding,
        &operation_binding_json,
        &attempt_binding_json,
        expires_at,
        expected_identity,
    )? {
        return serde_json::from_str(&outcome)
            .map_err(anyhow::Error::new)
            .map_err(ManagedMaintenanceError::Store);
    }
    let _host_maintenance = match crate::sessions::HostMaintenanceLease::try_acquire(path) {
        Ok(lease) => Some(lease),
        Err(crate::sessions::SessionOperationLeaseError::Busy(_)) => {
            process_blockers.push(ManagedUpgradeBlocker {
                kind: ManagedBlockerKind::OperationLease,
                id: "host-admission".to_string(),
                session_id: None,
                detail: "another process is admitting work".to_string(),
            });
            None
        }
        Err(error) => return Err(ManagedMaintenanceError::Store(anyhow!(error))),
    };
    if binding.target.schema_version < schema_version()
        || binding.target.minimum_schema_version > schema_version()
        || binding.target.minimum_schema_version > binding.target.schema_version
    {
        return Err(ManagedMaintenanceError::IncompatibleTarget);
    }
    let mut conn = open_runtime_connection(path).map_err(ManagedMaintenanceError::Store)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(anyhow::Error::new)?;

    if let Some(expected) = expected_identity {
        let snapshot = snapshot_with_connection(&transaction, Vec::new())
            .map_err(ManagedMaintenanceError::Store)?;
        if validate_accepted_identity(&snapshot, expected).is_err() {
            return Err(ManagedMaintenanceError::MaintenanceConflict);
        }
    }

    if let Some(outcome) = attempt_outcome(&transaction, jti, binding, &attempt_binding_json)? {
        return serde_json::from_str(&outcome)
            .map_err(anyhow::Error::new)
            .map_err(ManagedMaintenanceError::Store);
    }

    let now = now_utc();
    let current = snapshot_with_connection(&transaction, Vec::new())
        .map_err(ManagedMaintenanceError::Store)?;
    if current.state == ManagedMaintenanceState::Maintenance {
        if current.operation_id.as_deref() != Some(binding.operation_id.as_str())
            || current.target.as_ref() != Some(&binding.target)
        {
            let outcome = ManagedPrepareOutcome::Blocked {
                blockers: vec![ManagedUpgradeBlocker {
                    kind: ManagedBlockerKind::MaintenanceOperation,
                    id: current
                        .operation_id
                        .unwrap_or_else(|| "unknown-maintenance-operation".to_string()),
                    session_id: None,
                    detail: "host is committed to another maintenance operation".to_string(),
                }],
            };
            persist_outcome(&transaction, jti, binding, &outcome, &now)?;
            transaction.commit().map_err(anyhow::Error::new)?;
            return Ok(outcome);
        }
        let outcome = ManagedPrepareOutcome::SafeToStop { snapshot: current };
        persist_outcome(&transaction, jti, binding, &outcome, &now)?;
        transaction.commit().map_err(anyhow::Error::new)?;
        return Ok(outcome);
    }

    process_blockers
        .extend(durable_blockers(&transaction).map_err(ManagedMaintenanceError::Store)?);
    process_blockers.sort();
    process_blockers.dedup();
    let outcome = if process_blockers.is_empty() {
        let target_json = serde_json::to_string(&binding.target).map_err(anyhow::Error::new)?;
        transaction
            .execute(
                "UPDATE managed_host_maintenance
                 SET state = 'maintenance', operation_id = ?1, target_json = ?2,
                     prepared_at = ?3, version = version + 1
                 WHERE singleton = 1 AND state = 'serving'",
                params![binding.operation_id, target_json, now],
            )
            .map_err(anyhow::Error::new)?;
        ManagedPrepareOutcome::SafeToStop {
            snapshot: snapshot_with_connection(&transaction, Vec::new())
                .map_err(ManagedMaintenanceError::Store)?,
        }
    } else {
        ManagedPrepareOutcome::Blocked {
            blockers: process_blockers,
        }
    };
    persist_outcome(&transaction, jti, binding, &outcome, &now)?;
    transaction.commit().map_err(anyhow::Error::new)?;
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(anyhow::Error::new)?;
    Ok(outcome)
}

/// Authenticated recovery transition from a failed accepted target to an exact
/// corrected/newer target. This never leaves maintenance or changes the last
/// successfully accepted serving identity.
pub fn supersede_managed_upgrade_for_identity(
    path: &Path,
    jti: &str,
    supersession: &ManagedUpgradeSupersession,
    expires_at: i64,
    expected_identity: &ManagedAcceptedIdentity,
) -> std::result::Result<ManagedSupersedeOutcome, ManagedMaintenanceError> {
    let _attempt_lease = acquire_control_attempt_lease(path, jti)?;
    let binding = &supersession.operation;
    let operation_binding_json = serde_json::to_string(binding).map_err(anyhow::Error::new)?;
    let attempt_binding_json = serde_json::to_string(&ManagedControlAttemptBinding {
        action: ManagedControlAttemptAction::Supersede,
        operation: binding,
        previous_operation_id: Some(&supersession.previous_operation_id),
        previous_target: Some(&supersession.previous_target),
    })
    .map_err(anyhow::Error::new)?;
    if let Some(outcome) = burn_control_attempt(
        path,
        jti,
        binding,
        &operation_binding_json,
        &attempt_binding_json,
        expires_at,
        Some(expected_identity),
    )? {
        return serde_json::from_str(&outcome)
            .map_err(anyhow::Error::new)
            .map_err(ManagedMaintenanceError::Store);
    }
    let _host_maintenance = crate::sessions::HostMaintenanceLease::acquire(path)
        .map_err(|error| ManagedMaintenanceError::Store(anyhow!(error)))?;
    let mut conn = open_runtime_connection(path).map_err(ManagedMaintenanceError::Store)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(anyhow::Error::new)?;
    if let Some(outcome) = attempt_outcome(&transaction, jti, binding, &attempt_binding_json)? {
        return serde_json::from_str(&outcome)
            .map_err(anyhow::Error::new)
            .map_err(ManagedMaintenanceError::Store);
    }
    let snapshot = apply_supersession(&transaction, supersession, schema_version(), false)?;
    let outcome = ManagedSupersedeOutcome::Superseded { snapshot };
    let outcome_json = serde_json::to_string(&outcome).map_err(anyhow::Error::new)?;
    let now = now_utc();
    persist_serialized_outcome(&transaction, jti, binding, &outcome_json, &now)?;
    persist_superseded_tombstone(
        &transaction,
        &supersession.previous_operation_id,
        &outcome_json,
        &now,
    )?;
    transaction.commit().map_err(anyhow::Error::new)?;
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(anyhow::Error::new)?;
    Ok(outcome)
}

fn supersede_managed_upgrade_at_startup(
    path: &Path,
    supersession: &ManagedUpgradeSupersession,
    store_schema_version: i64,
    configured_host: Option<(&str, &str)>,
    bootstrap_unbound_ledger: bool,
) -> std::result::Result<ManagedAcceptedIdentity, ManagedMaintenanceError> {
    let Some((managed_host_id, host_incarnation_id)) = configured_host else {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    };
    if supersession.operation.managed_host_id != managed_host_id
        || supersession.operation.host_incarnation_id != host_incarnation_id
    {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    }
    let _host_maintenance = crate::sessions::HostMaintenanceLease::acquire(path)
        .map_err(|error| ManagedMaintenanceError::Store(anyhow!(error)))?;
    let mut conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(anyhow::Error::new)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(anyhow::Error::new)?;
    if bootstrap_unbound_ledger {
        let locked_store_version: i64 = transaction
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(anyhow::Error::new)?;
        if !supersession.adopt_unbound_previous
            || store_schema_version != PRE_CONTROL_SCHEMA_VERSION
            || locked_store_version != PRE_CONTROL_SCHEMA_VERSION
            || !managed_control_schema_absent(&transaction)?
        {
            return Err(ManagedMaintenanceError::MaintenanceConflict);
        }
        super::schema::create_managed_maintenance_tables(&transaction)
            .map_err(ManagedMaintenanceError::Store)?;
    }
    let snapshot = apply_supersession(&transaction, supersession, store_schema_version, true)?;
    let outcome = ManagedSupersedeOutcome::Superseded { snapshot };
    let outcome_json = serde_json::to_string(&outcome).map_err(anyhow::Error::new)?;
    let now = now_utc();
    persist_operation_outcome(
        &transaction,
        &supersession.operation.operation_id,
        &outcome_json,
        &now,
    )?;
    persist_superseded_tombstone(
        &transaction,
        &supersession.previous_operation_id,
        &outcome_json,
        &now,
    )?;
    transaction.commit().map_err(anyhow::Error::new)?;
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(anyhow::Error::new)?;
    Ok(ManagedAcceptedIdentity {
        managed_host_id: supersession.operation.managed_host_id.clone(),
        host_incarnation_id: supersession.operation.host_incarnation_id.clone(),
        operation_id: supersession.operation.operation_id.clone(),
        target: supersession.operation.target.clone(),
    })
}

fn managed_control_schema_absent(
    transaction: &rusqlite::Transaction<'_>,
) -> std::result::Result<bool, ManagedMaintenanceError> {
    Ok(managed_control_schema_object_count(transaction)? == 0)
}

fn managed_control_schema_object_count(
    conn: &Connection,
) -> std::result::Result<i64, ManagedMaintenanceError> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master
             WHERE name IN (
                 'managed_host_maintenance',
                 'managed_control_operations',
                 'managed_control_attempts',
                 'idx_managed_control_attempts_operation'
             )",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map_err(anyhow::Error::new)
    .map_err(ManagedMaintenanceError::Store)
}

fn apply_supersession(
    transaction: &rusqlite::Transaction<'_>,
    supersession: &ManagedUpgradeSupersession,
    store_schema_version: i64,
    allow_serving_prior: bool,
) -> std::result::Result<ManagedMaintenanceSnapshot, ManagedMaintenanceError> {
    validate_forward_supersession(supersession, store_schema_version)?;
    let current = snapshot_with_connection(transaction, Vec::new())
        .map_err(ManagedMaintenanceError::Store)?;
    let previous_binding_json = transaction
        .query_row(
            "SELECT binding_json FROM managed_control_operations WHERE operation_id = ?1",
            params![supersession.previous_operation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(anyhow::Error::new)?;
    let (previous_binding, adopted_unbound) = if supersession.adopt_unbound_previous {
        if previous_binding_json.is_some()
            || !allow_serving_prior
            || !virgin_managed_maintenance(transaction, &current)?
        {
            return Err(ManagedMaintenanceError::MaintenanceConflict);
        }
        let mut previous_binding = supersession.operation.clone();
        previous_binding.operation_id = supersession.previous_operation_id.clone();
        previous_binding.target = supersession.previous_target.clone();
        ensure_operation_binding(transaction, &previous_binding)?;
        (previous_binding, true)
    } else {
        let previous_binding_json =
            previous_binding_json.ok_or(ManagedMaintenanceError::MaintenanceConflict)?;
        let previous_binding: ManagedOperationBinding =
            serde_json::from_str(&previous_binding_json).map_err(anyhow::Error::new)?;
        if previous_binding.operation_id != supersession.previous_operation_id
            || previous_binding.target != supersession.previous_target
            || !same_operation_authority(&previous_binding, &supersession.operation)
        {
            return Err(ManagedMaintenanceError::OperationBindingConflict);
        }
        (previous_binding, false)
    };
    ensure_operation_binding(transaction, &supersession.operation)?;

    let exact_previous = match current.state {
        ManagedMaintenanceState::Maintenance => {
            current.operation_id.as_deref() == Some(supersession.previous_operation_id.as_str())
                && current.target.as_ref() == Some(&supersession.previous_target)
        }
        ManagedMaintenanceState::Serving if adopted_unbound => true,
        ManagedMaintenanceState::Serving if allow_serving_prior => {
            current.accepted_identity.as_ref().is_some_and(|accepted| {
                accepted.managed_host_id == previous_binding.managed_host_id
                    && accepted.host_incarnation_id == previous_binding.host_incarnation_id
                    && accepted.operation_id == supersession.previous_operation_id
                    && accepted.target == supersession.previous_target
            })
        }
        ManagedMaintenanceState::Serving => false,
    };
    if !exact_previous {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    }
    let target_json =
        serde_json::to_string(&supersession.operation.target).map_err(anyhow::Error::new)?;
    let now = now_utc();
    let changed = transaction
        .execute(
            "UPDATE managed_host_maintenance
             SET state = 'maintenance', operation_id = ?1, target_json = ?2,
                 prepared_at = ?3, version = version + 1
             WHERE singleton = 1 AND version = ?4",
            params![
                supersession.operation.operation_id,
                target_json,
                now,
                current.version
            ],
        )
        .map_err(anyhow::Error::new)?;
    if changed != 1 {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    }
    snapshot_with_connection(transaction, Vec::new()).map_err(ManagedMaintenanceError::Store)
}

fn virgin_managed_maintenance(
    transaction: &rusqlite::Transaction<'_>,
    current: &ManagedMaintenanceSnapshot,
) -> std::result::Result<bool, ManagedMaintenanceError> {
    if current.state != ManagedMaintenanceState::Serving
        || current.operation_id.is_some()
        || current.target.is_some()
        || current.accepted_identity.is_some()
        || current.prepared_at.is_some()
        || current.version != 0
    {
        return Ok(false);
    }
    let operation_count = transaction
        .query_row(
            "SELECT COUNT(*) FROM managed_control_operations",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(anyhow::Error::new)?;
    let attempt_count = transaction
        .query_row("SELECT COUNT(*) FROM managed_control_attempts", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(anyhow::Error::new)?;
    Ok(operation_count == 0 && attempt_count == 0)
}

fn validate_forward_supersession(
    supersession: &ManagedUpgradeSupersession,
    store_schema_version: i64,
) -> std::result::Result<(), ManagedMaintenanceError> {
    let previous = &supersession.previous_target;
    let next = &supersession.operation.target;
    if supersession.previous_operation_id == supersession.operation.operation_id
        || previous == next
        || next.schema_version < previous.schema_version
        || next.schema_version < store_schema_version
        || next.minimum_schema_version > store_schema_version
        || next.minimum_schema_version > next.schema_version
        || nac_contracts::compare_product_versions(&next.product_version, &previous.product_version)
            .is_none_or(|ordering| ordering == std::cmp::Ordering::Less)
    {
        return Err(ManagedMaintenanceError::IncompatibleTarget);
    }
    Ok(())
}

fn same_operation_authority(
    previous: &ManagedOperationBinding,
    next: &ManagedOperationBinding,
) -> bool {
    previous.managed_host_id == next.managed_host_id
        && previous.host_incarnation_id == next.host_incarnation_id
        && previous.issuer == next.issuer
        && previous.audience == next.audience
        && previous.authority_origin == next.authority_origin
        && previous.actor == next.actor
        && previous.beneficiary == next.beneficiary
}

fn ensure_operation_binding(
    transaction: &rusqlite::Transaction<'_>,
    binding: &ManagedOperationBinding,
) -> std::result::Result<(), ManagedMaintenanceError> {
    let binding_json = serde_json::to_string(binding).map_err(anyhow::Error::new)?;
    match transaction
        .query_row(
            "SELECT binding_json FROM managed_control_operations WHERE operation_id = ?1",
            params![binding.operation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(anyhow::Error::new)?
    {
        Some(stored) if stored != binding_json => {
            Err(ManagedMaintenanceError::OperationBindingConflict)
        }
        Some(_) => Ok(()),
        None => {
            let operation_count = transaction
                .query_row(
                    "SELECT COUNT(*) FROM managed_control_operations",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(anyhow::Error::new)?;
            if !operation_capacity_available(operation_count) {
                return Err(ManagedMaintenanceError::OperationCapacity);
            }
            let now = now_utc();
            transaction
                .execute(
                    "INSERT INTO managed_control_operations
                         (operation_id, binding_json, latest_outcome_json, created_at, updated_at)
                     VALUES (?1, ?2, '{}', ?3, ?3)",
                    params![binding.operation_id, binding_json, now],
                )
                .map_err(anyhow::Error::new)?;
            Ok(())
        }
    }
}

fn persist_superseded_tombstone(
    transaction: &rusqlite::Transaction<'_>,
    operation_id: &str,
    outcome_json: &str,
    now: &str,
) -> std::result::Result<(), ManagedMaintenanceError> {
    persist_operation_outcome(transaction, operation_id, outcome_json, now)
}

fn persist_operation_outcome(
    transaction: &rusqlite::Transaction<'_>,
    operation_id: &str,
    outcome_json: &str,
    now: &str,
) -> std::result::Result<(), ManagedMaintenanceError> {
    let changed = transaction
        .execute(
            "UPDATE managed_control_operations
             SET latest_outcome_json = ?2, updated_at = ?3, version = version + 1
             WHERE operation_id = ?1",
            params![operation_id, outcome_json, now],
        )
        .map_err(anyhow::Error::new)?;
    if changed != 1 {
        return Err(ManagedMaintenanceError::MaintenanceConflict);
    }
    Ok(())
}

fn current_epoch_seconds() -> std::result::Result<i64, ManagedMaintenanceError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(anyhow::Error::new)?
        .as_secs()
        .try_into()
        .map_err(anyhow::Error::new)
        .map_err(ManagedMaintenanceError::Store)
}

fn acquire_control_attempt_lease(
    path: &Path,
    jti: &str,
) -> std::result::Result<crate::sessions::SessionOperationLease, ManagedMaintenanceError> {
    let digest = Sha256::digest(jti.as_bytes());
    let stripe = digest[0] % CONTROL_ATTEMPT_LOCK_STRIPES;
    let lease_id = format!("managed-control-attempt-{stripe:02x}");
    crate::sessions::SessionOperationLease::acquire(path, &lease_id)
        .map_err(|error| ManagedMaintenanceError::Store(anyhow!(error)))
}

/// Clear maintenance only when the newly started binary exactly matches the
/// accepted forward target and has opened the target schema successfully.
pub fn accept_managed_forward_start(
    path: &Path,
    accepted: &ManagedAcceptedIdentity,
) -> std::result::Result<bool, ManagedMaintenanceError> {
    let _host_maintenance = crate::sessions::HostMaintenanceLease::acquire(path)
        .map_err(|error| ManagedMaintenanceError::Store(anyhow!(error)))?;
    let mut conn = open_runtime_connection(path).map_err(ManagedMaintenanceError::Store)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(anyhow::Error::new)?;
    let snapshot = snapshot_with_connection(&transaction, Vec::new())
        .map_err(ManagedMaintenanceError::Store)?;
    if snapshot.state == ManagedMaintenanceState::Serving {
        transaction.commit().map_err(anyhow::Error::new)?;
        return Ok(false);
    }
    let binding_json = transaction
        .query_row(
            "SELECT binding_json FROM managed_control_operations WHERE operation_id = ?1",
            params![accepted.operation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(anyhow::Error::new)?
        .ok_or(ManagedMaintenanceError::MaintenanceConflict)?;
    let binding: ManagedOperationBinding =
        serde_json::from_str(&binding_json).map_err(anyhow::Error::new)?;
    if snapshot.operation_id.as_deref() != Some(accepted.operation_id.as_str())
        || snapshot.target.as_ref() != Some(&accepted.target)
        || binding.managed_host_id != accepted.managed_host_id
        || binding.host_incarnation_id != accepted.host_incarnation_id
        || binding.operation_id != accepted.operation_id
        || binding.target != accepted.target
        || accepted.target.schema_version != schema_version()
        || accepted.target.minimum_schema_version > schema_version()
    {
        transaction.commit().map_err(anyhow::Error::new)?;
        return Ok(false);
    }
    let accepted_json = serde_json::to_string(accepted).map_err(anyhow::Error::new)?;
    transaction
        .execute(
            "UPDATE managed_host_maintenance
             SET state = 'serving', operation_id = NULL, target_json = NULL,
                 accepted_identity_json = ?1, prepared_at = NULL, version = version + 1
             WHERE singleton = 1 AND state = 'maintenance'",
            params![accepted_json],
        )
        .map_err(anyhow::Error::new)?;
    transaction.commit().map_err(anyhow::Error::new)?;
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(anyhow::Error::new)?;
    Ok(true)
}

fn persist_outcome(
    transaction: &rusqlite::Transaction<'_>,
    jti: &str,
    binding: &ManagedOperationBinding,
    outcome: &ManagedPrepareOutcome,
    now: &str,
) -> std::result::Result<(), ManagedMaintenanceError> {
    let json = serde_json::to_string(outcome).map_err(anyhow::Error::new)?;
    persist_serialized_outcome(transaction, jti, binding, &json, now)
}

fn persist_serialized_outcome(
    transaction: &rusqlite::Transaction<'_>,
    jti: &str,
    binding: &ManagedOperationBinding,
    json: &str,
    now: &str,
) -> std::result::Result<(), ManagedMaintenanceError> {
    transaction
        .execute(
            "UPDATE managed_control_attempts SET outcome_json = ?2 WHERE jti = ?1",
            params![jti, json],
        )
        .map_err(anyhow::Error::new)?;
    transaction
        .execute(
            "UPDATE managed_control_operations
             SET latest_outcome_json = ?2, updated_at = ?3, version = version + 1
             WHERE operation_id = ?1",
            params![binding.operation_id, json, now],
        )
        .map_err(anyhow::Error::new)?;
    Ok(())
}

fn snapshot_with_connection(
    conn: &Connection,
    blockers: Vec<ManagedUpgradeBlocker>,
) -> Result<ManagedMaintenanceSnapshot> {
    conn.query_row(
        "SELECT state, operation_id, target_json, accepted_identity_json, prepared_at, version
         FROM managed_host_maintenance WHERE singleton = 1",
        [],
        |row| {
            let state = match row.get::<_, String>(0)?.as_str() {
                "serving" => ManagedMaintenanceState::Serving,
                "maintenance" => ManagedMaintenanceState::Maintenance,
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            let target_json = row.get::<_, Option<String>>(2)?;
            let target = target_json
                .map(|json| serde_json::from_str(&json))
                .transpose()
                .map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
            let accepted_identity = row
                .get::<_, Option<String>>(3)?
                .map(|json| serde_json::from_str(&json))
                .transpose()
                .map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
            let version = u64::try_from(row.get::<_, i64>(5)?).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Integer,
                    Box::new(error),
                )
            })?;
            Ok(ManagedMaintenanceSnapshot {
                state,
                operation_id: row.get(1)?,
                target,
                accepted_identity,
                prepared_at: row.get(4)?,
                version,
                blockers,
            })
        },
    )
    .map_err(anyhow::Error::new)
}

fn append_maintenance_blocker(snapshot: &mut ManagedMaintenanceSnapshot) {
    if snapshot.state != ManagedMaintenanceState::Maintenance {
        return;
    }
    let Some(operation_id) = snapshot.operation_id.clone() else {
        return;
    };
    snapshot.blockers.push(ManagedUpgradeBlocker {
        kind: ManagedBlockerKind::MaintenanceOperation,
        id: operation_id,
        session_id: None,
        detail: "host is committed to an accepted maintenance operation".to_string(),
    });
    snapshot.blockers.sort();
    snapshot.blockers.dedup();
}

fn durable_blockers(conn: &Connection) -> Result<Vec<ManagedUpgradeBlocker>> {
    let mut blockers = Vec::new();
    let mut active = conn.prepare(
        "SELECT r.session_id, r.run_id
         FROM session_run_recovery r
         WHERE r.status = 'active'
           AND NOT EXISTS (
               SELECT 1 FROM traditional_children c
               WHERE c.child_session_id = r.session_id AND c.status = 'running'
           )
           AND NOT EXISTS (
               SELECT 1 FROM managed_orchestrators o
               WHERE o.orchestrator_session_id = r.session_id AND o.status = 'running'
           )
         ORDER BY r.session_id",
    )?;
    for row in active.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (session_id, run_id) = row?;
        blockers.push(ManagedUpgradeBlocker {
            kind: ManagedBlockerKind::ActiveRun,
            id: run_id,
            session_id: Some(session_id),
            detail: "top-level session run is active".to_string(),
        });
    }
    collect_relationship_blockers(
        conn,
        "traditional_children",
        "child_session_id",
        ManagedBlockerKind::TraditionalChild,
        "traditional child session is running",
        &mut blockers,
    )?;
    collect_relationship_blockers(
        conn,
        "managed_orchestrators",
        "orchestrator_session_id",
        ManagedBlockerKind::ManagedOrchestrator,
        "managed orchestrator is running",
        &mut blockers,
    )?;
    let mut cleanups = conn.prepare(
        "SELECT session_id, pidfile FROM terminal_remote_cleanups ORDER BY session_id, pidfile",
    )?;
    for row in cleanups.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (session_id, pidfile) = row?;
        blockers.push(ManagedUpgradeBlocker {
            kind: ManagedBlockerKind::TerminalProcess,
            id: pidfile,
            session_id: Some(session_id),
            detail: "remote terminal cleanup remains pending".to_string(),
        });
    }
    Ok(blockers)
}

#[cfg(test)]
#[path = "managed_maintenance_tests.rs"]
mod tests;

fn collect_relationship_blockers(
    conn: &Connection,
    table: &str,
    id_column: &str,
    kind: ManagedBlockerKind,
    detail: &str,
    blockers: &mut Vec<ManagedUpgradeBlocker>,
) -> Result<()> {
    let sql = format!(
        "SELECT {id_column}, parent_session_id FROM {table} WHERE status = 'running' ORDER BY {id_column}"
    );
    let mut statement = conn.prepare(&sql)?;
    for row in statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (id, parent) = row?;
        blockers.push(ManagedUpgradeBlocker {
            kind: kind.clone(),
            id,
            session_id: Some(parent),
            detail: detail.to_string(),
        });
    }
    Ok(())
}
