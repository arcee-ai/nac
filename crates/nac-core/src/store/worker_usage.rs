use super::*;
use crate::events::ThreadDispatchStatus;
use crate::model::TokenUsage;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerUsageIdentity {
    pub session_id: String,
    pub origin_run_id: String,
    pub dispatch_id: String,
    pub thread_name: String,
    pub originating_tool_call_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerUsageRecord {
    pub identity: WorkerUsageIdentity,
    pub usage: TokenUsage,
    pub terminal_status: Option<ThreadDispatchStatus>,
    pub created_at: String,
    pub updated_at: String,
}

fn terminal_status_text(status: Option<ThreadDispatchStatus>) -> Result<Option<&'static str>> {
    match status {
        None => Ok(None),
        Some(ThreadDispatchStatus::Completed) => Ok(Some("completed")),
        Some(ThreadDispatchStatus::Failed) => Ok(Some("failed")),
        Some(ThreadDispatchStatus::Cancelled) => Ok(Some("cancelled")),
        Some(other) => Err(anyhow!(
            "worker usage terminal status must be completed, failed, or cancelled, not {other:?}"
        )),
    }
}

fn parse_terminal_status(status: Option<String>) -> Result<Option<ThreadDispatchStatus>> {
    match status.as_deref() {
        None => Ok(None),
        Some("completed") => Ok(Some(ThreadDispatchStatus::Completed)),
        Some("failed") => Ok(Some(ThreadDispatchStatus::Failed)),
        Some("cancelled") => Ok(Some(ThreadDispatchStatus::Cancelled)),
        Some(other) => Err(anyhow!("invalid stored worker terminal status '{other}'")),
    }
}

/// Replaces the durable cumulative usage total for one exact dispatch.
///
/// The dispatch id is the idempotency key. Existing rows must have the same
/// complete identity, and terminal state is monotonic. Repeating either a live
/// upsert or finalization is therefore safe and never adds usage twice.
pub fn upsert_worker_dispatch_usage_total(
    path: &Path,
    identity: &WorkerUsageIdentity,
    usage: &TokenUsage,
    terminal_status: Option<ThreadDispatchStatus>,
) -> Result<()> {
    for (field, value) in [
        ("session_id", identity.session_id.as_str()),
        ("origin_run_id", identity.origin_run_id.as_str()),
        ("dispatch_id", identity.dispatch_id.as_str()),
        ("thread_name", identity.thread_name.as_str()),
        (
            "originating_tool_call_id",
            identity.originating_tool_call_id.as_str(),
        ),
    ] {
        if value.is_empty() {
            return Err(anyhow!("worker usage identity {field} must not be empty"));
        }
    }
    let terminal_status = terminal_status_text(terminal_status)?;
    let usage_json = serde_json::to_string(usage).context("failed to serialize worker usage")?;
    let now = now_utc();
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let existing = tx
        .query_row(
            "SELECT origin_run_id, thread_name, originating_tool_call_id, terminal_status
             FROM session_worker_usage
             WHERE session_id = ?1 AND dispatch_id = ?2",
            params![identity.session_id, identity.dispatch_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    if let Some((origin_run_id, thread_name, tool_call_id, stored_terminal)) = existing {
        if origin_run_id != identity.origin_run_id
            || thread_name != identity.thread_name
            || tool_call_id != identity.originating_tool_call_id
        {
            return Err(anyhow!(
                "worker usage identity conflict for session '{}' dispatch '{}'",
                identity.session_id,
                identity.dispatch_id
            ));
        }
        if let (Some(stored), Some(requested)) = (stored_terminal.as_deref(), terminal_status) {
            if stored != requested {
                return Err(anyhow!(
                    "worker usage terminal status conflict for session '{}' dispatch '{}': stored {stored}, requested {requested}",
                    identity.session_id,
                    identity.dispatch_id
                ));
            }
        }
        tx.execute(
            "UPDATE session_worker_usage
             SET usage_json = ?1,
                 terminal_status = COALESCE(terminal_status, ?2),
                 updated_at = ?3
             WHERE session_id = ?4 AND dispatch_id = ?5",
            params![
                usage_json,
                terminal_status,
                now,
                identity.session_id,
                identity.dispatch_id
            ],
        )?;
    } else {
        tx.execute(
            "INSERT INTO session_worker_usage
                 (session_id, origin_run_id, dispatch_id, thread_name,
                  originating_tool_call_id, usage_json, terminal_status,
                  created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                identity.session_id,
                identity.origin_run_id,
                identity.dispatch_id,
                identity.thread_name,
                identity.originating_tool_call_id,
                usage_json,
                terminal_status,
                now,
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn finalize_worker_dispatch_usage(
    path: &Path,
    identity: &WorkerUsageIdentity,
    usage: Option<&TokenUsage>,
    terminal_status: ThreadDispatchStatus,
) -> Result<()> {
    let usage = match usage {
        Some(usage) => usage.clone(),
        None => load_session_worker_usage(path, &identity.session_id)?
            .into_iter()
            .find(|record| record.identity.dispatch_id == identity.dispatch_id)
            .map(|record| record.usage)
            .unwrap_or_default(),
    };
    upsert_worker_dispatch_usage_total(path, identity, &usage, Some(terminal_status))
}

pub fn load_session_worker_usage(path: &Path, session_id: &str) -> Result<Vec<WorkerUsageRecord>> {
    let conn = open_runtime_connection(path)?;
    load_session_worker_usage_with_connection(&conn, session_id)
}

fn load_session_worker_usage_with_connection(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<WorkerUsageRecord>> {
    let mut statement = conn.prepare(
        "SELECT origin_run_id, dispatch_id, thread_name, originating_tool_call_id,
                usage_json, terminal_status, created_at, updated_at
         FROM session_worker_usage
         WHERE session_id = ?1
         ORDER BY created_at, dispatch_id",
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
        ))
    })?;
    rows.map(|row| {
        let (
            origin_run_id,
            dispatch_id,
            thread_name,
            tool_call_id,
            usage_json,
            status,
            created_at,
            updated_at,
        ) = row?;
        Ok(WorkerUsageRecord {
            identity: WorkerUsageIdentity {
                session_id: session_id.to_string(),
                origin_run_id,
                dispatch_id,
                thread_name,
                originating_tool_call_id: tool_call_id,
            },
            usage: serde_json::from_str(&usage_json)
                .context("failed to parse stored worker usage")?,
            terminal_status: parse_terminal_status(status)?,
            created_at,
            updated_at,
        })
    })
    .collect()
}

/// Sums billable worker fields while deliberately leaving the orchestrator
/// context gauge at zero.
pub fn aggregate_session_worker_usage(path: &Path, session_id: &str) -> Result<Option<TokenUsage>> {
    let conn = open_runtime_connection(path)?;
    aggregate_session_worker_usage_with_connection(&conn, session_id)
}

pub(crate) fn aggregate_session_worker_usage_with_connection(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Option<TokenUsage>> {
    let rows = load_session_worker_usage_with_connection(conn, session_id)?;
    if rows.is_empty() {
        return Ok(None);
    }
    let mut total = TokenUsage::default();
    for row in rows {
        total.add_cost_saturating(&row.usage);
    }
    Ok(Some(total))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_worker_usage_{label}_{unique}"))
            .join("store.db")
    }

    fn identity(session_id: &str) -> WorkerUsageIdentity {
        WorkerUsageIdentity {
            session_id: session_id.into(),
            origin_run_id: "origin-run".into(),
            dispatch_id: "dispatch".into(),
            thread_name: "worker".into(),
            originating_tool_call_id: "tool-call".into(),
        }
    }

    fn usage(input: u64, context: u64) -> TokenUsage {
        TokenUsage {
            input_tokens: input,
            output_tokens: input + 1,
            orchestrator_context_tokens: context,
            ..TokenUsage::default()
        }
    }

    #[test]
    fn cumulative_upsert_and_finalization_are_idempotent_and_context_is_not_aggregated() {
        let path = temp_store("idempotent");
        initialize(&path).unwrap();
        insert_test_session(&path, "session");
        let key = identity("session");
        upsert_worker_dispatch_usage_total(&path, &key, &usage(2, 100), None).unwrap();
        upsert_worker_dispatch_usage_total(&path, &key, &usage(5, 200), None).unwrap();
        upsert_worker_dispatch_usage_total(
            &path,
            &key,
            &usage(5, 200),
            Some(ThreadDispatchStatus::Completed),
        )
        .unwrap();
        upsert_worker_dispatch_usage_total(
            &path,
            &key,
            &usage(5, 200),
            Some(ThreadDispatchStatus::Completed),
        )
        .unwrap();

        let rows = load_session_worker_usage(&path, "session").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].usage, usage(5, 200));
        assert_eq!(
            rows[0].terminal_status,
            Some(ThreadDispatchStatus::Completed)
        );
        let total = aggregate_session_worker_usage(&path, "session")
            .unwrap()
            .unwrap();
        assert_eq!(total.input_tokens, 5);
        assert_eq!(total.output_tokens, 6);
        assert_eq!(total.orchestrator_context_tokens, 0);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn dispatch_identity_and_terminal_status_conflicts_do_not_mutate_row() {
        let path = temp_store("conflict");
        initialize(&path).unwrap();
        insert_test_session(&path, "session");
        let key = identity("session");
        upsert_worker_dispatch_usage_total(
            &path,
            &key,
            &usage(3, 30),
            Some(ThreadDispatchStatus::Cancelled),
        )
        .unwrap();
        let mut forged = key.clone();
        forged.originating_tool_call_id = "forged".into();
        assert!(upsert_worker_dispatch_usage_total(&path, &forged, &usage(9, 90), None).is_err());
        assert!(upsert_worker_dispatch_usage_total(
            &path,
            &key,
            &usage(9, 90),
            Some(ThreadDispatchStatus::Failed),
        )
        .is_err());
        let rows = load_session_worker_usage(&path, "session").unwrap();
        assert_eq!(rows[0].usage, usage(3, 30));
        assert_eq!(
            rows[0].terminal_status,
            Some(ThreadDispatchStatus::Cancelled)
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn late_usage_survives_reopen_and_concurrent_origin_snapshot_save() {
        let path = temp_store("late_reopen_concurrent_save");
        initialize(&path).unwrap();
        insert_test_session(&path, "session");
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET backend = 'openai-responses' WHERE session_id = 'session'",
                [],
            )
            .unwrap();
        let origin_snapshot = crate::sessions::load_session(&path, "session").unwrap();
        let key = identity("session");

        // Model the origin response being saved before the worker reports its
        // late cumulative usage. Reopening through a new connection must not
        // depend on any in-memory registry state.
        crate::sessions::save_session(&path, &origin_snapshot).unwrap();
        upsert_worker_dispatch_usage_total(&path, &key, &usage(4, 40), None).unwrap();
        drop(open_runtime_connection(&path).unwrap());
        assert_eq!(
            load_session_worker_usage(&path, "session").unwrap()[0].usage,
            usage(4, 40)
        );

        // A stale origin snapshot save and worker finalization use independent
        // tables and serialize without either update replacing the other.
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let save_path = path.clone();
        let save_barrier = barrier.clone();
        let save = std::thread::spawn(move || {
            save_barrier.wait();
            crate::sessions::save_session(&save_path, &origin_snapshot)
        });
        let usage_path = path.clone();
        let usage_barrier = barrier.clone();
        let finalize = std::thread::spawn(move || {
            usage_barrier.wait();
            upsert_worker_dispatch_usage_total(
                &usage_path,
                &key,
                &usage(7, 70),
                Some(ThreadDispatchStatus::Completed),
            )
        });
        save.join().unwrap().unwrap();
        finalize.join().unwrap().unwrap();

        let reopened = load_session_worker_usage(&path, "session").unwrap();
        assert_eq!(reopened.len(), 1);
        assert_eq!(reopened[0].usage, usage(7, 70));
        assert_eq!(
            reopened[0].terminal_status,
            Some(ThreadDispatchStatus::Completed)
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn thread_delete_and_transcript_revert_retain_worker_usage() {
        let path = temp_store("thread_delete_revert_retains");
        initialize(&path).unwrap();
        insert_test_session(&path, "session");
        append_episode(&path, "session", "worker", "work", "retained episode").unwrap();
        let key = identity("session");
        upsert_worker_dispatch_usage_total(
            &path,
            &key,
            &usage(6, 60),
            Some(ThreadDispatchStatus::Completed),
        )
        .unwrap();

        assert!(delete_thread(&path, "session", "worker").unwrap());
        assert_eq!(
            load_session_worker_usage(&path, "session").unwrap().len(),
            1
        );

        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch(
                "session",
                0,
                &[
                    crate::types::Message::User {
                        content: "keep".into(),
                    },
                    crate::types::Message::Assistant {
                        content: Some("revert me".into()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: None,
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                ],
            )
            .unwrap();
        writer.delete_from("session", 1).unwrap();
        let retained = load_session_worker_usage(&path, "session").unwrap();
        assert_eq!(retained.len(), 1);
        assert_eq!(retained[0].identity, key);
        assert_eq!(retained[0].usage, usage(6, 60));
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn worker_usage_cascades_only_with_owning_session() {
        let path = temp_store("cascade");
        initialize(&path).unwrap();
        insert_test_session(&path, "session");
        upsert_worker_dispatch_usage_total(&path, &identity("session"), &usage(1, 1), None)
            .unwrap();
        assert!(crate::sessions::delete_session(&path, "session").unwrap());
        assert!(load_session_worker_usage(&path, "session")
            .unwrap()
            .is_empty());
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
