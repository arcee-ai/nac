//! Unified spawn-assignment rows. Dual-written beside
//! `traditional_children` and `managed_orchestrators` until those tables drop.

use super::managed_orchestrators::load_with_connection;
use super::traditional_children::load_child_with_connection;
use super::*;

use rusqlite::{params, OptionalExtension};

use crate::sessions::SessionBehavior;

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum SessionAssignmentChildBehavior {
    Direct,
    Orchestrator,
}

impl SessionAssignmentChildBehavior {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Orchestrator => "orchestrator",
        }
    }
}

impl std::str::FromStr for SessionAssignmentChildBehavior {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "direct" => Ok(Self::Direct),
            "orchestrator" => Ok(Self::Orchestrator),
            _ => Err(anyhow!(
                "unsupported session assignment child behavior '{value}'"
            )),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionAssignmentRecord {
    pub assignment_id: String,
    pub child_session_id: String,
    pub parent_session_id: String,
    pub root_session_id: String,
    pub child_behavior: SessionAssignmentChildBehavior,
    pub parent_behavior: SessionBehavior,
    pub description: String,
    pub status: TraditionalChildStatus,
    pub generation: u64,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub run_id: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub execution_mode: Option<TraditionalChildExecutionMode>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub report: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub failure: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub change_summary: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub verification_summary: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub completion_inbox_id: Option<i64>,
    pub completion_suppressed: bool,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub frozen_message_count: Option<u64>,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

const COLUMNS: &str = "assignment_id, child_session_id, parent_session_id, root_session_id, \
     child_behavior, parent_behavior, description, status, generation, run_id, \
     execution_mode, report, failure, change_summary, verification_summary, \
     completion_inbox_id, completion_suppressed, frozen_message_count, created_at, \
     updated_at, version";

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionAssignmentRecord> {
    let child_behavior: String = row.get(4)?;
    let parent_behavior: String = row.get(5)?;
    let status: String = row.get(7)?;
    let execution_mode: Option<String> = row.get(10)?;
    Ok(SessionAssignmentRecord {
        assignment_id: row.get(0)?,
        child_session_id: row.get(1)?,
        parent_session_id: row.get(2)?,
        root_session_id: row.get(3)?,
        child_behavior: child_behavior.parse().map_err(|error: anyhow::Error| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, error.into())
        })?,
        parent_behavior: parent_behavior.parse().map_err(|error: anyhow::Error| {
            rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, error.into())
        })?,
        description: row.get(6)?,
        status: status.parse().map_err(|error: anyhow::Error| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, error.into())
        })?,
        generation: row.get(8)?,
        run_id: row.get(9)?,
        execution_mode: execution_mode
            .map(|value| value.parse())
            .transpose()
            .map_err(|error: anyhow::Error| {
                rusqlite::Error::FromSqlConversionFailure(
                    10,
                    rusqlite::types::Type::Text,
                    error.into(),
                )
            })?,
        report: row.get(11)?,
        failure: row.get(12)?,
        change_summary: row.get(13)?,
        verification_summary: row.get(14)?,
        completion_inbox_id: row.get(15)?,
        completion_suppressed: row.get(16)?,
        frozen_message_count: row
            .get::<_, Option<i64>>(17)?
            .map(u64::try_from)
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    17,
                    rusqlite::types::Type::Integer,
                    error.into(),
                )
            })?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
        version: row.get(20)?,
    })
}

fn assignment_id_for_child(child_session_id: &str) -> String {
    format!("asgn_{child_session_id}")
}

fn parent_behavior_for_assignment(
    connection: &rusqlite::Connection,
    parent_session_id: &str,
) -> Result<String> {
    let behavior: String = connection
        .query_row(
            "SELECT behavior FROM sessions WHERE session_id = ?1",
            params![parent_session_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| anyhow!("parent session '{parent_session_id}' was not found"))?;
    if behavior != "direct" && behavior != "direct-with-orchestrator" {
        return Err(anyhow!(
            "session assignments require an agent parent, not '{behavior}'"
        ));
    }
    Ok(behavior)
}

fn upsert_session_assignment_with_connection(
    connection: &rusqlite::Connection,
    child_session_id: &str,
    parent_session_id: &str,
    root_session_id: &str,
    child_behavior: SessionAssignmentChildBehavior,
    description: &str,
    status: TraditionalChildStatus,
    generation: u64,
    run_id: Option<&str>,
    execution_mode: Option<TraditionalChildExecutionMode>,
    report: Option<&str>,
    failure: Option<&str>,
    change_summary: Option<&str>,
    verification_summary: Option<&str>,
    completion_inbox_id: Option<i64>,
    completion_suppressed: bool,
    frozen_message_count: Option<u64>,
    created_at: &str,
    updated_at: &str,
    version: i64,
) -> Result<()> {
    let parent_behavior = parent_behavior_for_assignment(connection, parent_session_id)?;
    connection.execute(
        "INSERT INTO session_assignments
         (assignment_id, child_session_id, parent_session_id, root_session_id,
          child_behavior, parent_behavior, description, status, generation, run_id,
          execution_mode, report, failure, change_summary, verification_summary,
          completion_inbox_id, completion_suppressed, frozen_message_count,
          created_at, updated_at, version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                 ?16, ?17, ?18, ?19, ?20, ?21)
         ON CONFLICT(child_session_id) DO UPDATE SET
          parent_session_id = excluded.parent_session_id,
          root_session_id = excluded.root_session_id,
          child_behavior = excluded.child_behavior,
          parent_behavior = excluded.parent_behavior,
          description = excluded.description,
          status = excluded.status,
          generation = excluded.generation,
          run_id = excluded.run_id,
          execution_mode = excluded.execution_mode,
          report = excluded.report,
          failure = excluded.failure,
          change_summary = excluded.change_summary,
          verification_summary = excluded.verification_summary,
          completion_inbox_id = excluded.completion_inbox_id,
          completion_suppressed = excluded.completion_suppressed,
          frozen_message_count = excluded.frozen_message_count,
          updated_at = excluded.updated_at,
          version = excluded.version",
        params![
            assignment_id_for_child(child_session_id),
            child_session_id,
            parent_session_id,
            root_session_id,
            child_behavior.as_str(),
            parent_behavior,
            description,
            status.as_str(),
            generation,
            run_id,
            execution_mode.map(TraditionalChildExecutionMode::as_str),
            report,
            failure,
            change_summary,
            verification_summary,
            completion_inbox_id,
            completion_suppressed,
            frozen_message_count.map(|value| value as i64),
            created_at,
            updated_at,
            version,
        ],
    )?;
    Ok(())
}

pub(crate) fn sync_assignment_from_traditional_child(
    connection: &rusqlite::Connection,
    child_session_id: &str,
) -> Result<()> {
    let Some(child) = load_child_with_connection(connection, child_session_id)? else {
        return Ok(());
    };
    let completion_suppressed: bool = connection.query_row(
        "SELECT completion_suppressed FROM traditional_children WHERE child_session_id = ?1",
        params![child_session_id],
        |row| row.get(0),
    )?;
    upsert_session_assignment_with_connection(
        connection,
        &child.child_session_id,
        &child.parent_session_id,
        &child.root_session_id,
        SessionAssignmentChildBehavior::Direct,
        &child.description,
        child.status,
        child.generation,
        child.run_id.as_deref(),
        child.execution_mode,
        child.report.as_deref(),
        child.failure.as_deref(),
        child.change_summary.as_deref(),
        child.verification_summary.as_deref(),
        child.completion_inbox_id,
        completion_suppressed,
        child.frozen_message_count,
        &child.created_at,
        &child.updated_at,
        child.version,
    )
}

pub(crate) fn sync_assignment_from_managed_orchestrator(
    connection: &rusqlite::Connection,
    orchestrator_session_id: &str,
) -> Result<()> {
    let Some(orchestrator) = load_with_connection(connection, orchestrator_session_id)? else {
        return Ok(());
    };
    let completion_suppressed: bool = connection.query_row(
        "SELECT completion_suppressed FROM managed_orchestrators
         WHERE orchestrator_session_id = ?1",
        params![orchestrator_session_id],
        |row| row.get(0),
    )?;
    upsert_session_assignment_with_connection(
        connection,
        &orchestrator.orchestrator_session_id,
        &orchestrator.parent_session_id,
        &orchestrator.root_session_id,
        SessionAssignmentChildBehavior::Orchestrator,
        &orchestrator.description,
        orchestrator.status,
        orchestrator.generation,
        orchestrator.run_id.as_deref(),
        orchestrator.execution_mode,
        orchestrator.report.as_deref(),
        orchestrator.failure.as_deref(),
        None,
        None,
        orchestrator.completion_inbox_id,
        completion_suppressed,
        orchestrator.frozen_message_count,
        &orchestrator.created_at,
        &orchestrator.updated_at,
        orchestrator.version,
    )
}

pub fn load_session_assignment(
    path: &Path,
    child_session_id: &str,
) -> Result<Option<SessionAssignmentRecord>> {
    let connection = open_runtime_connection(path)?;
    load_session_assignment_with_connection(&connection, child_session_id)
}

pub(crate) fn load_session_assignment_with_connection(
    connection: &rusqlite::Connection,
    child_session_id: &str,
) -> Result<Option<SessionAssignmentRecord>> {
    Ok(connection
        .query_row(
            &format!("SELECT {COLUMNS} FROM session_assignments WHERE child_session_id = ?1"),
            params![child_session_id],
            row_to_record,
        )
        .optional()?)
}

pub fn load_session_assignment_for_parent(
    path: &Path,
    parent_session_id: &str,
    child_session_id: &str,
) -> Result<Option<SessionAssignmentRecord>> {
    let connection = open_runtime_connection(path)?;
    Ok(connection
        .query_row(
            &format!(
                "SELECT {COLUMNS} FROM session_assignments
                 WHERE parent_session_id = ?1 AND child_session_id = ?2"
            ),
            params![parent_session_id, child_session_id],
            row_to_record,
        )
        .optional()?)
}

pub fn list_suppressed_session_assignment_generations(
    path: &Path,
    parent_session_id: &str,
) -> Result<Vec<(String, u64, SessionAssignmentChildBehavior)>> {
    let connection = open_runtime_connection(path)?;
    let mut statement = connection.prepare(
        "SELECT child_session_id, generation, child_behavior FROM session_assignments
         WHERE parent_session_id = ?1 AND completion_suppressed = 1
         ORDER BY child_session_id",
    )?;
    let rows = statement.query_map(params![parent_session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, u64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut records = Vec::new();
    for row in rows {
        let (child_session_id, generation, child_behavior) = row?;
        records.push((child_session_id, generation, child_behavior.parse()?));
    }
    Ok(records)
}

pub fn list_session_assignments(
    path: &Path,
    parent_session_id: &str,
) -> Result<Vec<SessionAssignmentRecord>> {
    let connection = open_runtime_connection(path)?;
    let mut statement = connection.prepare(&format!(
        "SELECT {COLUMNS} FROM session_assignments
         WHERE parent_session_id = ?1
         ORDER BY created_at ASC, child_session_id ASC"
    ))?;
    let rows = statement.query_map(params![parent_session_id], row_to_record)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir()
            .join(format!(
                "nac_session_assignments_{label}_{}",
                uuid::Uuid::new_v4()
            ))
            .join("store.db");
        initialize(&path).unwrap();
        insert_test_session(&path, "parent");
        insert_test_session(&path, "child");
        insert_test_session(&path, "orchestrator");
        let connection = open_runtime_connection(&path).unwrap();
        connection
            .execute(
                "UPDATE sessions SET behavior = CASE session_id
                    WHEN 'parent' THEN 'direct'
                    WHEN 'child' THEN 'direct'
                    ELSE 'orchestrator' END
                 WHERE session_id IN ('parent', 'child', 'orchestrator')",
                [],
            )
            .unwrap();
        path
    }

    #[test]
    fn create_begin_and_settle_dual_write_both_assignment_kinds() {
        let path = fixture("dual_write");
        create_traditional_child_relationship(
            &path,
            "parent",
            "child",
            GENERAL_CHILD_PROFILE,
            "review store",
        )
        .unwrap();
        create_managed_orchestrator_relationship(&path, "parent", "orchestrator", "plan the work")
            .unwrap();

        assert_eq!(
            load_assignment(&path, "child")
                .unwrap()
                .unwrap()
                .parent_session_id,
            "parent"
        );
        let listed = list_session_assignments(&path, "parent").unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].child_session_id, "child");
        assert_eq!(
            listed[0].child_behavior,
            SessionAssignmentChildBehavior::Direct
        );
        assert_eq!(listed[0].status, TraditionalChildStatus::Idle);
        assert_eq!(listed[1].child_session_id, "orchestrator");
        assert_eq!(
            listed[1].child_behavior,
            SessionAssignmentChildBehavior::Orchestrator
        );

        let child = begin_traditional_child_run(
            &path,
            "child",
            "run-child",
            TraditionalChildExecutionMode::Foreground,
        )
        .unwrap();
        let assignment = load_session_assignment(&path, "child").unwrap().unwrap();
        assert_eq!(assignment.status, TraditionalChildStatus::Running);
        assert_eq!(assignment.generation, child.generation);
        assert_eq!(assignment.run_id.as_deref(), Some("run-child"));

        settle_traditional_child_run(
            &path,
            "child",
            "run-child",
            TraditionalChildTerminal {
                status: TraditionalChildStatus::Completed,
                report: Some("done".to_string()),
                failure: None,
                change_summary: Some("touched one file".to_string()),
                verification_summary: Some("tests passed".to_string()),
            },
        )
        .unwrap();
        let settled = load_session_assignment(&path, "child").unwrap().unwrap();
        assert_eq!(settled.status, TraditionalChildStatus::Completed);
        assert_eq!(settled.report.as_deref(), Some("done"));
        assert_eq!(settled.change_summary.as_deref(), Some("touched one file"));
        assert!(settled.frozen_message_count.is_some());
    }

    #[test]
    fn backfill_copies_legacy_rows_without_changing_assignment_ids() {
        let path = fixture("backfill");
        create_traditional_child_relationship(
            &path,
            "parent",
            "child",
            GENERAL_CHILD_PROFILE,
            "legacy child",
        )
        .unwrap();
        let first = load_session_assignment(&path, "child").unwrap().unwrap();
        let connection = open_runtime_connection(&path).unwrap();
        connection
            .execute("DELETE FROM session_assignments", [])
            .unwrap();
        drop(connection);
        initialize(&path).unwrap();
        let restored = load_session_assignment(&path, "child").unwrap().unwrap();
        assert_eq!(restored.assignment_id, first.assignment_id);
        assert_eq!(restored.description, "legacy child");
        assert_eq!(
            restored.child_behavior,
            SessionAssignmentChildBehavior::Direct
        );
    }
}
