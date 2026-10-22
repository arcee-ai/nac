//! Bounded committed source identity for passive cached-session observations.
//! This reads original durable counters; it issues no reservation or runtime.
use std::path::Path;

use anyhow::{ensure, Result};

use super::{
    native_source_reservation::{source_revision, SourceKind},
    open_initialized_read_connection,
};
use crate::sessions::SessionBehavior;

/// Actual committed identity, not a construction/admission capability. The
/// private session counter participates in equality to detect config/link ABA
/// during a bounded read; it is not a caller-issued or externally hashed value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExistingSessionSource {
    pub session_id: String,
    pub project_id: String,
    pub project_revision: i64,
    pub config_version: i64,
    pub behavior: SessionBehavior,
    session_revision: i64,
}

/// The caller retains its original store executor and host replacement guard.
/// An initialized read-only connection cannot create/migrate/repair the store.
/// One read transaction keeps the session, association and counters coherent.
pub fn observe_existing_session_source(
    path: &Path,
    session_id: &str,
    project_id: &str,
) -> Result<ExistingSessionSource> {
    ensure!(
        !session_id.is_empty()
            && session_id.len() <= 128
            && !session_id.contains('\0')
            && !project_id.is_empty()
            && project_id.len() <= 256
            && !project_id.contains('\0'),
        "invalid passive source selector"
    );
    let mut connection = open_initialized_read_connection(path)?;
    let transaction = connection.transaction()?;
    let (actual_session, actual_project, behavior, config_version): (String, String, String, i64) =
        transaction.query_row(
            "SELECT s.session_id, p.project_id, s.behavior, s.config_version
             FROM sessions s JOIN session_projects sp ON sp.session_id=s.session_id
             JOIN projects p ON p.project_id=sp.project_id
             WHERE s.session_id=?1 AND p.project_id=?2",
            rusqlite::params![session_id, project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
    let project_revision = source_revision(&transaction, SourceKind::Project, &actual_project)?;
    let session_revision = source_revision(&transaction, SourceKind::Session, &actual_session)?;
    ensure!(
        project_revision > 0 && session_revision > 0 && config_version >= 0,
        "passive source version unavailable"
    );
    let source = ExistingSessionSource {
        session_id: actual_session,
        project_id: actual_project,
        project_revision,
        config_version,
        behavior: behavior.parse()?,
        session_revision,
    };
    transaction.commit()?;
    Ok(source)
}

/// Same canonical summary ordering and lineage record decoders used by the
/// existing first-chat selector, read from one initialized read-only snapshot.
/// These are private-source DATA; delivery projects only the chosen identity.
pub struct ProjectFirstChatCandidates {
    pub summaries: Vec<crate::sessions::SessionSummary>,
    pub lineage_sessions: std::collections::BTreeSet<String>,
    pub project_revision: i64,
}

pub fn observe_project_first_chat_candidates(
    path: &Path,
    project_id: &str,
    cutoff: std::time::Instant,
) -> Result<ProjectFirstChatCandidates> {
    ensure!(
        !project_id.is_empty() && project_id.len() <= 256 && !project_id.contains('\0'),
        "invalid passive project selector"
    );
    ensure!(
        std::time::Instant::now() < cutoff,
        "passive source cutoff expired"
    );
    let mut connection = open_initialized_read_connection(path)?;
    let transaction = connection.transaction()?;
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE project_id=?1)",
        [project_id],
        |row| row.get(0),
    )?;
    ensure!(exists, "passive project unavailable");
    // Preserve canonical global summary order without allocating an unbounded
    // catalog. Capacity refusal never picks a different candidate.
    let count: i64 =
        transaction.query_row("SELECT count(*) FROM sessions", [], |row| row.get(0))?;
    ensure!(
        (0..=4096).contains(&count),
        "passive selection capacity exceeded"
    );
    let summaries = crate::sessions::list_sessions_with_connection(&transaction)?
        .into_iter()
        .filter(|summary| summary.project_id.as_deref() == Some(project_id))
        .collect::<Vec<_>>();
    let mut lineage_sessions = std::collections::BTreeSet::new();
    for summary in &summaries {
        ensure!(
            std::time::Instant::now() < cutoff,
            "passive source cutoff expired"
        );
        if super::traditional_children::load_child_with_connection(
            &transaction,
            &summary.session_id,
        )?
        .is_some()
            || super::managed_orchestrators::load_with_connection(
                &transaction,
                &summary.session_id,
            )?
            .is_some()
        {
            lineage_sessions.insert(summary.session_id.clone());
        }
    }
    let project_revision = source_revision(&transaction, SourceKind::Project, project_id)?;
    ensure!(project_revision > 0, "passive project version unavailable");
    transaction.commit()?;
    Ok(ProjectFirstChatCandidates {
        summaries,
        lineage_sessions,
        project_revision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let nonce = uuid::Uuid::new_v4();
            let root = std::env::temp_dir().join(format!("native-existing-source-{nonce}"));
            let path = root.join("store.db");
            super::super::initialize(&path).unwrap();
            super::super::insert_test_session(&path, "session");
            let connection = super::super::open_runtime_connection(&path).unwrap();
            connection
                .execute(
                    "INSERT INTO projects (project_id,name,cwd,created_at,updated_at)
                 VALUES ('project','fixture','/tmp/project','created','updated')",
                    [],
                )
                .unwrap();
            connection.execute(
                "INSERT INTO session_projects (session_id,project_id) VALUES ('session','project')", [],
            ).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(self.0.parent().unwrap()).unwrap();
        }
    }

    #[test]
    fn actual_counters_association_and_configuration_are_read_without_writes() {
        let fixture = Fixture::new();
        let before = observe_existing_session_source(&fixture.0, "session", "project").unwrap();
        let again = observe_existing_session_source(&fixture.0, "session", "project").unwrap();
        assert_eq!(before, again);
        assert_eq!(before.session_id, "session");
        assert_eq!(before.project_id, "project");
        assert!(before.project_revision > 0);
        assert!(before.session_revision > 0);
        let connection = super::super::open_runtime_connection(&fixture.0).unwrap();
        connection
            .execute(
                "UPDATE projects SET cwd='/tmp/changed' WHERE project_id='project'",
                [],
            )
            .unwrap();
        let changed = observe_existing_session_source(&fixture.0, "session", "project").unwrap();
        assert!(changed.project_revision > before.project_revision);
        assert_eq!(changed.config_version, before.config_version);
        connection
            .execute(
                "UPDATE sessions SET config_version=config_version+1 WHERE session_id='session'",
                [],
            )
            .unwrap();
        let config = observe_existing_session_source(&fixture.0, "session", "project").unwrap();
        assert_eq!(config.config_version, changed.config_version + 1);
        assert!(config.session_revision > changed.session_revision);
        connection
            .execute(
                "DELETE FROM session_projects WHERE session_id='session'",
                [],
            )
            .unwrap();
        assert!(observe_existing_session_source(&fixture.0, "session", "project").is_err());
        assert!(observe_existing_session_source(&fixture.0, "missing", "project").is_err());
        connection
            .execute(
                "INSERT INTO session_projects VALUES ('session','project')",
                [],
            )
            .unwrap();
        let reassociated =
            observe_existing_session_source(&fixture.0, "session", "project").unwrap();
        assert!(reassociated.project_revision > config.project_revision);
        assert!(reassociated.session_revision > config.session_revision);
    }

    #[test]
    fn absent_store_is_not_created_and_missing_revision_is_not_fabricated() {
        let root =
            std::env::temp_dir().join(format!("missing-existing-source-{}", uuid::Uuid::new_v4()));
        let missing = root.join("absent.db");
        assert!(observe_existing_session_source(&missing, "session", "project").is_err());
        assert!(!root.exists());
        let fixture = Fixture::new();
        assert!(observe_existing_session_source(&fixture.0, "session", "other-project").is_err());
        assert!(observe_existing_session_source(&fixture.0, "session", "").is_err());
        let connection = super::super::open_runtime_connection(&fixture.0).unwrap();
        // Controlled malformed fixture only. Production never repairs or
        // substitutes zero for absent authoritative source revisions.
        connection
            .execute_batch(
                "DROP TRIGGER native_source_revision_no_delete;
            DELETE FROM native_source_revisions WHERE kind='project' AND resource_id='project';",
            )
            .unwrap();
        assert!(observe_existing_session_source(&fixture.0, "session", "project").is_err());
    }
    #[test]
    fn canonical_candidate_projection_is_readonly_bounded_and_uses_original_summary_order() {
        let fixture = Fixture::new();
        let cutoff = std::time::Instant::now() + std::time::Duration::from_secs(1);
        let before = observe_existing_session_source(&fixture.0, "session", "project").unwrap();
        let actual = observe_project_first_chat_candidates(&fixture.0, "project", cutoff).unwrap();
        assert_eq!(actual.summaries.len(), 1);
        assert_eq!(actual.summaries[0].session_id, "session");
        assert!(actual.lineage_sessions.is_empty());
        assert_eq!(actual.project_revision, before.project_revision);
        assert_eq!(
            observe_existing_session_source(&fixture.0, "session", "project").unwrap(),
            before
        );
        assert!(observe_project_first_chat_candidates(
            &fixture.0,
            "project",
            std::time::Instant::now()
        )
        .is_err());
    }
}
