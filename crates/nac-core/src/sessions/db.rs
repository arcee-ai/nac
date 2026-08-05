use super::*;

pub fn create_session(path: &Path, snapshot: &SessionSnapshot) -> Result<()> {
    let mut conn = crate::store::open_connection(path)?;
    let tx = conn.transaction()?;

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

    insert_or_replace_session(&tx, path, snapshot)?;
    tx.commit()?;
    Ok(())
}

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
    let token_usages_json = if update.run_state.token_usages.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(&update.run_state.token_usages)
                .context("failed to serialize session token usages")?,
        )
    };

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
             host_id = ?7
         WHERE session_id = ?8",
        params![
            sandbox_json,
            update.run_state.last_response_duration_ms,
            update.run_state.previous_response_duration_ms,
            response_durations_ms_json,
            token_usages_json,
            update.updated_at,
            update.ssh_host,
            update.session_id,
        ],
    )?;
    if updated == 0 {
        return Err(anyhow!(
            "session '{}' was not found for the run-state save",
            update.session_id
        ));
    }
    tx.commit()?;
    Ok(())
}

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
            backend: Some(snapshot.backend.as_str().to_string()),
            reasoning_effort: snapshot
                .reasoning_effort
                .map(|effort| effort.as_str().to_string()),
            api_key_env: snapshot.api_key_env.clone(),
            extra_headers_json,
            orchestrator_compaction_threshold: snapshot.orchestrator_compaction_threshold,
            config_version: snapshot.config_version,
            diagnostics: Vec::new(),
        },
    )
}

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

    let mut conn = crate::store::open_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let updated = tx.execute(
        "UPDATE sessions
         SET model = ?1,
             base_url = ?2,
             backend = ?3,
             reasoning_effort = ?4,
             api_key_env = ?5,
             extra_headers_json = ?6,
             orchestrator_compaction_threshold = ?7,
             config_version = ?8
         WHERE session_id = ?9 AND config_version = ?10",
        params![
            config.model,
            config.base_url,
            config.backend,
            config.reasoning_effort,
            config.api_key_env,
            config.extra_headers_json,
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

pub fn load_session(path: &Path, session_id: &str) -> Result<SessionSnapshot> {
    let conn = crate::store::open_connection(path)?;
    let row = conn
        .query_row(
            "SELECT session_id, cwd, model, base_url, backend, reasoning_effort, sandbox_json, messages_json, last_response_duration_ms, previous_response_duration_ms, response_durations_ms_json, created_at, updated_at, host_id, api_key_env, extra_headers_json, token_usages_json, config_version, orchestrator_compaction_threshold
             FROM sessions
             WHERE session_id = ?1",
            params![session_id],
            map_session_row,
        )
        .optional()?;

    let Some(row) = row else {
        return Err(anyhow!("session '{}' was not found", session_id));
    };

    row.into_snapshot()
}

pub fn load_session_config(path: &Path, session_id: &str) -> Result<RawSessionConfig> {
    let conn = crate::store::open_connection(path)?;
    let row = conn
        .query_row(
            "SELECT session_id, model, base_url, backend, reasoning_effort, api_key_env, extra_headers_json, config_version, orchestrator_compaction_threshold
             FROM sessions
             WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok(RawSessionConfig {
                    session_id: row.get(0)?,
                    model: row.get(1)?,
                    base_url: row.get(2)?,
                    backend: row.get(3)?,
                    reasoning_effort: row.get(4)?,
                    api_key_env: row.get(5)?,
                    extra_headers_json: row.get(6)?,
                    config_version: row.get(7)?,
                    orchestrator_compaction_threshold: row.get(8)?,
                    diagnostics: Vec::new(),
                })
            },
        )
        .optional()?;

    let Some(mut config) = row else {
        return Err(anyhow!("session '{}' was not found", session_id));
    };
    config.orchestrator_compaction_threshold =
        validate_stored_compaction_threshold(config.orchestrator_compaction_threshold)?;
    config.diagnostics = model_config_diagnostics(
        config.backend.as_deref(),
        config.reasoning_effort.as_deref(),
        config.extra_headers_json.as_deref(),
    );
    Ok(config)
}

pub fn load_last_session(path: &Path) -> Result<SessionSnapshot> {
    let conn = crate::store::open_connection(path)?;
    let row = conn
        .query_row(
            "SELECT session_id, cwd, model, base_url, backend, reasoning_effort, sandbox_json, messages_json, last_response_duration_ms, previous_response_duration_ms, response_durations_ms_json, created_at, updated_at, host_id, api_key_env, extra_headers_json, token_usages_json, config_version, orchestrator_compaction_threshold
             FROM sessions
             ORDER BY updated_at DESC, created_at DESC
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

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        session_id: row.get(0)?,
        cwd: row.get(1)?,
        model: row.get(2)?,
        base_url: row.get(3)?,
        backend: row.get(4)?,
        reasoning_effort: row.get(5)?,
        sandbox_json: row.get(6)?,
        messages_json: row.get(7)?,
        last_response_duration_ms: row.get(8)?,
        previous_response_duration_ms: row.get(9)?,
        response_durations_ms_json: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        ssh_host: row.get(13)?,
        api_key_env: row.get(14)?,
        extra_headers_json: row.get(15)?,
        token_usages_json: row.get(16)?,
        config_version: row.get(17)?,
        orchestrator_compaction_threshold: row.get(18)?,
    })
}

pub fn list_sessions(path: &Path) -> Result<Vec<SessionSummary>> {
    let conn = crate::store::open_runtime_connection(path)?;
    list_sessions_with_connection(&conn)
}

pub(crate) fn list_sessions_with_connection(
    conn: &rusqlite::Connection,
) -> Result<Vec<SessionSummary>> {
    query_session_summaries(conn, None)
}

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
       s.token_usages_json, COALESCE(s.run_count, 0)
FROM sessions s
LEFT JOIN session_presentations p ON p.session_id = s.session_id
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
        let workspace_host_path = if self.ssh_host.is_some() {
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
        let total_tokens = parse_token_usages(self.token_usages_json.as_deref())?
            .as_deref()
            .and_then(crate::model::TokenUsage::aggregate)
            .map(|usage| usage.billable_tokens());
        Ok(SessionSummary {
            session_id: self.session_id,
            cwd,
            workspace_host_path,
            model: self.model,
            backend,
            model_config_error: (!diagnostics.is_empty()).then(|| diagnostics.join("; ")),
            visible_message_count,
            last_user_prompt: self.last_user_prompt,
            sandboxed,
            ssh_host: self.ssh_host,
            title: self.title,
            pinned: self.pinned,
            sort_order: self.sort_order,
            presentation_version: self.presentation_version,
            created_at: self.created_at,
            updated_at: self.updated_at,
            total_tokens,
            run_count: self.run_count.max(0) as u64,
        })
    }
}

/// Shared by the snapshot and summary readers; legacy rows store NULL or an
/// empty string and must load as "no usage recorded".
fn parse_token_usages(json: Option<&str>) -> Result<Option<Vec<Option<crate::model::TokenUsage>>>> {
    json.filter(|json| !json.is_empty())
        .map(|json| {
            serde_json::from_str::<Vec<Option<crate::model::TokenUsage>>>(json)
                .context("failed to parse stored session token usages")
        })
        .transpose()
}

fn insert_or_replace_session(
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
    let token_usages_json = if snapshot.token_usages.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(&snapshot.token_usages)
                .context("failed to serialize session token usages")?,
        )
    };

    // The legacy `store_path` column is kept physically (NOT NULL in existing
    // stores) but is informational only: it records the store that was
    // actually opened for this write and is never read back.
    tx.execute(
        "INSERT INTO sessions (
             session_id, cwd, store_path, model, base_url, backend, reasoning_effort,
             sandbox_json, messages_json, visible_message_count, last_user_prompt,
             last_response_duration_ms, previous_response_duration_ms,
             response_durations_ms_json, created_at, updated_at, host_id, api_key_env,
             extra_headers_json, token_usages_json, config_version,
             orchestrator_compaction_threshold
         ) VALUES (
             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
             ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22
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
             token_usages_json = excluded.token_usages_json",
        params![
            snapshot.session_id,
            snapshot.cwd.display().to_string(),
            path.display().to_string(),
            snapshot.model,
            snapshot.base_url,
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
            snapshot.ssh_host,
            snapshot.api_key_env,
            extra_headers_json,
            token_usages_json,
            snapshot.config_version,
            snapshot.orchestrator_compaction_threshold,
        ],
    )?;
    Ok(())
}

struct SessionRow {
    session_id: String,
    cwd: String,
    model: String,
    base_url: String,
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
        let token_usages =
            parse_token_usages(self.token_usages_json.as_deref())?.unwrap_or_default();
        Ok(SessionSnapshot {
            session_id: self.session_id,
            cwd: PathBuf::from(self.cwd),
            model: self.model,
            base_url,
            backend,
            reasoning_effort: parse_reasoning_effort(self.reasoning_effort)?,
            sandbox_spec: deserialize_sandbox(self.sandbox_json)?,
            ssh_host: self.ssh_host,
            api_key_env: self.api_key_env,
            extra_headers,
            orchestrator_compaction_threshold: validate_stored_compaction_threshold(
                self.orchestrator_compaction_threshold,
            )?,
            config_version: self.config_version,
            messages,
            last_response_duration_ms: self.last_response_duration_ms,
            previous_response_duration_ms: self.previous_response_duration_ms,
            response_durations_ms,
            token_usages,
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
        anyhow!(
            "unsupported stored backend '{}'; session settings repair required: {}",
            raw,
            error
        )
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
        Some(other) => Err(anyhow!(
            "unsupported stored reasoning effort '{}'; session settings repair required: select a supported reasoning effort or clear it",
            other
        )),
        None => Ok(None),
    }
}

#[cfg(test)]
mod backend_tests {
    use super::*;

    #[test]
    fn stored_backend_parser_accepts_explicit_arcee_modes() {
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
