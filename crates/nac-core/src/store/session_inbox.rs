use super::*;

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum InboxDelivery {
    Steer,
    Queue,
}

impl InboxDelivery {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Steer => "steer",
            Self::Queue => "queue",
        }
    }
}

impl std::str::FromStr for InboxDelivery {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "steer" => Ok(Self::Steer),
            "queue" => Ok(Self::Queue),
            _ => Err(anyhow!("unsupported stored inbox delivery '{value}'")),
        }
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum InboxStatus {
    Pending,
    Delivered,
    Cancelled,
}

impl InboxStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Delivered => "delivered",
            Self::Cancelled => "cancelled",
        }
    }
}

impl std::str::FromStr for InboxStatus {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "delivered" => Ok(Self::Delivered),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(anyhow!("unsupported stored inbox status '{value}'")),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionInboxRecord {
    pub id: i64,
    pub session_id: String,
    pub delivery: InboxDelivery,
    pub status: InboxStatus,
    pub content: String,
    pub target_run_id: Option<String>,
    pub client_id: Option<String>,
    pub delivered_run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub delivered_at: Option<String>,
    pub cancelled_at: Option<String>,
    pub version: i64,
}

pub(crate) const INBOX_RECORD_COLUMNS: &str =
    "id, session_id, delivery, status, content, target_run_id, client_id, \
     delivered_run_id, created_at, updated_at, delivered_at, cancelled_at, version";

pub(crate) fn row_to_inbox_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionInboxRecord> {
    let delivery: String = row.get(2)?;
    let status: String = row.get(3)?;
    Ok(SessionInboxRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        delivery: delivery.parse().map_err(|error: anyhow::Error| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, error.into())
        })?,
        status: status.parse().map_err(|error: anyhow::Error| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, error.into())
        })?,
        content: row.get(4)?,
        target_run_id: row.get(5)?,
        client_id: row.get(6)?,
        delivered_run_id: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        delivered_at: row.get(10)?,
        cancelled_at: row.get(11)?,
        version: row.get(12)?,
    })
}

pub fn create_session_inbox_item(
    path: &Path,
    session_id: &str,
    delivery: InboxDelivery,
    content: &str,
    target_run_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<SessionInboxRecord> {
    let session_id = session_id.trim();
    let content = content.trim();
    if session_id.is_empty() {
        return Err(anyhow!("session id is empty"));
    }
    if content.is_empty() {
        return Err(anyhow!("inbox content is empty"));
    }
    if delivery == InboxDelivery::Queue && target_run_id.is_some() {
        return Err(anyhow!("queued inbox input cannot target an active run"));
    }
    let connection = open_runtime_connection(path)?;
    let now = now_utc();
    connection.execute(
        "INSERT INTO session_inbox
         (session_id, delivery, status, content, target_run_id, client_id,
          created_at, updated_at)
         VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?6)",
        params![
            session_id,
            delivery.as_str(),
            content,
            target_run_id,
            client_id,
            now
        ],
    )?;
    load_session_inbox_item_with_connection(&connection, session_id, connection.last_insert_rowid())
}

pub fn load_session_inbox_item(
    path: &Path,
    session_id: &str,
    item_id: i64,
) -> Result<SessionInboxRecord> {
    let connection = open_runtime_connection(path)?;
    load_session_inbox_item_with_connection(&connection, session_id, item_id)
}

pub(crate) fn load_session_inbox_item_with_connection(
    connection: &Connection,
    session_id: &str,
    item_id: i64,
) -> Result<SessionInboxRecord> {
    connection
        .query_row(
            &format!(
                "SELECT {INBOX_RECORD_COLUMNS} FROM session_inbox
                 WHERE session_id = ?1 AND id = ?2"
            ),
            params![session_id, item_id],
            row_to_inbox_record,
        )
        .optional()?
        .ok_or_else(|| anyhow!("inbox item {item_id} was not found in session '{session_id}'"))
}

pub fn list_session_inbox(path: &Path, session_id: &str) -> Result<Vec<SessionInboxRecord>> {
    let connection = open_runtime_connection(path)?;
    let mut statement = connection.prepare(&format!(
        "SELECT {INBOX_RECORD_COLUMNS} FROM session_inbox
         WHERE session_id = ?1 ORDER BY id ASC"
    ))?;
    let rows = statement.query_map(params![session_id], row_to_inbox_record)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn next_pending_session_inbox_item(
    path: &Path,
    session_id: &str,
) -> Result<Option<SessionInboxRecord>> {
    let connection = open_runtime_connection(path)?;
    Ok(connection
        .query_row(
            &format!(
                "SELECT {INBOX_RECORD_COLUMNS} FROM session_inbox
                 WHERE session_id = ?1 AND status = 'pending'
                 ORDER BY id ASC LIMIT 1"
            ),
            params![session_id],
            row_to_inbox_record,
        )
        .optional()?)
}

pub fn update_pending_session_inbox_item(
    path: &Path,
    session_id: &str,
    item_id: i64,
    expected_version: i64,
    delivery: InboxDelivery,
    target_run_id: Option<&str>,
) -> Result<SessionInboxRecord> {
    if expected_version < 0 {
        return Err(anyhow!("inbox item version must not be negative"));
    }
    if delivery == InboxDelivery::Queue && target_run_id.is_some() {
        return Err(anyhow!("queued inbox input cannot target an active run"));
    }
    let connection = open_runtime_connection(path)?;
    let changed = connection.execute(
        "UPDATE session_inbox
         SET delivery = ?1, target_run_id = ?2, updated_at = ?3,
             version = version + 1
         WHERE session_id = ?4 AND id = ?5 AND status = 'pending'
           AND version = ?6",
        params![
            delivery.as_str(),
            target_run_id,
            now_utc(),
            session_id,
            item_id,
            expected_version
        ],
    )?;
    if changed != 1 {
        return Err(pending_update_error(
            &connection,
            session_id,
            item_id,
            expected_version,
        ));
    }
    load_session_inbox_item_with_connection(&connection, session_id, item_id)
}

pub fn cancel_pending_session_inbox_item(
    path: &Path,
    session_id: &str,
    item_id: i64,
    expected_version: i64,
) -> Result<SessionInboxRecord> {
    if expected_version < 0 {
        return Err(anyhow!("inbox item version must not be negative"));
    }
    let connection = open_runtime_connection(path)?;
    let now = now_utc();
    let changed = connection.execute(
        "UPDATE session_inbox
         SET status = 'cancelled', cancelled_at = ?1, updated_at = ?1,
             target_run_id = NULL, version = version + 1
         WHERE session_id = ?2 AND id = ?3 AND status = 'pending'
           AND version = ?4",
        params![now, session_id, item_id, expected_version],
    )?;
    if changed != 1 {
        return Err(pending_update_error(
            &connection,
            session_id,
            item_id,
            expected_version,
        ));
    }
    load_session_inbox_item_with_connection(&connection, session_id, item_id)
}

fn pending_update_error(
    connection: &Connection,
    session_id: &str,
    item_id: i64,
    expected_version: i64,
) -> anyhow::Error {
    match load_session_inbox_item_with_connection(connection, session_id, item_id) {
        Err(error) => error,
        Ok(item) if item.status != InboxStatus::Pending => {
            anyhow!("inbox item {item_id} is no longer pending")
        }
        Ok(item) => anyhow!(
            "inbox item {item_id} version conflict: expected {expected_version}, current {}",
            item.version
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store_path(label: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!(
                "nac_session_inbox_{label}_{}",
                uuid::Uuid::new_v4()
            ))
            .join("store.db")
    }

    #[test]
    fn pending_items_are_versioned_mutable_cancellable_and_session_owned() {
        let path = temp_store_path("lifecycle");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session");
        let item = create_session_inbox_item(
            &path,
            "session",
            InboxDelivery::Queue,
            " queued work ",
            None,
            Some("client"),
        )
        .unwrap();
        assert_eq!(item.content, "queued work");
        assert_eq!(item.status, InboxStatus::Pending);
        assert_eq!(item.version, 0);

        let steered = update_pending_session_inbox_item(
            &path,
            "session",
            item.id,
            0,
            InboxDelivery::Steer,
            Some("run"),
        )
        .unwrap();
        assert_eq!(steered.delivery, InboxDelivery::Steer);
        assert_eq!(steered.target_run_id.as_deref(), Some("run"));
        assert_eq!(steered.version, 1);
        assert!(update_pending_session_inbox_item(
            &path,
            "session",
            item.id,
            0,
            InboxDelivery::Queue,
            None
        )
        .is_err());

        let cancelled = cancel_pending_session_inbox_item(&path, "session", item.id, 1).unwrap();
        assert_eq!(cancelled.status, InboxStatus::Cancelled);
        assert_eq!(cancelled.version, 2);
        assert!(next_pending_session_inbox_item(&path, "session")
            .unwrap()
            .is_none());

        let connection = open_runtime_connection(&path).unwrap();
        connection
            .execute("DELETE FROM sessions WHERE session_id = 'session'", [])
            .unwrap();
        assert!(list_session_inbox(&path, "session").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
