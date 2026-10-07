use super::*;
use crate::store::coordinated_commands::coordinated_command;
use crate::store::coordinated_commands::coordinated_port;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
enum StoredTokenAccounting {
    Legacy(Vec<Option<crate::model::TokenUsage>>),
    WithUnattributed {
        response_usages: Vec<Option<crate::model::TokenUsage>>,
        unattributed_usage: crate::model::TokenUsage,
    },
}

fn serialize_token_accounting(
    response_usages: &[Option<crate::model::TokenUsage>],
    unattributed_usage: Option<&crate::model::TokenUsage>,
) -> Result<Option<String>> {
    if let Some(unattributed_usage) = unattributed_usage {
        return serde_json::to_string(&StoredTokenAccounting::WithUnattributed {
            response_usages: response_usages.to_vec(),
            unattributed_usage: unattributed_usage.clone(),
        })
        .map(Some)
        .context("failed to serialize session token accounting");
    }
    if response_usages.is_empty() {
        Ok(None)
    } else {
        serde_json::to_string(&StoredTokenAccounting::Legacy(response_usages.to_vec()))
            .map(Some)
            .context("failed to serialize session token usages")
    }
}

fn deserialize_token_accounting(
    json: Option<&str>,
) -> Result<(
    Vec<Option<crate::model::TokenUsage>>,
    Option<crate::model::TokenUsage>,
)> {
    let Some(json) = json.filter(|json| !json.is_empty()) else {
        return Ok((Vec::new(), None));
    };
    match serde_json::from_str::<StoredTokenAccounting>(json)
        .context("failed to parse stored session token accounting")?
    {
        StoredTokenAccounting::Legacy(response_usages) => Ok((response_usages, None)),
        StoredTokenAccounting::WithUnattributed {
            response_usages,
            unattributed_usage,
        } => Ok((response_usages, Some(unattributed_usage))),
    }
}

/// Diagnostic prefix `load_session_config` uses for an unparseable
/// `light_model_json` column, so callers can require an explicit repair
/// instead of persisting the loss.
pub const MALFORMED_LIGHT_MODEL_DIAGNOSTIC: &str = "malformed stored light model";

pub(super) fn serialize_light_model(
    light: Option<&crate::light_model::LightModelSettings>,
) -> Result<Option<String>> {
    light
        .map(|config| {
            serde_json::to_string(config).context("failed to serialize session light model")
        })
        .transpose()
}

pub(super) fn deserialize_light_model(
    raw: Option<&str>,
) -> Result<Option<crate::light_model::LightModelSettings>> {
    raw.map(|json| {
        serde_json::from_str::<crate::light_model::LightModelSettings>(json)
            .context("failed to parse stored session light model")
    })
    .transpose()
}

coordinated_command! {
pub fn create_session(path: &Path, snapshot: &SessionSnapshot) -> Result<()> {
    crate::store::retry_busy_correlated(
        crate::telemetry::Correlation::session(Some(&snapshot.session_id)),
        || create_session_once(path, snapshot),
    )
}
command CreateSessionCommand {
    snapshot: SessionSnapshot = snapshot.clone(),
}
call |command| (&command.snapshot)
correlation |command| crate::telemetry::Correlation::session(Some(&command.snapshot.session_id));
port public;
}

fn create_session_once(path: &Path, snapshot: &SessionSnapshot) -> Result<()> {
    create_session_once_with_check(path, snapshot, None)
}

/// Ephemeral final check supplied by trusted construction; no transport, tool
/// implementation or authority can be reconstructed from a durable snapshot.
pub(crate) type SessionCreationCheck = dyn Fn() -> Result<()> + Send + Sync;

coordinated_command! {
pub(crate) fn create_admitted_session(path: &Path, snapshot: &SessionSnapshot,
    admission: &std::sync::Arc<SessionCreationCheck>) -> Result<()> {
    crate::store::retry_busy_correlated(
        crate::telemetry::Correlation::session(Some(&snapshot.session_id)),
        || create_session_once_with_check(path, snapshot, Some(admission.as_ref())),
    )
}
command CreateAdmittedSessionCommand {
    snapshot: SessionSnapshot = snapshot.clone(),
    admission: std::sync::Arc<SessionCreationCheck> = std::sync::Arc::clone(admission),
}
call |command| (&command.snapshot, &command.admission)
correlation |command| crate::telemetry::Correlation::session(Some(&command.snapshot.session_id));
port public;
}

fn create_session_once_with_check(
    path: &Path,
    snapshot: &SessionSnapshot,
    admission: Option<&SessionCreationCheck>,
) -> Result<()> {
    let mut conn = crate::store::open_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(check) = admission {
        check()?;
    }
    insert_new_session_in_transaction(&tx, path, snapshot)?;
    if let Some(check) = admission {
        check()?;
    }
    tx.commit()?;
    Ok(())
}

pub(crate) fn insert_new_session_in_transaction(
    tx: &rusqlite::Transaction<'_>,
    path: &Path,
    snapshot: &SessionSnapshot,
) -> Result<()> {
    let existing: Option<String> = tx
        .query_row(
            "SELECT session_id FROM sessions WHERE session_id = ?1",
            params![snapshot.session_id],
            |row| row.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Err(anyhow!(
            "session '{}' already exists; use 'nac resume {}' to continue it",
            snapshot.session_id,
            snapshot.session_id
        ));
    }

    insert_or_replace_session(tx, path, snapshot)?;
    if let Some(project_id) = snapshot.project_id.as_deref() {
        tx.execute(
            "INSERT INTO session_projects (session_id, project_id) VALUES (?1, ?2)",
            params![snapshot.session_id, project_id],
        )?;
    }
    Ok(())
}

coordinated_command! {
pub fn save_session(path: &Path, snapshot: &SessionSnapshot) -> Result<()> {
    let mut conn = crate::store::open_connection(path)?;
    let tx = conn.transaction()?;
    // Existing rows only receive run/history state. Model configuration is
    // independently revisioned so a stale in-memory service cannot undo a
    // configuration PATCH from another process.
    insert_or_replace_session(&tx, path, snapshot)?;
    tx.commit()?;
    Ok(())
}
command SaveSessionCommand {
    snapshot: SessionSnapshot = snapshot.clone(),
}
call |command| (&command.snapshot)
correlation |command| crate::telemetry::Correlation::session(Some(&command.snapshot.session_id));
port public;
}

coordinated_command! {
/// Bumps the lifetime run counter for a session. Kept out of the snapshot write
/// path so a stale in-memory service cannot roll the counter back.
pub fn increment_run_count(path: &Path, session_id: &str) -> Result<()> {
    let conn = crate::store::open_runtime_connection(path)?;
    conn.execute(
        "UPDATE sessions SET run_count = COALESCE(run_count, 0) + 1 WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(())
}
command IncrementRunCountCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Messages-sparing run-end save (DB-direct transcript workset, step 4 —
/// never-fold): UPDATEs only run-state and row-context columns.
/// `messages_json` is written once at session creation
/// (`insert_or_replace_session`) and never rewritten at run end — the live
/// transcript is the orchestrator transcript log (store/transcript.rs), so
/// the blob stays the system head ++ legacy prefix forever. Model
/// configuration columns stay CAS-only (`update_raw_session_config`).
///
/// Errors when the session row is missing: run end of a persisted session
/// always has its row (the transcript log appends FK-require it), so a
/// missing row is corruption, not an upsert case.
pub fn save_session_run_state(path: &Path, update: &SessionRunStateUpdate) -> Result<()> {
    crate::telemetry::observe_store(
        crate::telemetry::StoreOperation::TerminalSettlement,
        crate::telemetry::Correlation::session(Some(&update.session_id)).with_run(
            update
                .finished_run_id
                .as_deref()
                .or(update.failed_run_id.as_deref()),
        ),
        || save_session_run_state_inner(path, update),
    )
}
command SaveSessionRunStateCommand {
    update: SessionRunStateUpdate = update.clone(),
}
call |command| (&command.update)
correlation |command| crate::telemetry::Correlation::session(Some(&command.update.session_id));
port public;
}

fn save_session_run_state_inner(path: &Path, update: &SessionRunStateUpdate) -> Result<()> {
    let sandbox_json = update
        .sandbox_spec
        .as_ref()
        .map(serialize_sandbox)
        .transpose()?;
    let response_durations_ms_json = update
        .run_state
        .response_durations_ms
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .context("failed to serialize session response durations")?;
    let token_usages_json = serialize_token_accounting(
        &update.run_state.token_usages,
        update.run_state.unattributed_token_usage.as_ref(),
    )?;
    if update.finished_run_id.is_some() != update.finished_run_disposition.is_some() {
        return Err(anyhow!(
            "run-state update must pair a finished run id with its terminal disposition"
        ));
    }
    if update.finished_run_id.is_some() && update.failed_run_id.is_some() {
        return Err(anyhow!(
            "run-state update cannot both clear and retain the durable recovery row"
        ));
    }

    let mut conn = crate::store::open_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let updated = tx.execute(
        "UPDATE sessions
         SET sandbox_json = ?1,
             last_response_duration_ms = ?2,
             previous_response_duration_ms = ?3,
             response_durations_ms_json = ?4,
             token_usages_json = ?5,
             updated_at = ?6,
             host_id = ?7,
             ssh_port = ?8,
             ssh_identity_file = ?9
         WHERE session_id = ?10",
        params![
            sandbox_json,
            update.run_state.last_response_duration_ms,
            update.run_state.previous_response_duration_ms,
            response_durations_ms_json,
            token_usages_json,
            update.updated_at,
            stored_ssh_host(update.ssh.as_ref()),
            stored_ssh_port(update.ssh.as_ref()),
            stored_ssh_identity_file(update.ssh.as_ref()),
            update.session_id,
        ],
    )?;
    if updated == 0 {
        return Err(anyhow!(
            "session '{}' was not found for the run-state save",
            update.session_id
        ));
    }
    let mut durable_failure = update.failed_run_failure.clone();
    if let Some(run_id) = update.finished_run_id.as_deref() {
        if let Some(goal) = update.goal_settlement.as_ref() {
            crate::store::settle_session_goal_run_with_connection(
                &tx,
                &update.session_id,
                &goal.run_id,
                goal.final_billable_tokens,
                goal.terminal_at_epoch_ms,
                goal.disposition,
                goal.failure.as_ref(),
            )?;
        }
        crate::store::clear_active_run(
            &tx,
            &update.session_id,
            run_id,
            update
                .finished_run_disposition
                .ok_or_else(|| anyhow!("finished run is missing its validated disposition"))?,
        )?;
    } else if let Some(run_id) = update.failed_run_id.as_deref() {
        if let Some(goal) = update.goal_settlement.as_ref() {
            let settled = crate::store::settle_session_goal_run_with_connection(
                &tx,
                &update.session_id,
                &goal.run_id,
                goal.final_billable_tokens,
                goal.terminal_at_epoch_ms,
                goal.disposition,
                goal.failure.as_ref(),
            )?;
            if let Some(failure) = settled.and_then(|goal| goal.last_failure) {
                durable_failure = Some(failure);
            }
        }
        crate::store::mark_active_run_failed(
            &tx,
            &update.session_id,
            run_id,
            durable_failure.as_ref(),
        )?;
    }
    tx.commit()?;
    Ok(())
}

coordinated_command! {
pub fn update_session_config(
    path: &Path,
    snapshot: &SessionSnapshot,
) -> std::result::Result<i64, SessionConfigUpdateError> {
    let extra_headers_json = if snapshot.extra_headers.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(&snapshot.extra_headers)
                .context("failed to serialize session extra_headers")?,
        )
    };
    update_raw_session_config(
        path,
        &RawSessionConfig {
            session_id: snapshot.session_id.clone(),
            model: snapshot.model.clone(),
            base_url: snapshot.base_url.clone(),
            allow_insecure_http: snapshot.allow_insecure_http,
            backend: Some(snapshot.backend.as_str().to_string()),
            reasoning_effort: snapshot
                .reasoning_effort
                .map(|effort| effort.as_str().to_string()),
            api_key_env: snapshot.api_key_env.clone(),
            extra_headers_json,
            light_model: snapshot.light_model.clone(),
            orchestrator_compaction_threshold: snapshot.orchestrator_compaction_threshold,
            config_version: snapshot.config_version,
            diagnostics: Vec::new(),
        },
    )
}
command UpdateSessionConfigCommand {
    snapshot: SessionSnapshot = snapshot.clone(),
}
call |command| (&command.snapshot)
correlation |command| crate::telemetry::Correlation::session(Some(&command.snapshot.session_id));
port public;
}

coordinated_command! {
/// Writes only revisioned session-configuration columns using the raw row
/// revision as an optimistic CAS.
/// Callers are responsible for strictly validating the complete prospective
/// raw configuration before invoking this low-level persistence operation.
pub fn update_raw_session_config(
    path: &Path,
    config: &RawSessionConfig,
) -> std::result::Result<i64, SessionConfigUpdateError> {
    let expected_version = config.config_version;
    let next_version = expected_version.checked_add(1).ok_or_else(|| {
        SessionConfigUpdateError::Store(anyhow!("session configuration version overflow"))
    })?;

    let light_model_json = serialize_light_model(config.light_model.as_ref())?;
    let mut conn = crate::store::open_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let updated = tx.execute(
        "UPDATE sessions
         SET model = ?1,
             base_url = ?2,
             allow_insecure_http = ?3,
             backend = ?4,
             reasoning_effort = ?5,
             api_key_env = ?6,
             extra_headers_json = ?7,
             light_model_json = ?8,
             orchestrator_compaction_threshold = ?9,
             config_version = ?10
         WHERE session_id = ?11 AND config_version = ?12",
        params![
            config.model,
            config.base_url,
            config.allow_insecure_http,
            config.backend,
            config.reasoning_effort,
            config.api_key_env,
            config.extra_headers_json,
            light_model_json,
            config.orchestrator_compaction_threshold,
            next_version,
            config.session_id,
            expected_version,
        ],
    )?;
    if updated == 0 {
        let current_version = tx
            .query_row(
                "SELECT config_version FROM sessions WHERE session_id = ?1",
                params![config.session_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        return match current_version {
            Some(current_version) => Err(SessionConfigUpdateError::Conflict(format!(
                "session '{}' configuration changed concurrently (expected version {}, found {})",
                config.session_id, expected_version, current_version
            ))),
            None => Err(SessionConfigUpdateError::NotFound(format!(
                "session '{}' was not found",
                config.session_id
            ))),
        };
    }
    tx.commit()?;
    Ok(next_version)
}
command UpdateRawSessionConfigCommand {
    config: RawSessionConfig = config.clone(),
}
call |command| (&command.config)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub(crate) fn durable_session_owner_exists(path: &Path, session_id: &str,
    expected: &std::fs::Metadata) -> Result<bool> {
    let verify = || -> Result<()> {
        let actual = std::fs::symlink_metadata(path)?;
        anyhow::ensure!(actual.file_type().is_file(), "session ownership store is unavailable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            anyhow::ensure!(actual.dev() == expected.dev() && actual.ino() == expected.ino(),
                "session ownership store was replaced; resources retained");
        }
        #[cfg(not(unix))]
        anyhow::ensure!(actual.created()? == expected.created()?,
            "session ownership store was replaced; resources retained");
        Ok(())
    };
    // The command runs after the selected owner's queue wait. This query must
    // never initialize a missing/replaced path or translate uncertainty to false.
    verify()?;
    let conn = crate::store::open_initialized_read_connection(path)?;
    let exists = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id = ?1)",
        params![session_id],
        |row| row.get(0),
    )?;
    verify()?;
    Ok(exists)
}
command DurableSessionOwnerExistsCommand {
    session_id: String = session_id.to_owned(),
    expected: std::fs::Metadata = expected.clone(),
}
call |command| (&command.session_id, &command.expected)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub fn session_exists(path: &Path, session_id: &str) -> Result<bool> {
    if !path.exists() {
        return Ok(false);
    }
    let conn = crate::store::open_connection(path)?;
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id = ?1)",
        params![session_id],
        |row| row.get(0),
    )
    .map_err(Into::into)
}
command SessionExistsCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub fn load_session(path: &Path, session_id: &str) -> Result<SessionSnapshot> {
    let conn = crate::store::open_connection(path)?;
    let row = conn
        .query_row(
            "SELECT s.session_id, s.cwd, s.model, s.base_url, s.allow_insecure_http, s.backend, s.reasoning_effort,
                    s.sandbox_json, s.messages_json, s.last_response_duration_ms,
                    s.previous_response_duration_ms, s.response_durations_ms_json,
                    s.created_at, s.updated_at, s.host_id, s.api_key_env,
                    s.extra_headers_json, s.token_usages_json, s.config_version,
                    s.orchestrator_compaction_threshold, s.ssh_port,
                    s.ssh_identity_file, s.light_model_json, sp.project_id, s.behavior
             FROM sessions s
             LEFT JOIN session_projects sp ON sp.session_id = s.session_id
             WHERE s.session_id = ?1",
            params![session_id],
            map_session_row,
        )
        .optional()?;

    let Some(row) = row else {
        return Err(anyhow!("session '{session_id}' was not found"));
    };

    row.into_snapshot()
}
command LoadSessionCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub(crate) fn load_session_run_state(
    path: &Path,
    session_id: &str,
) -> Result<(SessionRunState, String)> {
    let conn = crate::store::open_connection(path)?;
    let row = conn
        .query_row(
            "SELECT last_response_duration_ms, previous_response_duration_ms, response_durations_ms_json, token_usages_json, updated_at
             FROM sessions
             WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, Option<u64>>(0)?,
                    row.get::<_, Option<u64>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((last, previous, durations_json, token_usages_json, updated_at)) = row else {
        return Err(anyhow!("session '{session_id}' was not found"));
    };
    let response_durations_ms = durations_json
        .map(|json| {
            serde_json::from_str::<Vec<Option<u64>>>(&json)
                .context("failed to parse stored session response durations")
        })
        .transpose()?;
    let (token_usages, unattributed_token_usage) =
        deserialize_token_accounting(token_usages_json.as_deref())?;
    Ok((
        SessionRunState {
            last_response_duration_ms: last,
            previous_response_duration_ms: previous,
            response_durations_ms,
            token_usages,
            unattributed_token_usage,
        },
        updated_at,
    ))
}
command LoadSessionRunStateCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
pub fn load_session_config(path: &Path, session_id: &str) -> Result<RawSessionConfig> {
    let conn = crate::store::open_connection(path)?;
    let row = conn
        .query_row(
            "SELECT session_id, model, base_url, allow_insecure_http, backend, reasoning_effort, api_key_env, extra_headers_json, config_version, orchestrator_compaction_threshold, light_model_json
             FROM sessions
             WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok((
                    RawSessionConfig {
                        session_id: row.get(0)?,
                        model: row.get(1)?,
                        base_url: row.get(2)?,
                        allow_insecure_http: row.get(3)?,
                        backend: row.get(4)?,
                        reasoning_effort: row.get(5)?,
                        api_key_env: row.get(6)?,
                        extra_headers_json: row.get(7)?,
                        light_model: None,
                        config_version: row.get(8)?,
                        orchestrator_compaction_threshold: row.get(9)?,
                        diagnostics: Vec::new(),
                    },
                    row.get::<_, Option<String>>(10)?,
                ))
            },
        )
        .optional()?;

    let Some((mut config, light_model_json)) = row else {
        return Err(anyhow!("session '{session_id}' was not found"));
    };
    match deserialize_light_model(light_model_json.as_deref()) {
        Ok(light_model) => config.light_model = light_model,
        Err(error) => config
            .diagnostics
            .push(format!("{MALFORMED_LIGHT_MODEL_DIAGNOSTIC}: {error:#}")),
    }
    config.orchestrator_compaction_threshold =
        validate_stored_compaction_threshold(config.orchestrator_compaction_threshold)?;
    config.diagnostics.extend(model_config_diagnostics(
        config.backend.as_deref(),
        config.reasoning_effort.as_deref(),
        config.extra_headers_json.as_deref(),
    ));
    Ok(config)
}
command LoadSessionConfigCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Loads the durable answer policy for exactly one session. Legacy rows are
/// migrated to manual, preserving headless fail-closed behavior by default.
pub fn load_permission_approval_mode(
    path: &Path,
    session_id: &str,
) -> Result<crate::permissions::PermissionApprovalMode> {
    load_permission_approval_state(path, session_id).map(|(mode, _, _)| mode)
}
command LoadPermissionApprovalModeCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Loads the answer policy that governs a requesting session.
///
/// Traditional children resolve through their durable root ownership record,
/// including any future deeper descendant whose record preserves that root.
/// Managed orchestrators deliberately remain outside this lookup: their
/// relationship is a separate topology and cannot inherit a direct parent's
/// approval authority accidentally.
pub(crate) fn load_effective_permission_approval_state(
    path: &Path,
    requesting_session_id: &str,
) -> Result<(crate::permissions::PermissionApprovalMode, i64, i64)> {
    let conn = crate::store::open_initialized_read_connection(path)?;
    let (stored, generation, revision) = conn
        .query_row(
            "SELECT policy.permission_approval_mode,
                    policy.permission_auto_approve_generation,
                    policy.permission_approval_revision
             FROM sessions AS requester
             LEFT JOIN traditional_children AS child
                ON child.child_session_id = requester.session_id
             JOIN sessions AS policy
                ON policy.session_id = COALESCE(child.root_session_id, requester.session_id)
             WHERE requester.session_id = ?1",
            params![requesting_session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("session '{requesting_session_id}' was not found"))?;
    decode_permission_approval_state(stored, generation, revision)
}
command LoadEffectivePermissionApprovalStateCommand {
    requesting_session_id: String = requesting_session_id.to_owned(),
}
call |command| (&command.requesting_session_id)
correlation |_command| crate::telemetry::Correlation::default();
port internal;
}

coordinated_command! {
/// Loads the current mode, the monotonic auto-approve generation, and the
/// latest reserved transition revision.
pub(crate) fn load_permission_approval_state(
    path: &Path,
    session_id: &str,
) -> Result<(crate::permissions::PermissionApprovalMode, i64, i64)> {
    let conn = crate::store::open_initialized_read_connection(path)?;
    let (stored, generation, revision) = conn
        .query_row(
            "SELECT permission_approval_mode, permission_auto_approve_generation,
                    permission_approval_revision
             FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("session '{session_id}' was not found"))?;
    decode_permission_approval_state(stored, generation, revision)
}
command LoadPermissionApprovalStateCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

fn decode_permission_approval_state(
    stored: String,
    generation: i64,
    revision: i64,
) -> Result<(crate::permissions::PermissionApprovalMode, i64, i64)> {
    let mode = match stored.as_str() {
        "manual" => crate::permissions::PermissionApprovalMode::Manual,
        "auto_approve" => crate::permissions::PermissionApprovalMode::AutoApprove,
        _ => Err(anyhow!(
            "unsupported stored permission approval mode '{stored}'"
        ))?,
    };
    if generation < 0 {
        return Err(anyhow!(
            "stored permission auto-approve generation cannot be negative"
        ));
    }
    if revision < 0 {
        return Err(anyhow!(
            "stored permission approval revision cannot be negative"
        ));
    }
    Ok((mode, generation, revision))
}

coordinated_command! {
/// Changes only the session-local permission answer policy. This does not
/// increment model config_version, invalidate remembered grants, or rewrite
/// backend selection.
pub fn update_permission_approval_mode(
    path: &Path,
    session_id: &str,
    mode: crate::permissions::PermissionApprovalMode,
) -> Result<()> {
    let revision = reserve_permission_approval_transition(path, session_id)?;
    if compare_and_update_permission_approval_state(path, session_id, revision, mode)? {
        Ok(())
    } else {
        Err(anyhow!(
            "permission approval mode changed concurrently; refresh and try again"
        ))
    }
}
command UpdatePermissionApprovalModeCommand {
    session_id: String = session_id.to_owned(),
    mode: crate::permissions::PermissionApprovalMode = mode,
}
call |command| (&command.session_id, command.mode)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Reserves the next durable user-intent ticket. A later reservation prevents
/// an older delayed writer from applying, regardless of actual write order.
pub(crate) fn reserve_permission_approval_transition(path: &Path, session_id: &str) -> Result<i64> {
    let mut conn = crate::store::open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let updated = tx.execute(
        "UPDATE sessions
         SET permission_approval_revision = permission_approval_revision + 1
         WHERE session_id = ?1",
        params![session_id],
    )?;
    if updated == 0 {
        return Err(anyhow!("session '{session_id}' was not found"));
    }
    let revision = tx.query_row(
        "SELECT permission_approval_revision FROM sessions WHERE session_id = ?1",
        params![session_id],
        |row| row.get::<_, i64>(0),
    )?;
    tx.commit()?;
    Ok(revision)
}
command ReservePermissionApprovalTransitionCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
/// Applies a reserved transition only while it is still the latest user
/// intent. `false` means a later transition was reserved first.
pub(crate) fn compare_and_update_permission_approval_state(
    path: &Path,
    session_id: &str,
    revision: i64,
    mode: crate::permissions::PermissionApprovalMode,
) -> Result<bool> {
    let mut conn = crate::store::open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let stored = match mode {
        crate::permissions::PermissionApprovalMode::Manual => "manual",
        crate::permissions::PermissionApprovalMode::AutoApprove => "auto_approve",
    };
    let increment = i64::from(mode == crate::permissions::PermissionApprovalMode::AutoApprove);
    let updated = tx.execute(
        "UPDATE sessions
         SET permission_approval_mode = ?1,
             permission_auto_approve_generation = permission_auto_approve_generation + ?2
         WHERE session_id = ?3 AND permission_approval_revision = ?4",
        params![stored, increment, session_id, revision],
    )?;
    if updated == 0 {
        let exists = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id = ?1)",
            params![session_id],
            |row| row.get::<_, bool>(0),
        )?;
        tx.commit()?;
        return if exists {
            Ok(false)
        } else {
            Err(anyhow!("session '{session_id}' was not found"))
        };
    }
    tx.commit()?;
    Ok(true)
}
command CompareAndUpdatePermissionApprovalStateCommand {
    session_id: String = session_id.to_owned(),
    revision: i64 = revision,
    mode: crate::permissions::PermissionApprovalMode = mode,
}
call |command| (&command.session_id, command.revision, command.mode)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
/// Reads only the immutable behavior discriminator. Configuration repair paths
/// use this instead of decoding the whole snapshot, because an unrelated
/// malformed legacy field must remain explicitly repairable.
pub fn load_session_behavior(path: &Path, session_id: &str) -> Result<SessionBehavior> {
    let conn = crate::store::open_connection(path)?;
    let behavior = conn
        .query_row(
            "SELECT behavior FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    behavior
        .ok_or_else(|| anyhow!("session '{session_id}' was not found"))?
        .parse()
}
command LoadSessionBehaviorCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub fn load_last_session(path: &Path) -> Result<SessionSnapshot> {
    let conn = crate::store::open_connection(path)?;
    let row = conn
        .query_row(
            "SELECT s.session_id, s.cwd, s.model, s.base_url, s.allow_insecure_http, s.backend, s.reasoning_effort,
                    s.sandbox_json, s.messages_json, s.last_response_duration_ms,
                    s.previous_response_duration_ms, s.response_durations_ms_json,
                    s.created_at, s.updated_at, s.host_id, s.api_key_env,
                    s.extra_headers_json, s.token_usages_json, s.config_version,
                    s.orchestrator_compaction_threshold, s.ssh_port,
                    s.ssh_identity_file, s.light_model_json, sp.project_id, s.behavior
             FROM sessions s
             LEFT JOIN session_projects sp ON sp.session_id = s.session_id
             ORDER BY s.updated_at DESC, s.created_at DESC
             LIMIT 1",
            [],
            map_session_row,
        )
        .optional()?;

    let Some(row) = row else {
        return Err(anyhow!("no resumable nac sessions were found"));
    };

    row.into_snapshot()
}
command LoadLastSessionCommand {
}
call |_command| ()
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub fn delete_session(path: &Path, session_id: &str) -> Result<bool> {
    let mut conn = crate::store::open_connection(path)?;
    let tx = conn.transaction()?;
    // Delete non-cascading child tables before their parents. Session-owned
    // auxiliary rows are intentionally left to their session foreign keys.
    tx.execute(
        "DELETE FROM episodes WHERE session_id = ?1",
        params![session_id],
    )?;
    tx.execute(
        "DELETE FROM workset_items WHERE session_id = ?1",
        params![session_id],
    )?;
    tx.execute(
        "DELETE FROM threads WHERE session_id = ?1",
        params![session_id],
    )?;
    tx.execute(
        "DELETE FROM worksets WHERE session_id = ?1",
        params![session_id],
    )?;
    let deleted = tx.execute(
        "DELETE FROM sessions WHERE session_id = ?1",
        params![session_id],
    )?;
    tx.commit()?;
    Ok(deleted > 0)
}
command DeleteSessionCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        session_id: row.get(0)?,
        cwd: row.get(1)?,
        model: row.get(2)?,
        base_url: row.get(3)?,
        allow_insecure_http: row.get(4)?,
        backend: row.get(5)?,
        reasoning_effort: row.get(6)?,
        sandbox_json: row.get(7)?,
        messages_json: row.get(8)?,
        last_response_duration_ms: row.get(9)?,
        previous_response_duration_ms: row.get(10)?,
        response_durations_ms_json: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        ssh_host: row.get(14)?,
        api_key_env: row.get(15)?,
        extra_headers_json: row.get(16)?,
        token_usages_json: row.get(17)?,
        config_version: row.get(18)?,
        orchestrator_compaction_threshold: row.get(19)?,
        ssh_port: row.get(20)?,
        ssh_identity_file: row.get(21)?,
        light_model_json: row.get(22)?,
        project_id: row.get(23)?,
        behavior: row.get(24)?,
    })
}

coordinated_command! {
pub fn list_sessions(path: &Path) -> Result<Vec<SessionSummary>> {
    let conn = crate::store::open_runtime_connection(path)?;
    list_sessions_with_connection(&conn)
}
command ListSessionsCommand {
}
call |_command| ()
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

pub(crate) fn list_sessions_with_connection(
    conn: &rusqlite::Connection,
) -> Result<Vec<SessionSummary>> {
    query_session_summaries(conn, None)
}

coordinated_command! {
pub fn update_session_presentation(
    path: &Path,
    session_id: &str,
    title: &str,
    pinned: bool,
    expected_version: i64,
) -> std::result::Result<SessionSummary, SessionPresentationError> {
    let title = normalize_presentation_title(title)?;
    if expected_version < 0 {
        return Err(SessionPresentationError::InvalidInput(
            "expected_version must not be negative".to_string(),
        ));
    }

    let mut conn = crate::store::open_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let current = tx
        .query_row(
            "SELECT COALESCE(p.pinned, 0), COALESCE(p.sort_order, 0), COALESCE(p.version, 0)
             FROM sessions s
             LEFT JOIN session_presentations p ON p.session_id = s.session_id
             WHERE s.session_id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? != 0,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((current_pinned, current_sort_order, current_version)) = current else {
        return Err(SessionPresentationError::NotFound(format!(
            "session '{session_id}' was not found"
        )));
    };
    if current_version != expected_version {
        return Err(SessionPresentationError::Conflict(format!(
            "session '{session_id}' presentation version changed (expected {expected_version}, found {current_version})"
        )));
    }

    let sort_order = if current_pinned == pinned {
        current_sort_order
    } else {
        let maximum: i64 = tx.query_row(
            "SELECT COALESCE(MAX(COALESCE(p.sort_order, 0)), -1)
             FROM sessions s
             LEFT JOIN session_presentations p ON p.session_id = s.session_id
             WHERE s.session_id <> ?1 AND COALESCE(p.pinned, 0) = ?2",
            params![session_id, i64::from(pinned)],
            |row| row.get(0),
        )?;
        maximum.checked_add(1).ok_or_else(|| {
            SessionPresentationError::Store(anyhow!("session presentation order overflow"))
        })?
    };
    let next_version = current_version.checked_add(1).ok_or_else(|| {
        SessionPresentationError::Store(anyhow!("session presentation version overflow"))
    })?;

    tx.execute(
        "INSERT INTO session_presentations (session_id, title, pinned, sort_order, version)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(session_id) DO UPDATE SET
             title = excluded.title,
             pinned = excluded.pinned,
             sort_order = excluded.sort_order,
             version = excluded.version",
        params![
            session_id,
            title,
            i64::from(pinned),
            sort_order,
            next_version
        ],
    )?;

    let summary = query_session_summary(&tx, session_id)?.ok_or_else(|| {
        SessionPresentationError::Store(anyhow!(
            "session '{session_id}' disappeared during presentation update"
        ))
    })?;
    tx.commit()?;
    Ok(summary)
}
command UpdateSessionPresentationCommand {
    session_id: String = session_id.to_owned(),
    title: String = title.to_owned(),
    pinned: bool = pinned,
    expected_version: i64 = expected_version,
}
call |command| (&command.session_id, &command.title, command.pinned, command.expected_version)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub fn reorder_sessions(
    path: &Path,
    pinned: bool,
    session_ids: &[String],
    expected_versions: &BTreeMap<String, i64>,
) -> std::result::Result<Vec<SessionSummary>, SessionPresentationError> {
    let mut submitted_ids = HashSet::with_capacity(session_ids.len());
    for session_id in session_ids {
        if session_id.trim().is_empty() {
            return Err(SessionPresentationError::InvalidInput(
                "session IDs must not be blank".to_string(),
            ));
        }
        if !submitted_ids.insert(session_id.as_str()) {
            return Err(SessionPresentationError::InvalidInput(format!(
                "duplicate session ID '{session_id}'"
            )));
        }
    }
    if expected_versions.values().any(|version| *version < 0) {
        return Err(SessionPresentationError::InvalidInput(
            "expected presentation versions must not be negative".to_string(),
        ));
    }
    if expected_versions.len() != session_ids.len()
        || session_ids
            .iter()
            .any(|session_id| !expected_versions.contains_key(session_id))
    {
        return Err(SessionPresentationError::InvalidInput(
            "expected_versions keys must exactly match session_ids".to_string(),
        ));
    }

    let mut conn = crate::store::open_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut current_versions = BTreeMap::new();
    for session_id in session_ids {
        let current = tx
            .query_row(
                "SELECT COALESCE(p.pinned, 0), COALESCE(p.version, 0)
                 FROM sessions s
                 LEFT JOIN session_presentations p ON p.session_id = s.session_id
                 WHERE s.session_id = ?1",
                params![session_id],
                |row| Ok((row.get::<_, i64>(0)? != 0, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let Some((current_pinned, current_version)) = current else {
            return Err(SessionPresentationError::NotFound(format!(
                "session '{session_id}' was not found"
            )));
        };
        if current_pinned != pinned {
            return Err(SessionPresentationError::Conflict(format!(
                "session '{session_id}' is not in the requested pin group"
            )));
        }
        current_versions.insert(session_id.clone(), current_version);
    }

    let authoritative_ids = {
        let mut stmt = tx.prepare(
            "SELECT s.session_id
             FROM sessions s
             LEFT JOIN session_presentations p ON p.session_id = s.session_id
             WHERE COALESCE(p.pinned, 0) = ?1",
        )?;
        let rows = stmt
            .query_map(params![i64::from(pinned)], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    if authoritative_ids.len() != session_ids.len()
        || authoritative_ids
            .iter()
            .any(|session_id| !submitted_ids.contains(session_id.as_str()))
    {
        return Err(SessionPresentationError::Conflict(
            "session group membership changed".to_string(),
        ));
    }

    for session_id in session_ids {
        let current_version = current_versions[session_id];
        let expected_version = expected_versions[session_id];
        if current_version != expected_version {
            return Err(SessionPresentationError::Conflict(format!(
                "session '{session_id}' presentation version changed (expected {expected_version}, found {current_version})"
            )));
        }
    }

    for (position, session_id) in session_ids.iter().enumerate() {
        let sort_order = i64::try_from(position).map_err(|_| {
            SessionPresentationError::InvalidInput("too many sessions to reorder".to_string())
        })?;
        let next_version = current_versions[session_id].checked_add(1).ok_or_else(|| {
            SessionPresentationError::Store(anyhow!("session presentation version overflow"))
        })?;
        tx.execute(
            "INSERT INTO session_presentations (session_id, pinned, sort_order, version)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(session_id) DO UPDATE SET
                 pinned = excluded.pinned,
                 sort_order = excluded.sort_order,
                 version = excluded.version",
            params![session_id, i64::from(pinned), sort_order, next_version],
        )?;
    }

    let summaries = query_session_summaries(&tx, Some(pinned))?;
    tx.commit()?;
    Ok(summaries)
}
command ReorderSessionsCommand {
    pinned: bool = pinned,
    session_ids: Vec<String> = session_ids.to_vec(),
    expected_versions: BTreeMap<String, i64> = expected_versions.clone(),
}
call |command| (command.pinned, &command.session_ids, &command.expected_versions)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

fn normalize_presentation_title(
    title: &str,
) -> std::result::Result<Option<String>, SessionPresentationError> {
    if title.chars().any(char::is_control) {
        return Err(SessionPresentationError::InvalidInput(
            "session title must not contain control characters".to_string(),
        ));
    }
    let title = title.trim();
    if title.chars().count() > 120 {
        return Err(SessionPresentationError::InvalidInput(
            "session title must not exceed 120 characters".to_string(),
        ));
    }
    Ok((!title.is_empty()).then(|| title.to_string()))
}

const SESSION_SUMMARY_QUERY_HEAD: &str = r#"
SELECT s.session_id, s.cwd, s.model, s.backend, s.reasoning_effort,
       s.extra_headers_json, s.sandbox_json, s.created_at, s.updated_at, s.host_id,
       p.title, COALESCE(p.pinned, 0), COALESCE(p.sort_order, 0),
       COALESCE(p.version, 0), s.visible_message_count, s.last_user_prompt,
       s.token_usages_json, COALESCE(s.run_count, 0), s.ssh_port, s.ssh_identity_file,
       sp.project_id, s.behavior,
       fsrc.source_session_id, fsrc.source_title, origin_p.title,
       origin_s.last_user_prompt, origin_s.session_id
FROM sessions s
LEFT JOIN session_presentations p ON p.session_id = s.session_id
LEFT JOIN session_projects sp ON sp.session_id = s.session_id
LEFT JOIN session_forks fsrc ON fsrc.fork_session_id = s.session_id
LEFT JOIN sessions origin_s ON origin_s.session_id = fsrc.source_session_id
LEFT JOIN session_presentations origin_p ON origin_p.session_id = fsrc.source_session_id
"#;

fn query_session_summary(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Option<SessionSummary>> {
    let sql = format!("{SESSION_SUMMARY_QUERY_HEAD} WHERE s.session_id = ?1");
    let row = conn
        .query_row(&sql, params![session_id], map_session_summary_row)
        .optional()?;
    row.map(SessionSummaryRow::into_summary).transpose()
}

fn query_session_summaries(
    conn: &rusqlite::Connection,
    pinned: Option<bool>,
) -> Result<Vec<SessionSummary>> {
    let suffix = match pinned {
        Some(_) => {
            "WHERE COALESCE(p.pinned, 0) = ?1
             ORDER BY COALESCE(p.pinned, 0) DESC,
                      COALESCE(p.sort_order, 0) ASC,
                      s.created_at DESC,
                      s.session_id DESC"
        }
        None => {
            "ORDER BY COALESCE(p.pinned, 0) DESC,
                      COALESCE(p.sort_order, 0) ASC,
                      s.created_at DESC,
                      s.session_id DESC"
        }
    };
    let sql = format!("{SESSION_SUMMARY_QUERY_HEAD} {suffix}");
    let mut stmt = conn.prepare(&sql)?;
    let rows = match pinned {
        Some(pinned) => stmt
            .query_map(params![i64::from(pinned)], map_session_summary_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?,
        None => stmt
            .query_map([], map_session_summary_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?,
    };
    rows.into_iter()
        .map(SessionSummaryRow::into_summary)
        .collect()
}

fn map_session_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionSummaryRow> {
    Ok(SessionSummaryRow {
        session_id: row.get(0)?,
        cwd: row.get(1)?,
        model: row.get(2)?,
        backend_raw: row.get(3)?,
        reasoning_effort_raw: row.get(4)?,
        extra_headers_json: row.get(5)?,
        sandbox_json: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        ssh_host: row.get(9)?,
        title: row.get(10)?,
        pinned: row.get::<_, i64>(11)? != 0,
        sort_order: row.get(12)?,
        presentation_version: row.get(13)?,
        visible_message_count: row.get(14)?,
        last_user_prompt: row.get(15)?,
        token_usages_json: row.get(16)?,
        run_count: row.get(17)?,
        ssh_port: row.get(18)?,
        ssh_identity_file: row.get(19)?,
        project_id: row.get(20)?,
        behavior: row.get(21)?,
        fork_source_session_id: row.get(22)?,
        fork_source_title: row.get(23)?,
        fork_origin_title: row.get(24)?,
        fork_origin_prompt: row.get(25)?,
        fork_origin_session_id: row.get(26)?,
    })
}

struct SessionSummaryRow {
    session_id: String,
    cwd: String,
    model: String,
    backend_raw: Option<String>,
    reasoning_effort_raw: Option<String>,
    extra_headers_json: Option<String>,
    sandbox_json: Option<String>,
    created_at: String,
    updated_at: String,
    ssh_host: Option<String>,
    title: Option<String>,
    pinned: bool,
    sort_order: i64,
    presentation_version: i64,
    visible_message_count: i64,
    last_user_prompt: Option<String>,
    token_usages_json: Option<String>,
    run_count: i64,
    ssh_port: Option<u16>,
    ssh_identity_file: Option<String>,
    project_id: Option<String>,
    behavior: String,
    fork_source_session_id: Option<String>,
    fork_source_title: Option<String>,
    fork_origin_title: Option<String>,
    fork_origin_prompt: Option<String>,
    fork_origin_session_id: Option<String>,
}

impl SessionSummaryRow {
    fn into_summary(self) -> Result<SessionSummary> {
        let diagnostics = model_config_diagnostics(
            self.backend_raw.as_deref(),
            self.reasoning_effort_raw.as_deref(),
            self.extra_headers_json.as_deref(),
        );
        let backend = self.backend_raw.unwrap_or_default();
        let cwd = PathBuf::from(self.cwd);
        let sandbox_spec = deserialize_sandbox(self.sandbox_json)?;
        let sandboxed = sandbox_spec.is_some();
        let ssh = stored_ssh_connection(self.ssh_host, self.ssh_port, self.ssh_identity_file);
        let workspace_host_path = if ssh.is_some() {
            None
        } else {
            match sandbox_spec.as_ref() {
                Some(spec) => crate::sandbox::host_workdir_from_spec(spec),
                None => Some(cwd.clone()),
            }
        };
        // Never-fold (step 4): the blob is write-once (system head ++ legacy
        // prefix) and the recent transcript lives in the orchestrator
        // transcript log, so these two are materialized columns rather than a
        // count over the blob: the log writer adds its delta on every append,
        // a truncation rebuilds them, and the migration backfills blob ++ log.
        let visible_message_count = usize::try_from(self.visible_message_count)
            .context("session visible message count overflowed")?;
        let (response_usages, _) = deserialize_token_accounting(self.token_usages_json.as_deref())?;
        let aggregated = crate::model::TokenUsage::aggregate(&response_usages);
        let total_tokens = aggregated
            .as_ref()
            .map(crate::model::TokenUsage::billable_tokens);
        let total_cost_micros = aggregated.as_ref().map(|usage| usage.cost.total);
        Ok(SessionSummary {
            session_id: self.session_id,
            behavior: self.behavior.parse()?,
            project_id: self.project_id,
            cwd,
            workspace_host_path,
            model: self.model,
            backend,
            model_config_error: (!diagnostics.is_empty()).then(|| diagnostics.join("; ")),
            visible_message_count,
            last_user_prompt: self.last_user_prompt,
            sandboxed,
            ssh,
            title: self.title,
            pinned: self.pinned,
            sort_order: self.sort_order,
            presentation_version: self.presentation_version,
            created_at: self.created_at,
            updated_at: self.updated_at,
            total_tokens,
            total_cost_micros,
            run_count: self.run_count.max(0) as u64,
            forked_from: crate::store::fork_origin_from_parts(
                self.fork_source_session_id,
                self.fork_source_title,
                self.fork_origin_title,
                self.fork_origin_prompt,
                self.fork_origin_session_id,
            ),
        })
    }
}

pub(crate) fn insert_or_replace_session(
    tx: &rusqlite::Transaction<'_>,
    path: &Path,
    snapshot: &SessionSnapshot,
) -> Result<()> {
    let sandbox_json = snapshot
        .sandbox_spec
        .as_ref()
        .map(serialize_sandbox)
        .transpose()?;
    // NEVER-FOLD (DB-direct transcript workset, step 4): this is the only
    // writer of messages_json — session creation and the legacy full upsert
    // below. Run end never rewrites the blob (`save_session_run_state`):
    // the live transcript is the orchestrator transcript log
    // (store/transcript.rs) and the blob is the write-once system head ++
    // legacy prefix. DOWNGRADE CAVEAT (user-accepted): builds older than
    // the transcript-log workset read only messages_json, so they show this
    // store's history truncated to the blob — invisibility, not corruption;
    // the log rows are untouched and a current build reads the full
    // transcript again.
    let messages_json = serde_json::to_string(&snapshot.messages)
        .context("failed to serialize session messages")?;
    let summary_visible_message_count = i64::try_from(visible_message_count(&snapshot.messages))
        .context("session visible message count overflowed")?;
    let summary_last_user_prompt = last_user_prompt(&snapshot.messages);
    let response_durations_ms_json = snapshot
        .response_durations_ms
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .context("failed to serialize session response durations")?;
    let extra_headers_json = if snapshot.extra_headers.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(&snapshot.extra_headers)
                .context("failed to serialize session extra_headers")?,
        )
    };
    let token_usages_json = serialize_token_accounting(
        &snapshot.token_usages,
        snapshot.unattributed_token_usage.as_ref(),
    )?;
    let light_model_json = serialize_light_model(snapshot.light_model.as_ref())?;

    // The legacy `store_path` column is kept physically (NOT NULL in existing
    // stores) but is informational only: it records the store that was
    // actually opened for this write and is never read back.
    tx.execute(
        "INSERT INTO sessions (
             session_id, cwd, store_path, model, base_url, allow_insecure_http, backend, reasoning_effort,
             sandbox_json, messages_json, visible_message_count, last_user_prompt,
             last_response_duration_ms, previous_response_duration_ms,
             response_durations_ms_json, created_at, updated_at, host_id, api_key_env,
             extra_headers_json, token_usages_json, config_version,
             orchestrator_compaction_threshold, ssh_port, ssh_identity_file,
             light_model_json, behavior
         ) VALUES (
             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
             ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27
         )
         ON CONFLICT(session_id) DO UPDATE SET
             cwd = excluded.cwd,
             store_path = excluded.store_path,
             sandbox_json = excluded.sandbox_json,
             messages_json = excluded.messages_json,
             visible_message_count = excluded.visible_message_count,
             last_user_prompt = excluded.last_user_prompt,
             last_response_duration_ms = excluded.last_response_duration_ms,
             previous_response_duration_ms = excluded.previous_response_duration_ms,
             response_durations_ms_json = excluded.response_durations_ms_json,
             updated_at = excluded.updated_at,
             host_id = excluded.host_id,
             ssh_port = excluded.ssh_port,
             ssh_identity_file = excluded.ssh_identity_file,
             token_usages_json = excluded.token_usages_json",
        params![
            snapshot.session_id,
            snapshot.cwd.display().to_string(),
            path.display().to_string(),
            snapshot.model,
            snapshot.base_url,
            snapshot.allow_insecure_http,
            snapshot.backend.as_str(),
            snapshot
                .reasoning_effort
                .map(|effort| effort.as_str().to_string()),
            sandbox_json,
            messages_json,
            summary_visible_message_count,
            summary_last_user_prompt,
            snapshot.last_response_duration_ms,
            snapshot.previous_response_duration_ms,
            response_durations_ms_json,
            snapshot.created_at,
            snapshot.updated_at,
            stored_ssh_host(snapshot.ssh.as_ref()),
            snapshot.api_key_env,
            extra_headers_json,
            token_usages_json,
            snapshot.config_version,
            snapshot.orchestrator_compaction_threshold,
            stored_ssh_port(snapshot.ssh.as_ref()),
            stored_ssh_identity_file(snapshot.ssh.as_ref()),
            light_model_json,
            snapshot.behavior.as_str(),
        ],
    )?;
    Ok(())
}

struct SessionRow {
    session_id: String,
    project_id: Option<String>,
    cwd: String,
    model: String,
    base_url: String,
    allow_insecure_http: bool,
    backend: Option<String>,
    reasoning_effort: Option<String>,
    sandbox_json: Option<String>,
    messages_json: String,
    last_response_duration_ms: Option<u64>,
    previous_response_duration_ms: Option<u64>,
    response_durations_ms_json: Option<String>,
    created_at: String,
    updated_at: String,
    ssh_host: Option<String>,
    api_key_env: Option<String>,
    extra_headers_json: Option<String>,
    token_usages_json: Option<String>,
    config_version: i64,
    orchestrator_compaction_threshold: Option<u64>,
    ssh_port: Option<u16>,
    ssh_identity_file: Option<String>,
    light_model_json: Option<String>,
    behavior: String,
}

impl SessionRow {
    fn into_snapshot(self) -> Result<SessionSnapshot> {
        let messages = serde_json::from_str(&self.messages_json)
            .context("failed to parse stored session messages")?;
        let response_durations_ms = self
            .response_durations_ms_json
            .map(|json| {
                serde_json::from_str::<Vec<Option<u64>>>(&json)
                    .context("failed to parse stored session response durations")
            })
            .transpose()?;
        let base_url = self.base_url;
        let backend = parse_backend(self.backend)?;
        let extra_headers = parse_extra_headers(self.extra_headers_json.as_deref())?;
        let (token_usages, unattributed_token_usage) =
            deserialize_token_accounting(self.token_usages_json.as_deref())?;
        Ok(SessionSnapshot {
            session_id: self.session_id,
            behavior: self.behavior.parse()?,
            project_id: self.project_id,
            cwd: PathBuf::from(self.cwd),
            model: self.model,
            base_url,
            allow_insecure_http: self.allow_insecure_http,
            backend,
            reasoning_effort: parse_reasoning_effort(self.reasoning_effort)?,
            sandbox_spec: deserialize_sandbox(self.sandbox_json)?,
            ssh: stored_ssh_connection(self.ssh_host, self.ssh_port, self.ssh_identity_file),
            api_key_env: self.api_key_env,
            extra_headers,
            light_model: deserialize_light_model(self.light_model_json.as_deref())?,
            orchestrator_compaction_threshold: validate_stored_compaction_threshold(
                self.orchestrator_compaction_threshold,
            )?,
            config_version: self.config_version,
            messages,
            last_response_duration_ms: self.last_response_duration_ms,
            previous_response_duration_ms: self.previous_response_duration_ms,
            response_durations_ms,
            token_usages,
            unattributed_token_usage,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn validate_stored_compaction_threshold(threshold: Option<u64>) -> Result<Option<u64>> {
    if threshold.is_some_and(|value| value > crate::MAX_SUPPORTED_TOKEN_COUNT) {
        return Err(anyhow!(
            "stored orchestrator compaction threshold exceeds supported maximum {}",
            crate::MAX_SUPPORTED_TOKEN_COUNT
        ));
    }
    Ok(threshold)
}

fn model_config_diagnostics(
    backend: Option<&str>,
    reasoning_effort: Option<&str>,
    extra_headers_json: Option<&str>,
) -> Vec<String> {
    let mut diagnostics = Vec::new();
    match backend {
        Some(raw) => {
            if let Err(error) = raw.parse::<BackendKind>() {
                diagnostics.push(format!("unsupported stored backend '{raw}': {error}"));
            }
        }
        None => diagnostics.push("stored session has no backend".to_string()),
    }
    if let Some(raw) = reasoning_effort {
        if parse_reasoning_effort(Some(raw.to_string())).is_err() {
            diagnostics.push(format!("unsupported stored reasoning effort '{raw}'"));
        }
    }
    if let Some(raw) = extra_headers_json.filter(|raw| !raw.is_empty()) {
        if let Err(error) = serde_json::from_str::<BTreeMap<String, String>>(raw) {
            diagnostics.push(format!("malformed stored extra headers: {error}"));
        }
    }
    diagnostics
}

fn parse_extra_headers(raw: Option<&str>) -> Result<BTreeMap<String, String>> {
    raw.filter(|json| !json.is_empty())
        .map(|json| {
            serde_json::from_str::<BTreeMap<String, String>>(json)
                .context("failed to parse stored session extra_headers")
        })
        .transpose()
        .map(Option::unwrap_or_default)
}

fn parse_backend(raw: Option<String>) -> Result<BackendKind> {
    let raw = raw.ok_or_else(|| {
        anyhow!(
            "stored session has no backend; session settings repair required: select an explicit backend"
        )
    })?;
    raw.parse::<BackendKind>().map_err(|error| {
        anyhow!("unsupported stored backend '{raw}'; session settings repair required: {error}")
    })
}

fn stored_ssh_host(connection: Option<&SshConnection>) -> Option<String> {
    connection.map(|connection| connection.host.clone())
}

fn stored_ssh_port(connection: Option<&SshConnection>) -> Option<u16> {
    connection.and_then(|connection| connection.port)
}

fn stored_ssh_identity_file(connection: Option<&SshConnection>) -> Option<String> {
    connection.and_then(|connection| {
        connection
            .identity_file
            .as_ref()
            .map(|path| path.display().to_string())
    })
}

/// The connection a session row describes, or `None` for a local session.
///
/// The host name is what decides: a row without one is local, whatever the port
/// and key columns happen to hold.
fn stored_ssh_connection(
    host: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
) -> Option<SshConnection> {
    host.map(|host| SshConnection {
        host,
        port,
        identity_file: identity_file.map(PathBuf::from),
    })
}

fn parse_reasoning_effort(raw: Option<String>) -> Result<Option<ReasoningEffort>> {
    match raw.as_deref() {
        Some("none") => Ok(Some(ReasoningEffort::None)),
        Some("minimal") => Ok(Some(ReasoningEffort::Minimal)),
        Some("low") => Ok(Some(ReasoningEffort::Low)),
        Some("medium") => Ok(Some(ReasoningEffort::Medium)),
        Some("high") => Ok(Some(ReasoningEffort::High)),
        Some("xhigh") => Ok(Some(ReasoningEffort::Xhigh)),
        Some("max") => Ok(Some(ReasoningEffort::Max)),
        Some(other) => Err(anyhow!(
            "unsupported stored reasoning effort '{other}'; session settings repair required: select a supported reasoning effort or clear it"
        )),
        None => Ok(None),
    }
}

#[cfg(test)]
mod backend_tests {
    use super::*;

    #[test]
    fn stored_backend_parser_accepts_current_explicit_backends() {
        assert_eq!(
            parse_backend(Some("openai-chat-completions".to_string())).unwrap(),
            BackendKind::OpenAiChatCompletions
        );
        assert_eq!(
            parse_backend(Some("arcee-auth".to_string())).unwrap(),
            BackendKind::ArceeAuth
        );
        assert_eq!(
            parse_backend(Some("arcee-api".to_string())).unwrap(),
            BackendKind::ArceeApi
        );
    }

    #[test]
    fn stored_backend_parser_rejects_missing_backend_without_inference() {
        let error = parse_backend(None).unwrap_err().to_string();
        assert!(error.contains("no backend"), "{error}");
        assert!(error.contains("settings repair required"), "{error}");
    }

    #[test]
    fn stored_backend_parser_rejects_removed_names_without_migration() {
        for raw in ["arcee", "auto"] {
            let error = parse_backend(Some(raw.to_string()))
                .unwrap_err()
                .to_string();
            assert!(error.contains("unsupported stored backend"), "{error}");
            assert!(error.contains("settings repair required"), "{error}");
        }
    }
}
