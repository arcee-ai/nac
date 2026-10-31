//! Durable exact questions. Direct run UUIDs are their immutable source
//! generation; child/managed relationship generations have separate owners.
use super::*;

mod answers;
pub(crate) use answers::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuestionError {
    Invalid,
    NotFound,
    Conflict,
    HumanRequired,
    Unavailable,
}
impl std::fmt::Display for QuestionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Invalid => "invalid question: IDs, text or choices exceed the compact question contract",
            Self::NotFound => "question was not found",
            Self::Conflict => "question identity, revision, owner binding or continuation changed; read the exact request",
            Self::HumanRequired => "this question requires a human decision; agent answers are forbidden",
            Self::Unavailable => "questions require an existing plain direct Local owner",
        })
    }
}
impl std::error::Error for QuestionError {}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum QuestionResponder {
    Information,
    HumanDecision,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct QuestionRequest {
    pub session_id: String,
    pub request_id: String,
    pub run_id: String,
    pub generation: String,
    pub text: String,
    pub choices: Vec<String>,
    pub responder_class: QuestionResponder,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct QuestionAnswer {
    pub request_id: String,
    pub run_id: String,
    pub generation: String,
    pub expected_revision: i64,
    pub answer: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct QuestionAnswerReceipt {
    pub session_id: String,
    pub request_id: String,
    pub run_id: String,
    pub generation: String,
    pub revision: i64,
    pub answer: String,
    pub continuation_run_id: String,
    pub inbox_item_id: i64,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct QuestionRecord {
    pub request: QuestionRequest,
    pub revision: i64,
    pub status: String,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub goal_id: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub answer: Option<QuestionAnswerReceipt>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub continuation_state: Option<String>,
    pub created_at: String,
    #[serde(skip)]
    #[cfg_attr(feature = "openapi", schema(ignore))]
    config_version: i64,
    #[serde(skip)]
    #[cfg_attr(feature = "openapi", schema(ignore))]
    project_id: Option<String>,
    #[serde(skip)]
    #[cfg_attr(feature = "openapi", schema(ignore))]
    creation_digest: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub(crate) struct QuestionCreationReceipt {
    pub request: QuestionRequest,
    pub revision: i64,
    pub goal_id: Option<String>,
    pub created_at: String,
}
impl QuestionRecord {
    pub(crate) fn creation_receipt(&self) -> QuestionCreationReceipt {
        QuestionCreationReceipt {
            request: self.request.clone(),
            revision: 1,
            goal_id: self.goal_id.clone(),
            created_at: self.created_at.clone(),
        }
    }
}

pub(super) fn create_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS task_questions (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        request_id TEXT NOT NULL CHECK(length(request_id)>0),
        request_json TEXT NOT NULL,
        creation_digest TEXT NOT NULL,
        config_version INTEGER NOT NULL CHECK(config_version>=0),
        project_id TEXT,
        goal_id TEXT,
        revision INTEGER NOT NULL CHECK(revision>0),
        status TEXT NOT NULL CHECK(status IN ('pending','answered','cancelled')),
        answer_digest TEXT,
        answer_actor TEXT,
        answer_json TEXT,
        inbox_item_id INTEGER UNIQUE,
        continuation_run_id TEXT UNIQUE,
        continuation_state TEXT CHECK(continuation_state IN ('pending','delivered','cancelled')),
        created_at TEXT NOT NULL,
        UNIQUE(session_id,request_id),
        CHECK((status='answered')=(answer_json IS NOT NULL)),
        CHECK((answer_json IS NULL)=(inbox_item_id IS NULL)),
        CHECK((answer_json IS NULL)=(continuation_run_id IS NULL)),
        CHECK((answer_json IS NULL)=(continuation_state IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_task_question
        ON task_questions(session_id) WHERE status='pending';",
    )?;
    Ok(())
}

const COLUMNS: &str = "request_json,revision,status,goal_id,answer_json,continuation_state,created_at,config_version,project_id,creation_digest";
fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<QuestionRecord> {
    fn json<T: serde::de::DeserializeOwned>(raw: String) -> rusqlite::Result<T> {
        serde_json::from_str(&raw).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })
    }
    Ok(QuestionRecord {
        request: json(row.get(0)?)?,
        revision: row.get(1)?,
        status: row.get(2)?,
        goal_id: row.get(3)?,
        answer: row.get::<_, Option<String>>(4)?.map(json).transpose()?,
        continuation_state: row.get(5)?,
        created_at: row.get(6)?,
        config_version: row.get(7)?,
        project_id: row.get(8)?,
        creation_digest: row.get(9)?,
    })
}
fn load(conn: &Connection, session: &str, request: &str) -> Result<Option<QuestionRecord>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM task_questions WHERE session_id=?1 AND request_id=?2"),
            params![session, request],
            row,
        )
        .optional()?)
}
fn project(conn: &Connection, session: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT project_id FROM session_projects WHERE session_id=?1",
            [session],
            |r| r.get(0),
        )
        .optional()?)
}
fn plain_local(conn: &Connection, session: &str) -> Result<i64> {
    let version=conn.query_row("SELECT config_version FROM sessions s WHERE session_id=?1 AND behavior='direct'
        AND host_id IS NULL AND sandbox_json IS NULL
        AND NOT EXISTS(SELECT 1 FROM traditional_children WHERE child_session_id=s.session_id)
        AND NOT EXISTS(SELECT 1 FROM managed_orchestrators WHERE orchestrator_session_id=s.session_id)", [session], |r|r.get(0)).optional()?;
    version.ok_or_else(|| QuestionError::Unavailable.into())
}
fn compatible(conn: &Connection, question: &QuestionRecord) -> Result<bool> {
    let request = &question.request;
    Ok(
        plain_local(conn, &request.session_id).ok() == Some(question.config_version)
            && project(conn, &request.session_id)? == question.project_id
            && super::session_goals::load_with_connection(conn, &request.session_id)?
                .map(|g| g.goal_id)
                == question.goal_id,
    )
}
fn valid_id(id: &str) -> bool {
    !id.trim().is_empty() && id.len() <= 160
}
fn validate(request: &QuestionRequest) -> Result<()> {
    anyhow::ensure!(
        valid_id(&request.session_id)
            && valid_id(&request.request_id)
            && uuid::Uuid::parse_str(&request.run_id).is_ok()
            && request.generation == request.run_id
            && !request.text.trim().is_empty()
            && request.text.chars().count() <= 4000
            && request.choices.len() <= 8
            && request
                .choices
                .iter()
                .all(|c| !c.trim().is_empty() && c.chars().count() <= 300)
            && request
                .choices
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                == request.choices.len(),
        QuestionError::Invalid
    );
    Ok(())
}

pub(crate) fn canonical_digest(value: &impl serde::Serialize) -> Result<String> {
    use sha2::Digest;
    Ok(format!(
        "{:x}",
        sha2::Sha256::digest(serde_json::to_vec(value)?)
    ))
}

#[cfg(test)]
pub(crate) fn create_task_question(
    path: &Path,
    request: &QuestionRequest,
    expected_config: i64,
) -> Result<QuestionRecord> {
    create_task_question_bound(path, request, expected_config, &canonical_digest(request)?)
}

coordinated_command! {
pub(crate) fn create_task_question_bound(path:&Path,request:&QuestionRequest,expected_config:i64,argument_digest:&str)->Result<QuestionRecord> {
    anyhow::ensure!(valid_id(&request.session_id)&&valid_id(&request.request_id),QuestionError::Invalid);
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(existing)=load(&tx,&request.session_id,&request.request_id)? {
        anyhow::ensure!(existing.creation_digest==argument_digest,QuestionError::Conflict);
        return Ok(existing);
    }
    validate(request)?;
    anyhow::ensure!(plain_local(&tx,&request.session_id)?==expected_config,QuestionError::Conflict);
    anyhow::ensure!(super::run_recovery::load_run_recovery_with_connection(&tx,&request.session_id)?
        .is_some_and(|run|run.run_id==request.run_id && run.status==RunRecoveryStatus::Active),QuestionError::Conflict);
    anyhow::ensure!(pending_with_connection(&tx,&request.session_id)?.is_none(),QuestionError::Conflict);
    let goal_id=super::session_goals::load_with_connection(&tx,&request.session_id)?.map(|g|g.goal_id);
    tx.execute("INSERT INTO task_questions(session_id,request_id,request_json,config_version,project_id,goal_id,revision,status,created_at,creation_digest)
        VALUES(?1,?2,?3,?4,?5,?6,1,'pending',?7,?8)",params![request.session_id,request.request_id,serde_json::to_string(request)?,expected_config,project(&tx,&request.session_id)?,goal_id,now_utc(),argument_digest])?;
    let question=load(&tx,&request.session_id,&request.request_id)?.ok_or(QuestionError::NotFound)?;
    tx.commit()?;
    super::goal_changes::question_committed(path,&question);
    Ok(question)
}
command CreateTaskQuestion { request:QuestionRequest=request.clone(), expected_config:i64=expected_config,argument_digest:String=argument_digest.to_owned() }
call |command| (&command.request,command.expected_config,&command.argument_digest)
correlation |command| crate::telemetry::Correlation::session(Some(&command.request.session_id));
port internal;
}

coordinated_command! {
pub fn load_task_question(path:&Path,session_id:&str,request_id:&str)->Result<Option<QuestionRecord>> {
    let conn=open_runtime_connection(path)?;
    load(&conn,session_id,request_id)
}
command LoadTaskQuestion { session_id:String=session_id.to_owned(),request_id:String=request_id.to_owned() }
call |command| (&command.session_id,&command.request_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub fn list_task_questions(path:&Path,session_id:&str)->Result<Vec<QuestionRecord>> {
    let conn=open_runtime_connection(path)?;
    let mut stmt=conn.prepare(&format!("SELECT {COLUMNS} FROM task_questions WHERE session_id=?1 ORDER BY (status='pending') DESC,id DESC LIMIT 32"))?;
    let rows=stmt.query_map([session_id],row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
command ListTaskQuestions { session_id:String=session_id.to_owned() }
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

pub(crate) fn pending_with_connection(
    conn: &Connection,
    session: &str,
) -> Result<Option<QuestionRecord>> {
    let found = conn
        .query_row(
            &format!(
                "SELECT {COLUMNS} FROM task_questions WHERE session_id=?1 AND status='pending'"
            ),
            [session],
            row,
        )
        .optional()?;
    match found {
        Some(q) if compatible(conn, &q)? => Ok(Some(q)),
        _ => Ok(None),
    }
}

coordinated_command! {
pub(crate) fn pending_task_question(path:&Path,session_id:&str)->Result<Option<QuestionRecord>> {
    let conn=open_runtime_connection(path)?;
    pending_with_connection(&conn,session_id)
}
command PendingTaskQuestion { session_id:String=session_id.to_owned() }
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

#[cfg(test)]
mod tests;
