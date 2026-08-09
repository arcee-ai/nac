use super::*;
use crate::model::{resolve_backend_api_key, validate_backend_api_key_env, BackendKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionLineageRecord {
    pub child_session_id: String,
    pub source_session_id: String,
    pub source_raw_end_exclusive: u64,
    pub source_prefix_sha256: String,
    pub source_boundary_event_id: Option<i64>,
    pub source_config_version: i64,
    pub created_at: String,
}

/// Atomically revalidates an opaque boundary and creates a clean child.
/// `source_active_run` is supplied by the operation-lease owner; historical
/// committed boundaries remain usable while only the current cycle is mutable.
pub fn create_session_fork(
    path: &Path,
    source_session_id: &str,
    child_session_id: &str,
    boundary_token: &str,
    source_active_run: bool,
) -> Result<SessionLineageRecord> {
    if child_session_id.trim().is_empty() {
        return Err(anyhow!("fork child session id must not be blank"));
    }
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    let (boundary, prefix) = validate_fork_boundary_in_connection(
        &tx,
        source_session_id,
        boundary_token,
        source_active_run,
    )
    .map_err(anyhow::Error::new)?;

    let source = tx
        .query_row(
            "SELECT cwd, model, base_url, backend, reasoning_effort, sandbox_json,
                    host_id, api_key_env, extra_headers_json,
                    orchestrator_compaction_threshold, ssh_port, ssh_identity_file,
                    config_version
             FROM sessions WHERE session_id = ?1",
            params![source_session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<u64>>(9)?,
                    row.get::<_, Option<u16>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, i64>(12)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("source session '{source_session_id}' does not exist"))?;

    let (
        cwd,
        model,
        base_url,
        backend_raw,
        reasoning_raw,
        sandbox_json,
        host_id,
        api_key_env,
        extra_headers_json,
        compaction_threshold,
        ssh_port,
        ssh_identity_file,
        source_config_version,
    ) = source;
    let backend_raw = backend_raw.ok_or_else(|| anyhow!("source session has no backend"))?;
    let backend: BackendKind = backend_raw
        .parse()
        .map_err(|error: String| anyhow!("source session has invalid backend: {error}"))?;
    if model.trim().is_empty() {
        return Err(anyhow!("source session has a blank model"));
    }
    let parsed_url = url::Url::parse(&base_url).context("source session has invalid base URL")?;
    if !matches!(parsed_url.scheme(), "http" | "https") || parsed_url.host_str().is_none() {
        return Err(anyhow!("source session has invalid base URL"));
    }
    if let Some(raw) = reasoning_raw.as_deref() {
        if !matches!(
            raw,
            "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
        ) {
            return Err(anyhow!("source session has invalid reasoning effort"));
        }
    }
    crate::sessions::codec::deserialize_sandbox(sandbox_json.clone())
        .context("source session has invalid sandbox specification")?;
    if let Some(raw) = extra_headers_json.as_deref() {
        serde_json::from_str::<std::collections::BTreeMap<String, String>>(raw)
            .context("source session has invalid extra headers")?;
    }
    // Resolve only selector-based API keys. Managed OAuth credentials are
    // referenced globally by backend and are never read into or copied to the
    // child row.
    validate_backend_api_key_env(backend, api_key_env.as_deref())?;
    if api_key_env.is_some() {
        let _ = resolve_backend_api_key(backend, api_key_env.as_deref())?;
    }

    let messages_json = serde_json::to_string(&prefix)?;
    let visible = i64::try_from(crate::sessions::visible_message_count(&prefix))?;
    let last_user = crate::sessions::last_user_prompt(&prefix);
    let created_at = now_utc();
    tx.execute(
        "INSERT INTO sessions (
             session_id, cwd, store_path, model, base_url, backend,
             reasoning_effort, sandbox_json, messages_json,
             visible_message_count, last_user_prompt, host_id, api_key_env,
             extra_headers_json, orchestrator_compaction_threshold,
             ssh_port, ssh_identity_file, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                   ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)",
        params![
            child_session_id,
            cwd,
            path.display().to_string(),
            model,
            base_url,
            backend_raw,
            reasoning_raw,
            sandbox_json,
            messages_json,
            visible,
            last_user,
            host_id,
            api_key_env,
            extra_headers_json,
            compaction_threshold,
            ssh_port,
            ssh_identity_file,
            created_at
        ],
    )?;
    tx.execute(
        "INSERT INTO session_lineage (
             child_session_id, source_session_id, source_raw_end_exclusive,
             source_prefix_sha256, source_boundary_event_id,
             source_config_version, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            child_session_id,
            source_session_id,
            boundary.raw_end_exclusive,
            boundary.prefix_sha256,
            boundary.boundary_event_id,
            source_config_version,
            created_at
        ],
    )?;
    tx.commit()?;
    Ok(SessionLineageRecord {
        child_session_id: child_session_id.to_string(),
        source_session_id: source_session_id.to_string(),
        source_raw_end_exclusive: boundary.raw_end_exclusive,
        source_prefix_sha256: boundary.prefix_sha256,
        source_boundary_event_id: boundary.boundary_event_id,
        source_config_version,
        created_at,
    })
}

pub(crate) fn credential_selector_is_referenced(path: &Path, name: &str) -> Result<bool> {
    let conn = open_runtime_connection(path)?;
    let referenced: i64 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE api_key_env = ?1)
              OR EXISTS(SELECT 1 FROM model_configurations WHERE api_key_env = ?1)",
        params![name],
        |row| row.get(0),
    )?;
    Ok(referenced != 0)
}

pub fn load_session_lineage(
    path: &Path,
    child_session_id: &str,
) -> Result<Option<SessionLineageRecord>> {
    let conn = open_runtime_connection(path)?;
    conn.query_row(
        "SELECT child_session_id, source_session_id, source_raw_end_exclusive,
                source_prefix_sha256, source_boundary_event_id,
                source_config_version, created_at
         FROM session_lineage WHERE child_session_id = ?1",
        params![child_session_id],
        |row| {
            Ok(SessionLineageRecord {
                child_session_id: row.get(0)?,
                source_session_id: row.get(1)?,
                source_raw_end_exclusive: row.get(2)?,
                source_prefix_sha256: row.get(3)?,
                source_boundary_event_id: row.get(4)?,
                source_config_version: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BackendKind;
    use crate::types::Message;

    fn assistant(content: &str) -> Message {
        Message::Assistant {
            content: Some(content.to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        }
    }

    #[test]
    fn atomic_fork_copies_only_prefix_and_durable_configuration() {
        let path = std::env::temp_dir().join(format!("nac_lineage_{}.db", uuid::Uuid::new_v4()));
        let mut snapshot = crate::sessions::new_snapshot(
            "source".into(),
            "/tmp/project".into(),
            "model".into(),
            "https://example.invalid".into(),
            BackendKind::ChatGptCodexResponses,
            None,
            None,
            None,
            vec![],
            None,
            Default::default(),
        );
        snapshot.config_version = 7;
        snapshot.orchestrator_compaction_threshold = Some(1234);
        crate::sessions::create_session(&path, &snapshot).unwrap();
        update_respond_live_preference(&path, "source", true, 0).unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch(
                "source",
                0,
                &[
                    Message::User {
                        content: "one".into(),
                    },
                    assistant("answer"),
                    Message::User {
                        content: "tail".into(),
                    },
                ],
            )
            .unwrap();
        let token = writer
            .fork_boundary_projection("source", false)
            .unwrap()
            .fork_boundary_tokens[1]
            .clone()
            .unwrap();

        crate::store::upsert_worker_dispatch_usage_total(
            &path,
            &crate::store::WorkerUsageIdentity {
                session_id: "source".into(),
                origin_run_id: "origin-run".into(),
                dispatch_id: "dispatch".into(),
                thread_name: "worker".into(),
                originating_tool_call_id: "call".into(),
            },
            &crate::model::TokenUsage {
                input_tokens: 11,
                ..Default::default()
            },
            Some(crate::events::ThreadDispatchStatus::Completed),
        )
        .unwrap();

        let lineage = create_session_fork(&path, "source", "child", &token, true).unwrap();
        assert_eq!(lineage.source_config_version, 7);
        let child = crate::sessions::load_session(&path, "child").unwrap();
        assert_eq!(child.messages.len(), 2);
        assert_eq!(child.config_version, 0);
        assert_eq!(child.orchestrator_compaction_threshold, Some(1234));
        assert!(child.token_usages.is_empty());
        assert_eq!(
            crate::store::load_session_worker_usage(&path, "source")
                .unwrap()
                .len(),
            1
        );
        assert!(crate::store::load_session_worker_usage(&path, "child")
            .unwrap()
            .is_empty());
        assert_eq!(
            load_respond_live_preference(&path, "source").unwrap(),
            RespondLivePreference {
                enabled: true,
                version: 1,
            }
        );
        assert_eq!(
            load_respond_live_preference(&path, "child").unwrap(),
            RespondLivePreference::default()
        );
        let conn = open_runtime_connection(&path).unwrap();
        let reset: (i64, i64, i64) = conn
            .query_row(
                "SELECT run_count,
                    (SELECT COUNT(*) FROM thread_events WHERE session_id = 'child'),
                    (SELECT COUNT(*) FROM workspace_revisions WHERE session_id = 'child')
             FROM sessions WHERE session_id = 'child'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(reset, (0, 0, 0));
        conn.execute(
            "UPDATE sessions SET api_key_env = 'REFERENCED_KEY' WHERE session_id = 'child'",
            [],
        )
        .unwrap();
        let error = crate::model::remove_api_key(&path, "REFERENCED_KEY").unwrap_err();
        assert!(error.to_string().contains("still referenced"));
    }

    #[test]
    fn fork_serializes_with_source_configuration_updates() {
        let path = std::env::temp_dir().join(format!("nac_lineage_{}.db", uuid::Uuid::new_v4()));
        let snapshot = crate::sessions::new_snapshot(
            "source".into(),
            "/tmp/project".into(),
            "old-model".into(),
            "https://example.invalid".into(),
            BackendKind::ChatGptCodexResponses,
            None,
            None,
            None,
            vec![],
            None,
            Default::default(),
        );
        crate::sessions::create_session(&path, &snapshot).unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch(
                "source",
                0,
                &[
                    Message::User {
                        content: "one".into(),
                    },
                    assistant("answer"),
                ],
            )
            .unwrap();
        let token = writer
            .fork_boundary_projection("source", false)
            .unwrap()
            .fork_boundary_tokens[1]
            .clone()
            .unwrap();

        let mut blocker = open_runtime_connection(&path).unwrap();
        let update = blocker
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        update.execute(
            "UPDATE sessions SET model = 'new-model', config_version = 9 WHERE session_id = 'source'",
            [],
        ).unwrap();
        let (sent, received) = std::sync::mpsc::channel();
        let fork_path = path.clone();
        std::thread::spawn(move || {
            sent.send(create_session_fork(
                &fork_path, "source", "child", &token, false,
            ))
            .unwrap();
        });
        assert!(received
            .recv_timeout(std::time::Duration::from_millis(100))
            .is_err());
        update.commit().unwrap();
        let lineage = received
            .recv_timeout(std::time::Duration::from_secs(6))
            .unwrap()
            .unwrap();
        assert_eq!(lineage.source_config_version, 9);
        assert_eq!(
            crate::sessions::load_session(&path, "child").unwrap().model,
            "new-model"
        );
    }

    #[test]
    fn failed_or_stale_fork_leaves_no_child_and_source_deletion_keeps_audit() {
        let path = std::env::temp_dir().join(format!("nac_lineage_{}.db", uuid::Uuid::new_v4()));
        let snapshot = crate::sessions::new_snapshot(
            "source".into(),
            "/tmp/project".into(),
            "model".into(),
            "https://example.invalid".into(),
            BackendKind::ChatGptCodexResponses,
            None,
            None,
            None,
            vec![],
            None,
            Default::default(),
        );
        crate::sessions::create_session(&path, &snapshot).unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch(
                "source",
                0,
                &[
                    Message::User {
                        content: "one".into(),
                    },
                    assistant("answer"),
                ],
            )
            .unwrap();
        let token = writer
            .fork_boundary_projection("source", false)
            .unwrap()
            .fork_boundary_tokens[1]
            .clone()
            .unwrap();
        writer.delete_from("source", 1).unwrap();
        assert!(create_session_fork(&path, "source", "bad", &token, false).is_err());
        assert!(!crate::sessions::session_exists(&path, "bad").unwrap());
        writer
            .append("source", 1, &assistant("replacement"))
            .unwrap();
        let fresh = writer
            .fork_boundary_projection("source", false)
            .unwrap()
            .fork_boundary_tokens[1]
            .clone()
            .unwrap();
        create_session_fork(&path, "source", "child", &fresh, false).unwrap();
        crate::sessions::delete_session(&path, "source").unwrap();
        assert!(crate::sessions::session_exists(&path, "child").unwrap());
        assert_eq!(
            load_session_lineage(&path, "child")
                .unwrap()
                .unwrap()
                .source_session_id,
            "source"
        );
    }
}
