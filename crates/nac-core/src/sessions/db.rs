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
    insert_or_replace_session(&tx, path, snapshot)?;
    tx.commit()?;
    Ok(())
}

pub fn load_session(path: &Path, session_id: &str) -> Result<SessionSnapshot> {
    let conn = crate::store::open_connection(path)?;
    let row = conn
        .query_row(
            "SELECT session_id, cwd, model, base_url, backend, reasoning_effort, sandbox_json, messages_json, last_response_duration_ms, previous_response_duration_ms, response_durations_ms_json, created_at, updated_at, host_id, api_key_env, extra_headers_json
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

pub fn load_last_session(path: &Path) -> Result<SessionSnapshot> {
    let conn = crate::store::open_connection(path)?;
    let row = conn
        .query_row(
            "SELECT session_id, cwd, model, base_url, backend, reasoning_effort, sandbox_json, messages_json, last_response_duration_ms, previous_response_duration_ms, response_durations_ms_json, created_at, updated_at, host_id, api_key_env, extra_headers_json
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
    })
}

pub fn list_sessions(path: &Path) -> Result<Vec<SessionSummary>> {
    let conn = crate::store::open_connection(path)?;
    let mut stmt = conn.prepare(
        "SELECT session_id, cwd, model, base_url, backend, sandbox_json, messages_json, created_at, updated_at, host_id
         FROM sessions
         ORDER BY updated_at DESC, created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
            row.get::<_, String>(8)?,
            row.get::<_, Option<String>>(9)?,
        ))
    })?;

    let mut sessions = Vec::new();
    for row in rows {
        let (
            session_id,
            cwd,
            model,
            base_url,
            backend_raw,
            sandbox_json,
            messages_json,
            created_at,
            updated_at,
            ssh_host,
        ) = row?;
        let backend = parse_backend(backend_raw, &base_url)?;
        let cwd = PathBuf::from(cwd);
        let sandbox_spec = deserialize_sandbox(sandbox_json)?;
        let sandboxed = sandbox_spec.is_some();
        let workspace_host_path = if ssh_host.is_some() {
            // Remote session: the stored cwd lives on the remote host, so
            // there is no local path for host-side inspection (git stats).
            None
        } else {
            match sandbox_spec.as_ref() {
                Some(spec) => crate::sandbox::host_workdir_from_spec(spec),
                None => Some(cwd.clone()),
            }
        };
        let messages: Vec<Message> = serde_json::from_str(&messages_json)
            .context("failed to parse stored session messages")?;
        sessions.push(SessionSummary {
            session_id,
            cwd,
            workspace_host_path,
            model,
            backend,
            visible_message_count: visible_message_count(&messages),
            last_user_prompt: last_user_prompt(&messages),
            sandboxed,
            ssh_host,
            created_at,
            updated_at,
        });
    }

    Ok(sessions)
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
    let messages_json = serde_json::to_string(&snapshot.messages)
        .context("failed to serialize session messages")?;
    let response_durations_ms_json = snapshot
        .response_durations_ms
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .context("failed to serialize session response durations")?;
    let extra_headers_json = if snapshot.extra_headers.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&snapshot.extra_headers)
            .context("failed to serialize session extra_headers")?)
    };

    // The legacy `store_path` column is kept physically (NOT NULL in existing
    // stores) but is informational only: it records the store that was
    // actually opened for this write and is never read back.
    tx.execute(
        "INSERT INTO sessions (
             session_id, cwd, store_path, model, base_url, backend, reasoning_effort, sandbox_json, messages_json, last_response_duration_ms, previous_response_duration_ms, response_durations_ms_json, created_at, updated_at, host_id, api_key_env, extra_headers_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(session_id) DO UPDATE SET
             cwd = excluded.cwd,
             store_path = excluded.store_path,
             model = excluded.model,
             base_url = excluded.base_url,
             backend = excluded.backend,
             reasoning_effort = excluded.reasoning_effort,
             sandbox_json = excluded.sandbox_json,
             messages_json = excluded.messages_json,
             last_response_duration_ms = excluded.last_response_duration_ms,
             previous_response_duration_ms = excluded.previous_response_duration_ms,
             response_durations_ms_json = excluded.response_durations_ms_json,
             updated_at = excluded.updated_at,
             host_id = excluded.host_id,
             api_key_env = excluded.api_key_env,
             extra_headers_json = excluded.extra_headers_json",
        params![
            snapshot.session_id,
            snapshot.cwd.display().to_string(),
            path.display().to_string(),
            snapshot.model,
            snapshot.base_url,
            snapshot.backend.as_str(),
            snapshot.reasoning_effort.map(|effort| effort.as_str().to_string()),
            sandbox_json,
            messages_json,
            snapshot.last_response_duration_ms,
            snapshot.previous_response_duration_ms,
            response_durations_ms_json,
            snapshot.created_at,
            snapshot.updated_at,
            snapshot.ssh_host,
            snapshot.api_key_env,
            extra_headers_json,
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
        let backend = parse_backend(self.backend, &base_url)?;
        let extra_headers = self
            .extra_headers_json
            .as_deref()
            .filter(|json| !json.is_empty())
            .map(|json| {
                serde_json::from_str::<BTreeMap<String, String>>(json)
                    .context("failed to parse stored session extra_headers")
            })
            .transpose()?
            .unwrap_or_default();
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
            messages,
            last_response_duration_ms: self.last_response_duration_ms,
            previous_response_duration_ms: self.previous_response_duration_ms,
            response_durations_ms,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn parse_backend(raw: Option<String>, base_url: &str) -> Result<BackendKind> {
    match raw.as_deref() {
        Some("deepseek-chat") => Ok(BackendKind::DeepSeekChat),
        Some("fireworks-chat") => Ok(BackendKind::FireworksChat),
        Some("openai-responses") => Ok(BackendKind::OpenAiResponses),
        Some("chatgpt-codex-responses") => Ok(BackendKind::ChatGptCodexResponses),
        Some("anthropic-messages") => Ok(BackendKind::AnthropicMessages),
        Some(other) => Err(anyhow!("unsupported stored backend '{}'", other)),
        None => detect_backend(base_url),
    }
}

fn parse_reasoning_effort(raw: Option<String>) -> Result<Option<ReasoningEffort>> {
    match raw.as_deref() {
        Some("none") => Ok(Some(ReasoningEffort::None)),
        Some("minimal") => Ok(Some(ReasoningEffort::Minimal)),
        Some("low") => Ok(Some(ReasoningEffort::Low)),
        Some("medium") => Ok(Some(ReasoningEffort::Medium)),
        Some("high") => Ok(Some(ReasoningEffort::High)),
        Some("xhigh") => Ok(Some(ReasoningEffort::Xhigh)),
        Some(other) => Err(anyhow!("unsupported stored reasoning effort '{}'", other)),
        None => Ok(None),
    }
}
