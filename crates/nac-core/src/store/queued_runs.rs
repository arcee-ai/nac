use super::*;
use crate::types::Message;
use sha2::{Digest, Sha256};
use std::fmt;

pub const MAX_QUEUED_ID_BYTES: usize = 256;
pub const MAX_QUEUED_PROMPT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueuedRunState {
    Pending,
    Admitting,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct QueuedRunRecord {
    pub session_id: String,
    pub queued_run_id: String,
    pub client_message_id: String,
    pub display_prompt: String,
    pub agent_prompt: String,
    pub after_run_id: String,
    pub state: QueuedRunState,
    pub admitted_run_id: Option<String>,
    pub version: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageReceiptDisposition {
    Queued,
    Admitting,
    Admitted,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MessageReceiptRecord {
    pub session_id: String,
    pub client_message_id: String,
    pub payload_sha256: String,
    pub disposition: MessageReceiptDisposition,
    pub queued_run_id: String,
    pub run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateQueuedRun {
    pub session_id: String,
    pub queued_run_id: String,
    pub client_message_id: String,
    pub display_prompt: String,
    pub agent_prompt: String,
    pub after_run_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreateQueuedRunOutcome {
    Created(QueuedRunRecord),
    IdempotentReplay(MessageReceiptRecord),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueuedRunStoreError {
    Invalid(&'static str),
    IdempotencyMismatch,
    Occupied,
    NotFound,
    Conflict,
}

impl fmt::Display for QueuedRunStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(field) => write!(f, "invalid queued-run {field}"),
            Self::IdempotencyMismatch => f.write_str("client message id payload mismatch"),
            Self::Occupied => f.write_str("session queued-run slot is occupied"),
            Self::NotFound => f.write_str("queued run not found"),
            Self::Conflict => f.write_str("queued run changed or is not pending"),
        }
    }
}
impl std::error::Error for QueuedRunStoreError {}

fn validate_nonempty(value: &str, max: usize, field: &'static str) -> Result<()> {
    if value.trim().is_empty() || value.len() > max {
        return Err(QueuedRunStoreError::Invalid(field).into());
    }
    Ok(())
}

fn validate_create(request: &CreateQueuedRun) -> Result<()> {
    validate_nonempty(&request.session_id, MAX_QUEUED_ID_BYTES, "session id")?;
    validate_nonempty(&request.queued_run_id, MAX_QUEUED_ID_BYTES, "queued run id")?;
    validate_nonempty(
        &request.client_message_id,
        MAX_QUEUED_ID_BYTES,
        "client message id",
    )?;
    validate_nonempty(
        &request.after_run_id,
        MAX_QUEUED_ID_BYTES,
        "predecessor run id",
    )?;
    validate_nonempty(
        &request.display_prompt,
        MAX_QUEUED_PROMPT_BYTES,
        "display prompt",
    )?;
    validate_nonempty(
        &request.agent_prompt,
        MAX_QUEUED_PROMPT_BYTES,
        "agent prompt",
    )?;
    Ok(())
}

fn payload_hash(display_prompt: &str, agent_prompt: &str, _after_run_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"nac:queued-run-payload:v2\0");
    for field in [display_prompt, agent_prompt] {
        digest.update((field.len() as u64).to_be_bytes());
        digest.update(field.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

pub fn message_receipt_matches_prompt(
    receipt: &MessageReceiptRecord,
    display_prompt: &str,
    agent_prompt: &str,
) -> bool {
    receipt.payload_sha256 == payload_hash(display_prompt, agent_prompt, "")
}

fn parse_state(value: String) -> rusqlite::Result<QueuedRunState> {
    match value.as_str() {
        "pending" => Ok(QueuedRunState::Pending),
        "admitting" => Ok(QueuedRunState::Admitting),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn parse_disposition(value: String) -> rusqlite::Result<MessageReceiptDisposition> {
    match value.as_str() {
        "queued" => Ok(MessageReceiptDisposition::Queued),
        "admitting" => Ok(MessageReceiptDisposition::Admitting),
        "admitted" => Ok(MessageReceiptDisposition::Admitted),
        "deleted" => Ok(MessageReceiptDisposition::Deleted),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn queued_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueuedRunRecord> {
    let version: i64 = row.get(8)?;
    Ok(QueuedRunRecord {
        session_id: row.get(0)?,
        queued_run_id: row.get(1)?,
        client_message_id: row.get(2)?,
        display_prompt: row.get(3)?,
        agent_prompt: row.get(4)?,
        after_run_id: row.get(5)?,
        state: parse_state(row.get(6)?)?,
        admitted_run_id: row.get(7)?,
        version: u64::try_from(version)
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(8, version))?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

const QUEUED_SELECT: &str = "SELECT session_id, queued_run_id, client_message_id,
    display_prompt, agent_prompt, after_run_id, state, admitted_run_id, version,
    created_at, updated_at FROM session_queued_runs";

fn receipt_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageReceiptRecord> {
    Ok(MessageReceiptRecord {
        session_id: row.get(0)?,
        client_message_id: row.get(1)?,
        payload_sha256: row.get(2)?,
        disposition: parse_disposition(row.get(3)?)?,
        queued_run_id: row.get(4)?,
        run_id: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const RECEIPT_SELECT: &str = "SELECT session_id, client_message_id, payload_sha256,
    disposition, queued_run_id, run_id, created_at, updated_at
    FROM session_message_receipts";

pub(crate) fn load_queued_run_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<QueuedRunRecord>> {
    validate_nonempty(session_id, MAX_QUEUED_ID_BYTES, "session id")?;
    conn.query_row(
        &format!("{QUEUED_SELECT} WHERE session_id = ?1"),
        params![session_id],
        queued_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn load_queued_run(path: &Path, session_id: &str) -> Result<Option<QueuedRunRecord>> {
    let conn = open_runtime_connection(path)?;
    load_queued_run_with_connection(&conn, session_id)
}

pub fn load_message_receipt(
    path: &Path,
    session_id: &str,
    client_message_id: &str,
) -> Result<Option<MessageReceiptRecord>> {
    validate_nonempty(session_id, MAX_QUEUED_ID_BYTES, "session id")?;
    validate_nonempty(client_message_id, MAX_QUEUED_ID_BYTES, "client message id")?;
    let conn = open_runtime_connection(path)?;
    conn.query_row(
        &format!("{RECEIPT_SELECT} WHERE session_id = ?1 AND client_message_id = ?2"),
        params![session_id, client_message_id],
        receipt_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn create_queued_run(path: &Path, request: &CreateQueuedRun) -> Result<CreateQueuedRunOutcome> {
    validate_create(request)?;
    let hash = payload_hash(
        &request.display_prompt,
        &request.agent_prompt,
        &request.after_run_id,
    );
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(receipt) = tx
        .query_row(
            &format!("{RECEIPT_SELECT} WHERE session_id = ?1 AND client_message_id = ?2"),
            params![request.session_id, request.client_message_id],
            receipt_from_row,
        )
        .optional()?
    {
        if receipt.payload_sha256 != hash {
            return Err(QueuedRunStoreError::IdempotencyMismatch.into());
        }
        tx.commit()?;
        return Ok(CreateQueuedRunOutcome::IdempotentReplay(receipt));
    }
    let occupied: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM session_queued_runs WHERE session_id = ?1)",
        params![request.session_id],
        |row| row.get(0),
    )?;
    if occupied {
        return Err(QueuedRunStoreError::Occupied.into());
    }
    let now = now_utc();
    tx.execute(
        "INSERT INTO session_queued_runs
         (session_id, queued_run_id, client_message_id, display_prompt, agent_prompt,
          after_run_id, state, admitted_run_id, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, 0, ?7, ?7)",
        params![
            request.session_id,
            request.queued_run_id,
            request.client_message_id,
            request.display_prompt,
            request.agent_prompt,
            request.after_run_id,
            now
        ],
    )?;
    tx.execute(
        "INSERT INTO session_message_receipts
         (session_id, client_message_id, payload_sha256, disposition, queued_run_id,
          run_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'queued', ?4, NULL, ?5, ?5)",
        params![
            request.session_id,
            request.client_message_id,
            hash,
            request.queued_run_id,
            now
        ],
    )?;
    let record = tx.query_row(
        &format!("{QUEUED_SELECT} WHERE session_id = ?1"),
        params![request.session_id],
        queued_from_row,
    )?;
    tx.commit()?;
    Ok(CreateQueuedRunOutcome::Created(record))
}

pub fn edit_queued_run(
    path: &Path,
    session_id: &str,
    queued_run_id: &str,
    expected_version: u64,
    display_prompt: &str,
    agent_prompt: &str,
) -> Result<QueuedRunRecord> {
    validate_nonempty(display_prompt, MAX_QUEUED_PROMPT_BYTES, "display prompt")?;
    validate_nonempty(agent_prompt, MAX_QUEUED_PROMPT_BYTES, "agent prompt")?;
    validate_nonempty(queued_run_id, MAX_QUEUED_ID_BYTES, "queued run id")?;
    let version = i64::try_from(expected_version).map_err(|_| QueuedRunStoreError::Conflict)?;
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let existing = tx
        .query_row(
            &format!("{QUEUED_SELECT} WHERE session_id = ?1 AND queued_run_id = ?2"),
            params![session_id, queued_run_id],
            queued_from_row,
        )
        .optional()?
        .ok_or(QueuedRunStoreError::NotFound)?;
    if existing.state != QueuedRunState::Pending || existing.version != expected_version {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let hash = payload_hash(display_prompt, agent_prompt, &existing.after_run_id);
    let now = now_utc();
    let updated = tx.execute(
        "UPDATE session_queued_runs SET display_prompt = ?1, agent_prompt = ?2,
         version = version + 1, updated_at = ?3
         WHERE session_id = ?4 AND queued_run_id = ?5 AND state = 'pending' AND version = ?6",
        params![
            display_prompt,
            agent_prompt,
            now,
            session_id,
            queued_run_id,
            version
        ],
    )?;
    if updated != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let receipt_updated = tx.execute(
        "UPDATE session_message_receipts SET payload_sha256 = ?1, updated_at = ?2
         WHERE session_id = ?3 AND client_message_id = ?4 AND disposition = 'queued'",
        params![hash, now, session_id, existing.client_message_id],
    )?;
    if receipt_updated != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let record = tx.query_row(
        &format!("{QUEUED_SELECT} WHERE session_id = ?1"),
        params![session_id],
        queued_from_row,
    )?;
    tx.commit()?;
    Ok(record)
}

pub fn delete_queued_run(
    path: &Path,
    session_id: &str,
    queued_run_id: &str,
    expected_version: u64,
) -> Result<()> {
    let version = i64::try_from(expected_version).map_err(|_| QueuedRunStoreError::Conflict)?;
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let existing = tx
        .query_row(
            &format!("{QUEUED_SELECT} WHERE session_id = ?1 AND queued_run_id = ?2"),
            params![session_id, queued_run_id],
            queued_from_row,
        )
        .optional()?
        .ok_or(QueuedRunStoreError::NotFound)?;
    if existing.state != QueuedRunState::Pending || existing.version != expected_version {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let now = now_utc();
    let receipt_updated = tx.execute(
        "UPDATE session_message_receipts SET disposition = 'deleted', run_id = NULL, updated_at = ?1
         WHERE session_id = ?2 AND client_message_id = ?3 AND disposition = 'queued'",
        params![now, session_id, existing.client_message_id],
    )?;
    if receipt_updated != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let deleted = tx.execute(
        "DELETE FROM session_queued_runs WHERE session_id = ?1 AND queued_run_id = ?2
         AND state = 'pending' AND version = ?3",
        params![session_id, queued_run_id, version],
    )?;
    if deleted != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    tx.commit()?;
    Ok(())
}

pub fn begin_queued_run_admission(
    path: &Path,
    session_id: &str,
    queued_run_id: &str,
    after_run_id: &str,
    expected_version: u64,
    admitted_run_id: &str,
) -> Result<QueuedRunRecord> {
    validate_nonempty(admitted_run_id, MAX_QUEUED_ID_BYTES, "admitted run id")?;
    let version = i64::try_from(expected_version).map_err(|_| QueuedRunStoreError::Conflict)?;
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let now = now_utc();
    let updated = tx.execute(
        "UPDATE session_queued_runs SET state = 'admitting', admitted_run_id = ?1,
         version = version + 1, updated_at = ?2 WHERE session_id = ?3 AND queued_run_id = ?4
         AND after_run_id = ?5 AND state = 'pending' AND version = ?6",
        params![
            admitted_run_id,
            now,
            session_id,
            queued_run_id,
            after_run_id,
            version
        ],
    )?;
    if updated != 1 {
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM session_queued_runs WHERE session_id=?1 AND queued_run_id=?2)", params![session_id, queued_run_id], |r| r.get(0))?;
        return Err(if exists {
            QueuedRunStoreError::Conflict
        } else {
            QueuedRunStoreError::NotFound
        }
        .into());
    }
    let run_count_updated = tx.execute(
        "UPDATE sessions SET run_count = run_count + 1 WHERE session_id = ?1",
        params![session_id],
    )?;
    if run_count_updated != 1 {
        return Err(QueuedRunStoreError::NotFound.into());
    }
    let receipt_updated = tx.execute(
        "UPDATE session_message_receipts SET disposition = 'admitting', run_id = ?1, updated_at = ?2
         WHERE session_id = ?3 AND queued_run_id = ?4 AND disposition = 'queued'",
        params![admitted_run_id, now, session_id, queued_run_id],
    )?;
    if receipt_updated != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let record = tx.query_row(
        &format!("{QUEUED_SELECT} WHERE session_id=?1"),
        params![session_id],
        queued_from_row,
    )?;
    tx.commit()?;
    Ok(record)
}

pub fn rollback_queued_run_admission(
    path: &Path,
    session_id: &str,
    queued_run_id: &str,
    admitted_run_id: &str,
) -> Result<QueuedRunRecord> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let now = now_utc();
    let updated = tx.execute(
        "UPDATE session_queued_runs SET state='pending', admitted_run_id=NULL,
         version=version+1, updated_at=?1 WHERE session_id=?2 AND queued_run_id=?3
         AND state='admitting' AND admitted_run_id=?4",
        params![now, session_id, queued_run_id, admitted_run_id],
    )?;
    if updated != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let run_count_updated = tx.execute(
        "UPDATE sessions SET run_count = run_count - 1
         WHERE session_id = ?1 AND run_count > 0",
        params![session_id],
    )?;
    if run_count_updated != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let receipt_updated = tx.execute(
        "UPDATE session_message_receipts SET disposition='queued', run_id=NULL, updated_at=?1
         WHERE session_id=?2 AND queued_run_id=?3 AND disposition='admitting' AND run_id=?4",
        params![now, session_id, queued_run_id, admitted_run_id],
    )?;
    if receipt_updated != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let record = tx.query_row(
        &format!("{QUEUED_SELECT} WHERE session_id=?1"),
        params![session_id],
        queued_from_row,
    )?;
    tx.commit()?;
    Ok(record)
}

#[allow(dead_code)] // consumed by the queued-run lifecycle layer in the next lane
pub(crate) fn append_admitting_user_and_consume(
    connection: &mut Connection,
    session_id: &str,
    queued_run_id: &str,
    admitted_run_id: &str,
    idx: u64,
) -> Result<Message> {
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let record = tx
        .query_row(
            &format!("{QUEUED_SELECT} WHERE session_id=?1 AND queued_run_id=?2"),
            params![session_id, queued_run_id],
            queued_from_row,
        )
        .optional()?
        .ok_or(QueuedRunStoreError::NotFound)?;
    if record.state != QueuedRunState::Admitting
        || record.admitted_run_id.as_deref() != Some(admitted_run_id)
    {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let message = Message::User {
        content: record.agent_prompt.clone(),
    };
    let event_json = super::transcript::encode_transcript_log_entry(idx, &message)?;
    let now = now_utc();
    tx.execute(
        "INSERT INTO thread_events (session_id, thread_name, event_json, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![session_id, ORCHESTRATOR_STEERING_TARGET, event_json, now],
    )?;
    let updated = tx.execute(
        "UPDATE sessions SET visible_message_count=visible_message_count+1,
         last_user_prompt=?1 WHERE session_id=?2",
        params![record.agent_prompt, session_id],
    )?;
    if updated != 1 {
        return Err(anyhow!(
            "transcript summary update expected one session row, updated {updated}"
        ));
    }
    let receipt = tx.execute(
        "UPDATE session_message_receipts SET disposition='admitted', run_id=?1, updated_at=?2
         WHERE session_id=?3 AND client_message_id=?4 AND disposition='admitting'
         AND queued_run_id=?5 AND run_id=?1",
        params![
            admitted_run_id,
            now,
            session_id,
            record.client_message_id,
            queued_run_id
        ],
    )?;
    if receipt != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    let deleted = tx.execute(
        "DELETE FROM session_queued_runs WHERE session_id=?1 AND queued_run_id=?2
         AND state='admitting' AND admitted_run_id=?3",
        params![session_id, queued_run_id, admitted_run_id],
    )?;
    if deleted != 1 {
        return Err(QueuedRunStoreError::Conflict.into());
    }
    tx.commit()?;
    Ok(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(label: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("nac_queued_runs_{label}_{}", uuid::Uuid::new_v4()));
        let path = root.join("store.db");
        initialize(&path).unwrap();
        insert_test_session(&path, "s1");
        path
    }

    fn request(client: &str, queue: &str, display: &str) -> CreateQueuedRun {
        CreateQueuedRun {
            session_id: "s1".into(),
            queued_run_id: queue.into(),
            client_message_id: client.into(),
            display_prompt: display.into(),
            agent_prompt: format!("prepared:{display}"),
            after_run_id: "run-old".into(),
        }
    }

    fn is_store_error(error: &anyhow::Error, expected: QueuedRunStoreError) -> bool {
        error
            .downcast_ref::<QueuedRunStoreError>()
            .is_some_and(|actual| *actual == expected)
    }

    #[test]
    fn create_is_idempotent_and_single_slot() {
        let path = store("create");
        let first = request("client-1", "queue-1", "hello");
        let created = create_queued_run(&path, &first).unwrap();
        assert!(matches!(created, CreateQueuedRunOutcome::Created(_)));
        let replay = create_queued_run(&path, &first).unwrap();
        assert!(matches!(
            replay,
            CreateQueuedRunOutcome::IdempotentReplay(MessageReceiptRecord {
                disposition: MessageReceiptDisposition::Queued,
                ..
            })
        ));

        let mut mismatch = first.clone();
        mismatch.display_prompt = "changed".into();
        assert!(is_store_error(
            &create_queued_run(&path, &mismatch).unwrap_err(),
            QueuedRunStoreError::IdempotencyMismatch
        ));
        assert!(is_store_error(
            &create_queued_run(&path, &request("client-2", "queue-2", "other")).unwrap_err(),
            QueuedRunStoreError::Occupied
        ));
        assert_eq!(
            load_queued_run(&path, "s1")
                .unwrap()
                .unwrap()
                .display_prompt,
            "hello"
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn edit_and_delete_use_pending_version_cas_and_retain_receipt() {
        let path = store("edit_delete");
        create_queued_run(&path, &request("client-1", "queue-1", "hello")).unwrap();
        let edited = edit_queued_run(&path, "s1", "queue-1", 0, "new", "prepared:new").unwrap();
        assert_eq!(edited.version, 1);
        assert_eq!(edited.agent_prompt, "prepared:new");
        assert!(is_store_error(
            &delete_queued_run(&path, "s1", "queue-1", 0).unwrap_err(),
            QueuedRunStoreError::Conflict
        ));
        delete_queued_run(&path, "s1", "queue-1", 1).unwrap();
        assert!(load_queued_run(&path, "s1").unwrap().is_none());
        assert_eq!(
            load_message_receipt(&path, "s1", "client-1")
                .unwrap()
                .unwrap()
                .disposition,
            MessageReceiptDisposition::Deleted
        );
        let replay = create_queued_run(&path, &request("client-1", "queue-1", "new")).unwrap();
        assert!(matches!(
            replay,
            CreateQueuedRunOutcome::IdempotentReplay(MessageReceiptRecord {
                disposition: MessageReceiptDisposition::Deleted,
                ..
            })
        ));
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn admission_can_roll_back_without_consuming_pending_message() {
        let path = store("rollback");
        create_queued_run(&path, &request("client-1", "queue-1", "hello")).unwrap();
        let admitting =
            begin_queued_run_admission(&path, "s1", "queue-1", "run-old", 0, "run-new").unwrap();
        assert_eq!(admitting.state, QueuedRunState::Admitting);
        let conn = open_runtime_connection(&path).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT run_count FROM sessions WHERE session_id='s1'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        drop(conn);
        assert!(is_store_error(
            &edit_queued_run(&path, "s1", "queue-1", 1, "x", "x").unwrap_err(),
            QueuedRunStoreError::Conflict
        ));
        let pending = rollback_queued_run_admission(&path, "s1", "queue-1", "run-new").unwrap();
        assert_eq!(pending.state, QueuedRunState::Pending);
        assert_eq!(pending.version, 2);
        let conn = open_runtime_connection(&path).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT run_count FROM sessions WHERE session_id='s1'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        drop(conn);
        assert_eq!(
            load_message_receipt(&path, "s1", "client-1")
                .unwrap()
                .unwrap()
                .disposition,
            MessageReceiptDisposition::Queued
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn canonical_user_append_consumes_queue_and_updates_receipt_atomically() {
        let path = store("admit");
        create_queued_run(&path, &request("client-1", "queue-1", "hello")).unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        assert!(writer.read_tail_from("s1", 0).unwrap().is_empty());
        assert!(is_store_error(
            &writer
                .append_admitting_queued_user("s1", "queue-1", "run-new", 0)
                .unwrap_err(),
            QueuedRunStoreError::Conflict
        ));
        begin_queued_run_admission(&path, "s1", "queue-1", "run-old", 0, "run-new").unwrap();
        let message = writer
            .append_admitting_queued_user("s1", "queue-1", "run-new", 0)
            .unwrap();
        assert!(matches!(message, Message::User { content } if content == "prepared:hello"));
        assert!(load_queued_run(&path, "s1").unwrap().is_none());
        let receipt = load_message_receipt(&path, "s1", "client-1")
            .unwrap()
            .unwrap();
        assert_eq!(receipt.disposition, MessageReceiptDisposition::Admitted);
        assert_eq!(receipt.run_id.as_deref(), Some("run-new"));
        let tail = writer.read_tail_from("s1", 0).unwrap();
        assert!(matches!(&tail[0].1, Message::User { content } if content == "prepared:hello"));
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn injected_receipt_failure_rolls_back_transcript_and_queue_delete() {
        let path = store("atomic_failure");
        create_queued_run(&path, &request("client-1", "queue-1", "hello")).unwrap();
        begin_queued_run_admission(&path, "s1", "queue-1", "run-old", 0, "run-new").unwrap();
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER fail_queued_receipt_update
             BEFORE UPDATE ON session_message_receipts
             BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;",
        )
        .unwrap();
        drop(conn);
        let writer = TranscriptLogWriter::new(&path).unwrap();
        assert!(writer
            .append_admitting_queued_user("s1", "queue-1", "run-new", 0)
            .is_err());
        assert!(writer.read_tail_from("s1", 0).unwrap().is_empty());
        assert_eq!(
            load_queued_run(&path, "s1").unwrap().unwrap().state,
            QueuedRunState::Admitting
        );
        assert_eq!(
            load_message_receipt(&path, "s1", "client-1")
                .unwrap()
                .unwrap()
                .disposition,
            MessageReceiptDisposition::Admitting
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn validation_bounds_ids_and_prepared_prompts() {
        let path = store("validation");
        let mut invalid = request("client-1", "queue-1", "hello");
        invalid.client_message_id = " ".into();
        assert!(is_store_error(
            &create_queued_run(&path, &invalid).unwrap_err(),
            QueuedRunStoreError::Invalid("client message id")
        ));
        invalid = request("client-1", "queue-1", "hello");
        invalid.agent_prompt = "x".repeat(MAX_QUEUED_PROMPT_BYTES + 1);
        assert!(is_store_error(
            &create_queued_run(&path, &invalid).unwrap_err(),
            QueuedRunStoreError::Invalid("agent prompt")
        ));
        assert!(load_queued_run(&path, "s1").unwrap().is_none());
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
