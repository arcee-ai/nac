//! Coherent project source DATA; no writer exclusion, reuse terminal or admission.
use super::projects::{row_to_project_at, PROJECT_COLUMNS};
use super::*;

/// A project and its real native source revision from ONE committed read view.
/// This can be read without a saved model row. It does not select first-chat
/// reuse, retain a source lease, or qualify a directory, host or runtime.
/// No Debug/Serialize: private paths remain outside public projections.
pub struct ProjectSource {
    pub record: ProjectRecord,
    pub revision: i64,
}

type SourceResult = std::result::Result<ProjectSource, ProjectStoreError>;
fn source_unavailable() -> ProjectStoreError {
    ProjectStoreError::Store(anyhow!("project source unavailable"))
}

coordinated_command! {
/// Observe the runtime-relevant project source counter, including association
/// changes. Presentation counters and timestamps are not source revisions.
/// Missing/corrupt rows or nonpositive revisions refuse without defaults.
pub fn load_project_source(path: &Path, project_id: &str) -> SourceResult {
    let connection = open_runtime_connection(path).map_err(|_| source_unavailable())?;
    let columns = PROJECT_COLUMNS.split(',')
        .map(|column| format!("p.{}",column.trim()))
        .collect::<Vec<_>>().join(", ");
    connection.query_row(
        &format!("SELECT {columns}, r.revision FROM projects p
            JOIN native_source_revisions r ON r.kind='project' AND r.resource_id=p.project_id
            WHERE p.project_id=?1 AND typeof(r.revision)='integer' AND r.revision>0"),
        params![project_id],
        |row| Ok(ProjectSource {
            record: row_to_project_at(row, 0)?,
            revision: row.get(13)?,
        }),
    ).map_err(|_| source_unavailable())
}
command LoadProjectSourceCommand {
    project_id: String = project_id.to_owned(),
}
call |command| (&command.project_id)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

#[cfg(test)]
#[path = "project_source_tests.rs"]
mod tests;
