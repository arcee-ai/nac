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
    #[serde(skip)]
    #[cfg_attr(feature = "openapi", schema(ignore))]
    pub child_wait_id: Option<String>,
    /// Durable child continuation mode; internal admission metadata only.
    #[serde(skip)]
    #[cfg_attr(feature = "openapi", schema(ignore))]
    pub child_execution_mode: Option<TraditionalChildExecutionMode>,
    /// Derived from identified admission metadata; never inferred from prompt text.
    /// Keep the established serialized durable record shape unchanged.
    #[serde(skip)]
    #[cfg_attr(feature = "openapi", schema(ignore))]
    pub terminal_selection: Option<TerminalSelectionEvidence>,
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
     delivered_run_id, created_at, updated_at, delivered_at, cancelled_at, version, admission_id, admission_digest, child_execution_mode, child_wait_id";

pub(crate) fn row_to_inbox_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionInboxRecord> {
    let delivery: String = row.get(2)?;
    let status: String = row.get(3)?;
    let session: String = row.get(1)?;
    let content: String = row.get(4)?;
    let identity: Option<String> = row.get(13)?;
    let digest: Option<String> = row.get(14)?;
    let terminal_selection = super::transcript_selection::identified_inbox_evidence(
        &session,
        &content,
        identity.as_deref(),
        digest.as_deref(),
    )
    .map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, error.into())
    })?;
    Ok(SessionInboxRecord {
        child_wait_id: row.get(16)?,
        child_execution_mode: row
            .get::<_, Option<String>>(15)?
            .map(|mode| mode.parse())
            .transpose()
            .map_err(|error: anyhow::Error| {
                rusqlite::Error::FromSqlConversionFailure(
                    15,
                    rusqlite::types::Type::Text,
                    error.into(),
                )
            })?,
        terminal_selection,
        id: row.get(0)?,
        session_id: session,
        delivery: delivery.parse().map_err(|error: anyhow::Error| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, error.into())
        })?,
        status: status.parse().map_err(|error: anyhow::Error| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, error.into())
        })?,
        content,
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

coordinated_command! {
pub fn create_session_inbox_item(
    path: &Path,
    session_id: &str,
    delivery: InboxDelivery,
    content: &str,
    target_run_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<SessionInboxRecord> {
    create_inbox_item(path, session_id, delivery, content, target_run_id, client_id, InboxAdmission::default())
}
command CreateSessionInboxItemCommand {
    session_id: String = session_id.to_owned(),
    delivery: InboxDelivery = delivery,
    content: String = content.to_owned(),
    target_run_id: Option<String> = target_run_id.map(str::to_owned),
    client_id: Option<String> = client_id.map(str::to_owned),
}
call |command| (&command.session_id, command.delivery, &command.content, command.target_run_id.as_deref(), command.client_id.as_deref())
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Creates an inbox item a person typed on a human-facing route.
/// `review_intent` is their text as typed, before expansion; it becomes
/// review intent when the item reaches the model, never before.
pub fn create_person_session_inbox_item(
    path: &Path,
    session_id: &str,
    delivery: InboxDelivery,
    content: &str,
    target_run_id: Option<&str>,
    client_id: Option<&str>,
    review_intent: &str,
) -> Result<SessionInboxRecord> {
    create_inbox_item(path, session_id, delivery, content, target_run_id, client_id,
        InboxAdmission { review_intent: Some(review_intent), ..InboxAdmission::default() })
}
command CreatePersonSessionInboxItemCommand {
    session_id: String = session_id.to_owned(),
    delivery: InboxDelivery = delivery,
    content: String = content.to_owned(),
    target_run_id: Option<String> = target_run_id.map(str::to_owned),
    client_id: Option<String> = client_id.map(str::to_owned),
    review_intent: String = review_intent.to_owned(),
}
call |command| (&command.session_id, command.delivery, command.content.as_str(), command.target_run_id.as_deref(), command.client_id.as_deref(), &command.review_intent)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Persist the requested mode atomically with a parent's queued child input.
pub fn create_traditional_child_inbox_item(
    path: &Path,
    session_id: &str,
    content: &str,
    target_run_id: Option<&str>,
    execution_mode: TraditionalChildExecutionMode,
    wait_id: Option<&str>,
) -> Result<SessionInboxRecord> {
    create_inbox_item(path, session_id, InboxDelivery::Steer, content, target_run_id, None,
        InboxAdmission { child: Some((execution_mode, wait_id)), ..InboxAdmission::default() })
}
command CreateTraditionalChildInboxItemCommand {
    session_id: String = session_id.to_owned(),
    content: String = content.to_owned(),
    target_run_id: Option<String> = target_run_id.map(str::to_owned),
    execution_mode: TraditionalChildExecutionMode = execution_mode,
    wait_id: Option<String> = wait_id.map(str::to_owned),
}
call |command| (&command.session_id, &command.content, command.target_run_id.as_deref(), command.execution_mode, command.wait_id.as_deref())
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Record a person's child input, requested mode and waiter in one write.
/// Intent becomes effective only when the transcript delivers this inbox item.
pub fn create_person_traditional_child_inbox_item(
    path: &Path,
    session_id: &str,
    content: &str,
    target_run_id: Option<&str>,
    execution_mode: TraditionalChildExecutionMode,
    wait_id: Option<&str>,
    review_intent: &str,
) -> Result<SessionInboxRecord> {
    create_inbox_item(path, session_id, InboxDelivery::Steer, content, target_run_id, None,
        InboxAdmission { child: Some((execution_mode, wait_id)), review_intent: Some(review_intent) })
}
command CreatePersonTraditionalChildInboxItemCommand {
    session_id: String = session_id.to_owned(),
    content: String = content.to_owned(),
    target_run_id: Option<String> = target_run_id.map(str::to_owned),
    execution_mode: TraditionalChildExecutionMode = execution_mode,
    wait_id: Option<String> = wait_id.map(str::to_owned),
    review_intent: String = review_intent.to_owned(),
}
call |command| (&command.session_id, &command.content, command.target_run_id.as_deref(), command.execution_mode, command.wait_id.as_deref(), &command.review_intent)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

#[derive(Default)]
struct InboxAdmission<'a> {
    child: Option<(TraditionalChildExecutionMode, Option<&'a str>)>,
    review_intent: Option<&'a str>,
}

fn create_inbox_item(
    path: &Path,
    session_id: &str,
    delivery: InboxDelivery,
    content: &str,
    target_run_id: Option<&str>,
    client_id: Option<&str>,
    admission: InboxAdmission<'_>,
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
    if let Some((mode, Some(id))) = admission.child {
        uuid::Uuid::parse_str(id)?;
        if mode != TraditionalChildExecutionMode::Foreground {
            return Err(anyhow!("only foreground child input can own a waiter"));
        }
    }
    let connection = open_runtime_connection(path)?;
    let now = now_utc();
    connection.execute(
        "INSERT INTO session_inbox
         (session_id, delivery, status, content, target_run_id, client_id,
          created_at, updated_at, child_execution_mode, child_wait_id, review_intent)
         VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?6, ?7, ?8, ?9)",
        params![
            session_id,
            delivery.as_str(),
            content,
            target_run_id,
            client_id,
            now,
            admission.child.map(|(mode, _)| mode.as_str()),
            admission.child.and_then(|(_, wait_id)| wait_id),
            admission.review_intent,
        ],
    )?;
    load_session_inbox_item_with_connection(&connection, session_id, connection.last_insert_rowid())
}

coordinated_command! {
pub fn load_session_inbox_item(
    path: &Path,
    session_id: &str,
    item_id: i64,
) -> Result<SessionInboxRecord> {
    let connection = open_runtime_connection(path)?;
    load_session_inbox_item_with_connection(&connection, session_id, item_id)
}
command LoadSessionInboxItemCommand {
    session_id: String = session_id.to_owned(),
    item_id: i64 = item_id,
}
call |command| (&command.session_id, command.item_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
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

coordinated_command! {
pub fn list_session_inbox(path: &Path, session_id: &str) -> Result<Vec<SessionInboxRecord>> {
    let connection = open_runtime_connection(path)?;
    let mut statement = connection.prepare(&format!(
        "SELECT {INBOX_RECORD_COLUMNS} FROM session_inbox
         WHERE session_id = ?1 ORDER BY id ASC"
    ))?;
    let rows = statement.query_map(params![session_id], row_to_inbox_record)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}
command ListSessionInboxCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
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
command NextPendingSessionInboxItemCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
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
command UpdatePendingSessionInboxItemCommand {
    session_id: String = session_id.to_owned(),
    item_id: i64 = item_id,
    expected_version: i64 = expected_version,
    delivery: InboxDelivery = delivery,
    target_run_id: Option<String> = target_run_id.map(str::to_owned),
}
call |command| (&command.session_id, command.item_id, command.expected_version, command.delivery, command.target_run_id.as_deref())
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
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
command CancelPendingSessionInboxItemCommand {
    session_id: String = session_id.to_owned(),
    item_id: i64 = item_id,
    expected_version: i64 = expected_version,
}
call |command| (&command.session_id, command.item_id, command.expected_version)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
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
    fn child_input_persists_mode_waiter_and_raw_person_intent_together() {
        let path = temp_store_path("child_person_admission");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "child");
        let raw = "  inspect only; do not publish  ";
        for mode in [
            TraditionalChildExecutionMode::Foreground,
            TraditionalChildExecutionMode::Background,
        ] {
            let wait_id = (mode == TraditionalChildExecutionMode::Foreground)
                .then(|| uuid::Uuid::new_v4().to_string());
            let item = create_person_traditional_child_inbox_item(
                &path,
                "child",
                raw,
                Some("run"),
                mode,
                wait_id.as_deref(),
                raw,
            )
            .unwrap();
            assert_eq!(item.content, raw.trim());
            assert_eq!(item.child_execution_mode, Some(mode));
            assert_eq!(item.child_wait_id, wait_id);
            let connection = open_runtime_connection(&path).unwrap();
            let intent: Option<String> = connection
                .query_row(
                    "SELECT review_intent FROM session_inbox WHERE id = ?1",
                    params![item.id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(intent.as_deref(), Some(raw));
            assert_eq!(
                crate::sessions::load_permission_review_intent(&path, "child").unwrap(),
                crate::sessions::ReviewIntent::NeverRecorded,
                "enqueue does not deliver the person's intent"
            );
        }
        let before = list_session_inbox(&path, "child").unwrap();
        assert!(create_person_traditional_child_inbox_item(
            &path,
            "child",
            raw,
            Some("run"),
            TraditionalChildExecutionMode::Background,
            Some(&uuid::Uuid::new_v4().to_string()),
            raw,
        )
        .is_err());
        assert_eq!(list_session_inbox(&path, "child").unwrap(), before);
        let automation = create_traditional_child_inbox_item(
            &path,
            "child",
            "automation",
            Some("run"),
            TraditionalChildExecutionMode::Background,
            None,
        )
        .unwrap();
        let connection = open_runtime_connection(&path).unwrap();
        let intent: Option<String> = connection
            .query_row(
                "SELECT review_intent FROM session_inbox WHERE id = ?1",
                params![automation.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(intent.is_none());
        drop(connection);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
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
