use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::api::{detect_backend, BackendKind, ReasoningEffort};
use crate::paths::nac_sessions_path;
use crate::sandbox::SandboxSpec;
use crate::types::Message;

#[derive(Debug, Clone)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub cwd: PathBuf,
    pub store_path: PathBuf,
    pub model: String,
    pub base_url: String,
    pub backend: BackendKind,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub sandbox_spec: Option<SandboxSpec>,
    pub messages: Vec<Message>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct SessionSummary {
    pub session_id: String,
    pub cwd: PathBuf,
    pub model: String,
    pub backend: BackendKind,
    pub visible_message_count: usize,
    pub last_user_prompt: Option<String>,
    pub sandboxed: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedSandboxSpec {
    image: String,
    workdir: String,
    mounts: Vec<PersistedMountSpec>,
    #[serde(default)]
    gpu_devices: Vec<String>,
    #[serde(default = "default_sandbox_shm_size")]
    shm_size: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedMountSpec {
    host: String,
    guest: String,
    read_only: bool,
}

fn default_sandbox_shm_size() -> Option<String> {
    Some("0".to_string())
}

pub fn create_session(snapshot: &SessionSnapshot) -> Result<()> {
    let path = sessions_path()?;
    let mut conn = open_connection(&path)?;
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

    insert_or_replace_session(&tx, snapshot)?;
    tx.commit()?;
    Ok(())
}

pub fn save_session(snapshot: &SessionSnapshot) -> Result<()> {
    let path = sessions_path()?;
    let mut conn = open_connection(&path)?;
    let tx = conn.transaction()?;
    insert_or_replace_session(&tx, snapshot)?;
    tx.commit()?;
    Ok(())
}

pub fn load_session(session_id: &str) -> Result<SessionSnapshot> {
    let path = sessions_path()?;
    let conn = open_connection(&path)?;
    let row = conn
        .query_row(
            "SELECT session_id, cwd, store_path, model, base_url, backend, reasoning_effort, sandbox_json, messages_json, created_at, updated_at
             FROM sessions
             WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok(SessionRow {
                    session_id: row.get(0)?,
                    cwd: row.get(1)?,
                    store_path: row.get(2)?,
                    model: row.get(3)?,
                    base_url: row.get(4)?,
                    backend: row.get(5)?,
                    reasoning_effort: row.get(6)?,
                    sandbox_json: row.get(7)?,
                    messages_json: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .optional()?;

    let Some(row) = row else {
        return Err(anyhow!("session '{}' was not found", session_id));
    };

    row.into_snapshot()
}

pub fn load_last_session() -> Result<SessionSnapshot> {
    let path = sessions_path()?;
    let conn = open_connection(&path)?;
    let row = conn
        .query_row(
            "SELECT session_id, cwd, store_path, model, base_url, backend, reasoning_effort, sandbox_json, messages_json, created_at, updated_at
             FROM sessions
             ORDER BY updated_at DESC, created_at DESC
             LIMIT 1",
            [],
            |row| {
                Ok(SessionRow {
                    session_id: row.get(0)?,
                    cwd: row.get(1)?,
                    store_path: row.get(2)?,
                    model: row.get(3)?,
                    base_url: row.get(4)?,
                    backend: row.get(5)?,
                    reasoning_effort: row.get(6)?,
                    sandbox_json: row.get(7)?,
                    messages_json: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .optional()?;

    let Some(row) = row else {
        return Err(anyhow!("no resumable nac sessions were found"));
    };

    row.into_snapshot()
}

pub fn list_sessions() -> Result<Vec<SessionSummary>> {
    let path = sessions_path()?;
    let conn = open_connection(&path)?;
    let mut stmt = conn.prepare(
        "SELECT session_id, cwd, model, base_url, backend, sandbox_json, messages_json, created_at, updated_at
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
        ) = row?;
        let backend = parse_backend(backend_raw, &base_url)?;
        let messages: Vec<Message> = serde_json::from_str(&messages_json)
            .context("failed to parse stored session messages")?;
        sessions.push(SessionSummary {
            session_id,
            cwd: PathBuf::from(cwd),
            model,
            backend,
            visible_message_count: visible_message_count(&messages),
            last_user_prompt: last_user_prompt(&messages),
            sandboxed: sandbox_json.is_some(),
            created_at,
            updated_at,
        });
    }

    Ok(sessions)
}

fn sessions_path() -> Result<PathBuf> {
    nac_sessions_path().ok_or_else(|| anyhow!("could not determine NAC_HOME for session storage"))
}

fn open_connection(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create sessions dir {}", parent.display()))?;
    }

    let conn = Connection::open(path)
        .with_context(|| format!("failed to open sessions database {}", path.display()))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS sessions (
             session_id TEXT PRIMARY KEY,
             cwd TEXT NOT NULL,
             store_path TEXT NOT NULL,
             model TEXT NOT NULL,
             base_url TEXT NOT NULL,
             backend TEXT,
             reasoning_effort TEXT,
             sandbox_json TEXT,
             messages_json TEXT NOT NULL,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
             ON sessions(updated_at DESC);",
    )?;
    ensure_column(&conn, "sessions", "backend", "TEXT")?;
    ensure_column(&conn, "sessions", "reasoning_effort", "TEXT")?;
    Ok(conn)
}

fn insert_or_replace_session(
    tx: &rusqlite::Transaction<'_>,
    snapshot: &SessionSnapshot,
) -> Result<()> {
    let sandbox_json = snapshot
        .sandbox_spec
        .as_ref()
        .map(serialize_sandbox)
        .transpose()?;
    let messages_json = serde_json::to_string(&snapshot.messages)
        .context("failed to serialize session messages")?;

    tx.execute(
        "INSERT INTO sessions (
             session_id, cwd, store_path, model, base_url, backend, reasoning_effort, sandbox_json, messages_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(session_id) DO UPDATE SET
             cwd = excluded.cwd,
             store_path = excluded.store_path,
             model = excluded.model,
             base_url = excluded.base_url,
             backend = excluded.backend,
             reasoning_effort = excluded.reasoning_effort,
             sandbox_json = excluded.sandbox_json,
             messages_json = excluded.messages_json,
             updated_at = excluded.updated_at",
        params![
            snapshot.session_id,
            snapshot.cwd.display().to_string(),
            snapshot.store_path.display().to_string(),
            snapshot.model,
            snapshot.base_url,
            snapshot.backend.as_str(),
            snapshot.reasoning_effort.map(|effort| effort.as_str().to_string()),
            sandbox_json,
            messages_json,
            snapshot.created_at,
            snapshot.updated_at,
        ],
    )?;
    Ok(())
}

fn serialize_sandbox(spec: &SandboxSpec) -> Result<String> {
    let persisted = PersistedSandboxSpec {
        image: spec.image.clone(),
        workdir: spec.workdir.display().to_string(),
        mounts: spec
            .mounts
            .iter()
            .map(|mount| PersistedMountSpec {
                host: mount.host.display().to_string(),
                guest: mount.guest.display().to_string(),
                read_only: mount.read_only,
            })
            .collect(),
        gpu_devices: spec.gpu_devices.clone(),
        shm_size: spec.shm_size.clone(),
    };
    serde_json::to_string(&persisted).context("failed to serialize sandbox spec")
}

fn deserialize_sandbox(raw: Option<String>) -> Result<Option<SandboxSpec>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let persisted: PersistedSandboxSpec =
        serde_json::from_str(&raw).context("failed to parse sandbox spec")?;
    Ok(Some(SandboxSpec {
        image: persisted.image,
        workdir: PathBuf::from(persisted.workdir),
        mounts: persisted
            .mounts
            .into_iter()
            .map(|mount| crate::sandbox::MountSpec {
                host: PathBuf::from(mount.host),
                guest: PathBuf::from(mount.guest),
                read_only: mount.read_only,
            })
            .collect(),
        gpu_devices: persisted.gpu_devices,
        shm_size: persisted.shm_size,
    }))
}

fn now_utc() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let nanos = d.subsec_nanos();
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (h, rem) = (rem / 3_600, rem % 3_600);
    let (m, s) = (rem / 60, rem % 60);
    let (mut y, mut mo, mut day) = (1970i64, 1u32, 1u32);
    let mut remaining = days as i64;
    loop {
        let yd = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < yd {
            break;
        }
        remaining -= yd;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let mdays = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    for md in mdays {
        if remaining < md as i64 {
            break;
        }
        remaining -= md as i64;
        mo += 1;
    }
    day += remaining as u32;
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:09}",
        y, mo, day, h, m, s, nanos
    )
}

pub fn new_snapshot(
    session_id: String,
    cwd: PathBuf,
    store_path: PathBuf,
    model: String,
    base_url: String,
    backend: BackendKind,
    reasoning_effort: Option<ReasoningEffort>,
    sandbox_spec: Option<SandboxSpec>,
    messages: Vec<Message>,
) -> SessionSnapshot {
    let now = now_utc();
    SessionSnapshot {
        session_id,
        cwd,
        store_path,
        model,
        base_url,
        backend,
        reasoning_effort,
        sandbox_spec,
        messages,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub fn refresh_snapshot(snapshot: &SessionSnapshot, messages: Vec<Message>) -> SessionSnapshot {
    SessionSnapshot {
        session_id: snapshot.session_id.clone(),
        cwd: snapshot.cwd.clone(),
        store_path: snapshot.store_path.clone(),
        model: snapshot.model.clone(),
        base_url: snapshot.base_url.clone(),
        backend: snapshot.backend,
        reasoning_effort: snapshot.reasoning_effort,
        sandbox_spec: snapshot.sandbox_spec.clone(),
        messages,
        created_at: snapshot.created_at.clone(),
        updated_at: now_utc(),
    }
}

struct SessionRow {
    session_id: String,
    cwd: String,
    store_path: String,
    model: String,
    base_url: String,
    backend: Option<String>,
    reasoning_effort: Option<String>,
    sandbox_json: Option<String>,
    messages_json: String,
    created_at: String,
    updated_at: String,
}

impl SessionRow {
    fn into_snapshot(self) -> Result<SessionSnapshot> {
        let messages = serde_json::from_str(&self.messages_json)
            .context("failed to parse stored session messages")?;
        let base_url = self.base_url;
        let backend = parse_backend(self.backend, &base_url)?;
        Ok(SessionSnapshot {
            session_id: self.session_id,
            cwd: PathBuf::from(self.cwd),
            store_path: PathBuf::from(self.store_path),
            model: self.model,
            base_url,
            backend,
            reasoning_effort: parse_reasoning_effort(self.reasoning_effort)?,
            sandbox_spec: deserialize_sandbox(self.sandbox_json)?,
            messages,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn parse_backend(raw: Option<String>, base_url: &str) -> Result<BackendKind> {
    match raw.as_deref() {
        Some("fireworks-chat") => Ok(BackendKind::FireworksChat),
        Some("openai-responses") => Ok(BackendKind::OpenAiResponses),
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

fn visible_message_count(messages: &[Message]) -> usize {
    messages
        .iter()
        .filter(|message| match message {
            Message::User { .. } => true,
            Message::Assistant { content, .. } => content.is_some(),
            _ => false,
        })
        .count()
}

fn last_user_prompt(messages: &[Message]) -> Option<String> {
    messages.iter().rev().find_map(|message| match message {
        Message::User { content } => Some(content.clone()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Message;
    use crate::TEST_ENV_LOCK;

    fn temp_home(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nac_sessions_test_{}_{}", label, unique));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn create_and_load_session_round_trip() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let home = temp_home("round_trip");
        let previous_nac_home = std::env::var_os("NAC_HOME");
        unsafe {
            std::env::set_var("NAC_HOME", &home);
        }

        let snapshot = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo"),
            PathBuf::from("/repo/.nac/store.db"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Xhigh),
            None,
            vec![Message::User {
                content: "hello".to_string(),
            }],
        );
        create_session(&snapshot).unwrap();
        let loaded = load_session("session-1").unwrap();
        assert_eq!(loaded.session_id, "session-1");
        assert_eq!(loaded.cwd, PathBuf::from("/repo"));
        assert_eq!(loaded.messages.len(), 1);

        match previous_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn load_last_session_returns_most_recent() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let home = temp_home("latest");
        let previous_nac_home = std::env::var_os("NAC_HOME");
        unsafe {
            std::env::set_var("NAC_HOME", &home);
        }

        let first = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo-one"),
            PathBuf::from("/repo-one/.nac/store.db"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Xhigh),
            None,
            Vec::new(),
        );
        create_session(&first).unwrap();

        let second = new_snapshot(
            "session-2".to_string(),
            PathBuf::from("/repo-two"),
            PathBuf::from("/repo-two/.nac/store.db"),
            "model-b".to_string(),
            "https://api.fireworks.ai/inference/v1".to_string(),
            BackendKind::FireworksChat,
            None,
            None,
            vec![Message::User {
                content: "latest".to_string(),
            }],
        );
        save_session(&second).unwrap();

        let loaded = load_last_session().unwrap();
        assert_eq!(loaded.session_id, "session-2");

        match previous_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn list_sessions_returns_summaries_in_updated_order() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let home = temp_home("list");
        let previous_nac_home = std::env::var_os("NAC_HOME");
        unsafe {
            std::env::set_var("NAC_HOME", &home);
        }

        let first = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo-one"),
            PathBuf::from("/repo-one/.nac/store.db"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            vec![
                Message::System {
                    content: "system".to_string(),
                },
                Message::User {
                    content: "first prompt".to_string(),
                },
            ],
        );
        create_session(&first).unwrap();

        let second = new_snapshot(
            "session-2".to_string(),
            PathBuf::from("/repo-two"),
            PathBuf::from("/repo-two/.nac/store.db"),
            "model-b".to_string(),
            "https://api.fireworks.ai/inference/v1".to_string(),
            BackendKind::FireworksChat,
            None,
            Some(SandboxSpec {
                image: "python:3.13".to_string(),
                workdir: PathBuf::from("/workspace"),
                mounts: Vec::new(),
                gpu_devices: Vec::new(),
                shm_size: Some("0".to_string()),
            }),
            vec![
                Message::System {
                    content: "system".to_string(),
                },
                Message::User {
                    content: "latest prompt".to_string(),
                },
                Message::Assistant {
                    content: Some("reply".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                },
            ],
        );
        save_session(&second).unwrap();

        let sessions = list_sessions().unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].session_id, "session-2");
        assert_eq!(sessions[0].visible_message_count, 2);
        assert_eq!(
            sessions[0].last_user_prompt.as_deref(),
            Some("latest prompt")
        );
        assert!(sessions[0].sandboxed);

        match previous_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
        let _ = std::fs::remove_dir_all(home);
    }
}
fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let pragma = format!("PRAGMA table_info({})", table);
    let mut stmt = conn.prepare(&pragma)?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(());
        }
    }

    let alter = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition);
    conn.execute(&alter, [])?;
    Ok(())
}
