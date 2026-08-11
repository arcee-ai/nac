use super::*;

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

const HISTORY_CANDIDATE_CHUNK: usize = 64;
const HISTORY_MAX_CANDIDATES: usize = 512;
const HISTORY_LABEL_CHARS: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HistoryNamespace {
    Session,
    Workspace,
    Store,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct HistorySessionAnchor {
    pub updated_at: String,
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct HistorySessionItem {
    pub session_id: String,
    pub display_label: String,
    pub created_at: String,
    pub updated_at: String,
    pub model: String,
    pub visible_message_count: usize,
    pub run_count: u64,
    pub orchestrator_message_count: usize,
    pub worker_stream_count: usize,
    pub retained_episode_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HistorySessionPage {
    pub sessions: Vec<HistorySessionItem>,
    pub next_anchor: Option<HistorySessionAnchor>,
    pub scan_exhausted: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum WorkspaceKey {
    Local(PathBuf),
    Ssh {
        host: String,
        port: Option<u16>,
        identity_file: Option<PathBuf>,
        cwd: PathBuf,
    },
}

struct HistorySessionRow {
    session_id: String,
    cwd: String,
    model: String,
    sandbox_json: Option<String>,
    created_at: String,
    updated_at: String,
    ssh_host: Option<String>,
    title: Option<String>,
    prompt_prefix: Option<String>,
    visible_message_count: i64,
    run_count: i64,
    ssh_port: Option<u16>,
    ssh_identity_file: Option<String>,
    orchestrator_message_count: i64,
    worker_stream_count: i64,
    retained_episode_count: i64,
}

impl HistorySessionRow {
    fn anchor(&self) -> HistorySessionAnchor {
        HistorySessionAnchor {
            updated_at: self.updated_at.clone(),
            session_id: self.session_id.clone(),
        }
    }

    fn workspace_key(&self) -> Result<WorkspaceKey> {
        let cwd = PathBuf::from(&self.cwd);
        if let Some(host) = self.ssh_host.as_ref() {
            return Ok(WorkspaceKey::Ssh {
                host: host.clone(),
                port: self.ssh_port,
                identity_file: self.ssh_identity_file.as_ref().map(PathBuf::from),
                cwd,
            });
        }
        let workspace = match self.sandbox_json.as_deref() {
            Some(json) => {
                let spec = deserialize_sandbox(Some(json.to_string()))?
                    .context("stored sandbox session had no sandbox specification")?;
                crate::sandbox::host_workdir_from_spec(&spec)
                    .context("stored sandbox workdir does not map to a host mount")?
            }
            None => cwd,
        };
        Ok(WorkspaceKey::Local(workspace))
    }

    fn into_item(self) -> Result<HistorySessionItem> {
        Ok(HistorySessionItem {
            display_label: display_label(
                self.title.as_deref(),
                self.prompt_prefix.as_deref(),
                &self.created_at,
                self.visible_message_count,
                &self.session_id,
            ),
            session_id: self.session_id,
            created_at: self.created_at,
            updated_at: self.updated_at,
            model: truncate_chars(&self.model, HISTORY_LABEL_CHARS),
            visible_message_count: nonnegative_usize(
                self.visible_message_count,
                "visible message count",
            )?,
            run_count: u64::try_from(self.run_count.max(0)).unwrap_or_default(),
            orchestrator_message_count: nonnegative_usize(
                self.orchestrator_message_count,
                "orchestrator message count",
            )?,
            worker_stream_count: nonnegative_usize(
                self.worker_stream_count,
                "worker stream count",
            )?,
            retained_episode_count: nonnegative_usize(
                self.retained_episode_count,
                "retained episode count",
            )?,
        })
    }
}

const HISTORY_SESSION_QUERY_HEAD: &str = r#"
SELECT s.session_id,
       s.cwd,
       s.model,
       s.sandbox_json,
       s.created_at,
       s.updated_at,
       s.host_id,
       p.title,
       substr(s.last_user_prompt, 1, 512),
       COALESCE(s.visible_message_count, 0),
       COALESCE(s.run_count, 0),
       s.ssh_port,
       s.ssh_identity_file,
       COALESCE(json_array_length(s.messages_json), 0) +
           (SELECT COUNT(*) FROM thread_events te
            WHERE te.session_id = s.session_id
              AND te.thread_name = '__orchestrator__'
              AND CASE
                  WHEN json_valid(te.event_json) = 0 THEN 0
                  WHEN json_type(te.event_json, '$.nac_transcript_message.idx')
                      IS NOT 'integer' THEN 0
                  WHEN json_extract(te.event_json, '$.nac_transcript_message.idx') < 0 THEN 0
                  WHEN json_extract(te.event_json, '$.nac_transcript_message.idx') >=
                      COALESCE(json_array_length(s.messages_json), 0) THEN 1
                  ELSE 0
              END),
       (SELECT COUNT(DISTINCT te.thread_name) FROM thread_events te
        WHERE te.session_id = s.session_id AND te.thread_name != '__orchestrator__'),
       (SELECT COUNT(*) FROM episodes e WHERE e.session_id = s.session_id)
FROM sessions s
LEFT JOIN session_presentations p ON p.session_id = s.session_id
"#;

pub(crate) fn list_history_sessions(
    path: &Path,
    current_session_id: &str,
    namespace: HistoryNamespace,
    anchor: Option<&HistorySessionAnchor>,
    limit: usize,
) -> Result<HistorySessionPage> {
    let conn = crate::store::open_runtime_connection(path)?;
    let current = query_history_session(&conn, current_session_id)?
        .with_context(|| format!("containing session '{current_session_id}' was not found"))?;

    if namespace == HistoryNamespace::Session {
        if anchor.is_some() {
            return Err(anyhow!("the session namespace has no continuation page"));
        }
        return Ok(HistorySessionPage {
            sessions: vec![current.into_item()?],
            next_anchor: None,
            scan_exhausted: false,
            warnings: Vec::new(),
        });
    }

    let workspace_key = (namespace == HistoryNamespace::Workspace)
        .then(|| current.workspace_key())
        .transpose()?;
    let visible_target = limit.saturating_add(1);
    let mut candidate_anchor = anchor.cloned();
    let mut visible = Vec::with_capacity(visible_target);
    let mut warnings = Vec::new();
    let mut scanned = 0usize;
    let mut reached_end = false;

    while visible.len() < visible_target && scanned < HISTORY_MAX_CANDIDATES {
        let chunk_limit = HISTORY_CANDIDATE_CHUNK.min(HISTORY_MAX_CANDIDATES - scanned);
        let rows = query_history_candidates(&conn, candidate_anchor.as_ref(), chunk_limit)?;
        if rows.is_empty() {
            reached_end = true;
            break;
        }
        let row_count = rows.len();
        for row in rows {
            scanned += 1;
            candidate_anchor = Some(row.anchor());
            let in_namespace = match workspace_key.as_ref() {
                None => true,
                Some(expected) => match row.workspace_key() {
                    Ok(candidate) => &candidate == expected,
                    Err(error) => {
                        warnings.push(format!("skipped session '{}': {error:#}", row.session_id));
                        false
                    }
                },
            };
            if in_namespace {
                let item_anchor = row.anchor();
                visible.push((row.into_item()?, item_anchor));
                if visible.len() == visible_target {
                    break;
                }
            }
        }
        if row_count < chunk_limit {
            reached_end = true;
            break;
        }
    }

    let scan_exhausted = !reached_end && scanned >= HISTORY_MAX_CANDIDATES;
    let has_more = visible.len() > limit || scan_exhausted;
    if visible.len() > limit {
        visible.truncate(limit);
    }
    let next_anchor = has_more.then(|| {
        visible
            .last()
            .map(|(_, anchor)| anchor.clone())
            .or(candidate_anchor)
            .expect("a continuing history page inspected at least one candidate")
    });

    Ok(HistorySessionPage {
        sessions: visible.into_iter().map(|(item, _)| item).collect(),
        next_anchor,
        scan_exhausted,
        warnings,
    })
}

pub(crate) fn resolve_history_session(
    path: &Path,
    current_session_id: &str,
    namespace: HistoryNamespace,
    requested_session_id: Option<&str>,
) -> Result<Option<HistorySessionItem>> {
    let conn = crate::store::open_runtime_connection(path)?;
    let current = query_history_session(&conn, current_session_id)?
        .with_context(|| format!("containing session '{current_session_id}' was not found"))?;
    let target_id = match namespace {
        HistoryNamespace::Session => current_session_id,
        HistoryNamespace::Workspace | HistoryNamespace::Store => requested_session_id
            .context("session_id is required outside the containing session namespace")?,
    };
    let Some(target) = query_history_session(&conn, target_id)? else {
        return Ok(None);
    };
    if namespace == HistoryNamespace::Workspace
        && target.workspace_key()? != current.workspace_key()?
    {
        return Ok(None);
    }
    Ok(Some(target.into_item()?))
}

fn query_history_session(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Option<HistorySessionRow>> {
    let sql = format!("{HISTORY_SESSION_QUERY_HEAD} WHERE s.session_id = ?1");
    conn.query_row(&sql, params![session_id], map_history_session_row)
        .optional()
        .map_err(Into::into)
}

fn query_history_candidates(
    conn: &rusqlite::Connection,
    anchor: Option<&HistorySessionAnchor>,
    limit: usize,
) -> Result<Vec<HistorySessionRow>> {
    let (sql, values): (String, Vec<rusqlite::types::Value>) = match anchor {
        Some(anchor) => (
            format!(
                "{HISTORY_SESSION_QUERY_HEAD}\n                 WHERE s.updated_at < ?1 OR (s.updated_at = ?1 AND s.session_id < ?2)\n                 ORDER BY s.updated_at DESC, s.session_id DESC\n                 LIMIT ?3"
            ),
            vec![
                anchor.updated_at.clone().into(),
                anchor.session_id.clone().into(),
                i64::try_from(limit).unwrap_or(i64::MAX).into(),
            ],
        ),
        None => (
            format!(
                "{HISTORY_SESSION_QUERY_HEAD}\n                 ORDER BY s.updated_at DESC, s.session_id DESC\n                 LIMIT ?1"
            ),
            vec![i64::try_from(limit).unwrap_or(i64::MAX).into()],
        ),
    };
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(rusqlite::params_from_iter(values), map_history_session_row)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn map_history_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistorySessionRow> {
    Ok(HistorySessionRow {
        session_id: row.get(0)?,
        cwd: row.get(1)?,
        model: row.get(2)?,
        sandbox_json: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        ssh_host: row.get(6)?,
        title: row.get(7)?,
        prompt_prefix: row.get(8)?,
        visible_message_count: row.get(9)?,
        run_count: row.get(10)?,
        ssh_port: row.get(11)?,
        ssh_identity_file: row.get(12)?,
        orchestrator_message_count: row.get(13)?,
        worker_stream_count: row.get(14)?,
        retained_episode_count: row.get(15)?,
    })
}

fn display_label(
    title: Option<&str>,
    prompt_prefix: Option<&str>,
    created_at: &str,
    message_count: i64,
    session_id: &str,
) -> String {
    if let Some(title) = title.map(str::trim).filter(|title| !title.is_empty()) {
        return truncate_chars(title, HISTORY_LABEL_CHARS);
    }
    if let Some(line) = prompt_prefix
        .into_iter()
        .flat_map(str::lines)
        .map(str::trim)
        .find(|line| !line.is_empty())
    {
        return truncate_chars(line, HISTORY_LABEL_CHARS);
    }
    let short_id = truncate_chars(session_id, 8);
    format!(
        "{created_at} · {} messages · {short_id}",
        message_count.max(0)
    )
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn nonnegative_usize(value: i64, label: &str) -> Result<usize> {
    usize::try_from(value).with_context(|| format!("stored {label} was negative or overflowed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!(
                "nac_session_history_{name}_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("store.db")
    }

    fn insert_session(path: &Path, id: &str, cwd: &str, updated_at: &str) {
        let conn = crate::store::open_runtime_connection(path).unwrap();
        conn.execute(
            "INSERT INTO sessions
             (session_id, cwd, store_path, model, base_url, messages_json,
              created_at, updated_at, visible_message_count, last_user_prompt, run_count)
             VALUES (?1, ?2, ?3, 'test-model', 'https://example.invalid', '[]',
                     ?4, ?4, 3, ?5, 2)",
            params![
                id,
                cwd,
                path.display().to_string(),
                updated_at,
                format!("Prompt for {id}")
            ],
        )
        .unwrap();
    }

    #[test]
    fn namespaces_expand_from_containing_session_to_workspace_and_store() {
        let path = temp_store("namespaces");
        crate::store::initialize(&path).unwrap();
        insert_session(&path, "current", "/workspace/a", "2026-01-03T00:00:00Z");
        insert_session(&path, "same", "/workspace/a", "2026-01-02T00:00:00Z");
        insert_session(&path, "other", "/workspace/b", "2026-01-01T00:00:00Z");
        let snapshot = [
            Message::System {
                content: "system".to_string(),
            },
            Message::User {
                content: "legacy user".to_string(),
            },
        ];
        let conn = crate::store::open_runtime_connection(&path).unwrap();
        conn.execute(
            "UPDATE sessions SET messages_json = ?1 WHERE session_id = 'current'",
            params![serde_json::to_string(&snapshot).unwrap()],
        )
        .unwrap();
        crate::store::append_thread_event(
            &path,
            "current",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            &crate::store::encode_transcript_log_entry(0, &snapshot[0]).unwrap(),
        )
        .unwrap();
        crate::store::TranscriptLogWriter::new(&path)
            .unwrap()
            .append(
                "current",
                2,
                &Message::Assistant {
                    content: Some("tail".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            )
            .unwrap();
        crate::store::append_thread_event(
            &path,
            "other",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "{malformed",
        )
        .unwrap();

        let current =
            list_history_sessions(&path, "current", HistoryNamespace::Session, None, 10).unwrap();
        assert_eq!(current.sessions.len(), 1);
        assert_eq!(current.sessions[0].session_id, "current");
        assert_eq!(current.sessions[0].orchestrator_message_count, 3);

        let workspace =
            list_history_sessions(&path, "current", HistoryNamespace::Workspace, None, 10).unwrap();
        assert_eq!(
            workspace
                .sessions
                .iter()
                .map(|session| session.session_id.as_str())
                .collect::<Vec<_>>(),
            ["current", "same"]
        );

        let store =
            list_history_sessions(&path, "current", HistoryNamespace::Store, None, 10).unwrap();
        assert_eq!(store.sessions.len(), 3);
        assert_eq!(store.sessions[0].display_label, "Prompt for current");
        assert_eq!(
            store
                .sessions
                .iter()
                .find(|session| session.session_id == "other")
                .unwrap()
                .orchestrator_message_count,
            0
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn store_pages_use_updated_at_and_session_id_anchor() {
        let path = temp_store("paging");
        crate::store::initialize(&path).unwrap();
        for (id, updated) in [
            ("a", "2026-01-03T00:00:00Z"),
            ("b", "2026-01-02T00:00:00Z"),
            ("c", "2026-01-01T00:00:00Z"),
        ] {
            insert_session(&path, id, "/workspace", updated);
        }
        let first = list_history_sessions(&path, "a", HistoryNamespace::Store, None, 2).unwrap();
        assert_eq!(first.sessions.len(), 2);
        let second = list_history_sessions(
            &path,
            "a",
            HistoryNamespace::Store,
            first.next_anchor.as_ref(),
            2,
        )
        .unwrap();
        assert_eq!(second.sessions.len(), 1);
        assert_eq!(second.sessions[0].session_id, "c");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
