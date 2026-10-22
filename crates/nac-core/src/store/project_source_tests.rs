use super::*;

struct TemporaryStore(PathBuf);
impl Drop for TemporaryStore {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn fixture() -> (TemporaryStore, PathBuf) {
    let directory = TemporaryStore(
        std::env::temp_dir().join(format!("nac-project-source-{}", uuid::Uuid::new_v4())),
    );
    let path = directory.0.join("store.db");
    initialize(&path).unwrap();
    open_runtime_connection(&path).unwrap().execute("INSERT INTO projects(project_id,name,cwd,created_at,updated_at) VALUES('project','Project','/revision-1','a','a')", []).unwrap();
    (directory, path)
}

#[test]
fn project_source_binds_runtime_and_association_changes_without_reading_a_model() {
    let (_directory, path) = fixture();
    let first = load_project_source(&path, "project").unwrap();
    assert_eq!(first.revision, 1);
    assert!(first.record.default_model_config_id.is_none());
    assert!(list_model_configurations(&path).unwrap().is_empty());
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "UPDATE projects SET name='Cosmetic', presentation_version=presentation_version+1",
            [],
        )
        .unwrap();
    let cosmetic = load_project_source(&path, "project").unwrap();
    assert_eq!(cosmetic.record.name, "Cosmetic");
    assert!(cosmetic.record.presentation_version > first.record.presentation_version);
    assert_eq!(cosmetic.revision, first.revision);
    connection
        .execute("UPDATE projects SET cwd='/changed'", [])
        .unwrap();
    let changed = load_project_source(&path, "project").unwrap();
    assert_eq!(changed.record.cwd, PathBuf::from("/changed"));
    assert!(changed.revision > cosmetic.revision);
    super::super::insert_test_session(&path, "existing");
    connection
        .execute(
            "INSERT INTO session_projects(session_id,project_id) VALUES('existing','project')",
            [],
        )
        .unwrap();
    let associated = load_project_source(&path, "project").unwrap();
    assert!(associated.revision > changed.revision);
    connection
        .execute(
            "DELETE FROM session_projects WHERE session_id='existing'",
            [],
        )
        .unwrap();
    assert!(load_project_source(&path, "project").unwrap().revision > associated.revision);
}

#[test]
fn project_source_refuses_missing_or_nonpositive_revision_and_retains_aba() {
    let (_directory, path) = fixture();
    let first = load_project_source(&path, "project").unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute("DELETE FROM projects WHERE project_id='project'", [])
        .unwrap();
    assert!(load_project_source(&path, "project").is_err());
    connection.execute("INSERT INTO projects(project_id,name,cwd,created_at,updated_at) VALUES('project','Replacement','/replaced','a','a')", []).unwrap();
    let replacement = load_project_source(&path, "project").unwrap();
    assert!(replacement.revision > first.revision);
    assert_eq!(replacement.record.name, "Replacement");
    connection.execute_batch("DROP TRIGGER native_source_revision_no_delete; DELETE FROM native_source_revisions WHERE kind='project';").unwrap();
    assert!(load_project_source(&path, "project").is_err());
    connection
        .execute(
            "INSERT INTO native_source_revisions VALUES('project','project',0)",
            [],
        )
        .unwrap();
    assert!(load_project_source(&path, "project").is_err());
    assert!(load_project_source(&path, "absent").is_err());
}

#[test]
fn project_source_corrupt_private_values_are_not_echoed() {
    let (_directory, path) = fixture();
    open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE projects SET cwd=?1",
            [b"PRIVATE_SENTINEL_PATH".as_slice()],
        )
        .unwrap();
    let error = load_project_source(&path, "project").err().unwrap();
    assert!(!format!("{error:?} {error}").contains("PRIVATE_SENTINEL"));
}

#[test]
fn project_source_never_pairs_a_row_with_another_committed_revision() {
    let (_directory, path) = fixture();
    let writer_path = path.clone();
    let start = std::sync::Arc::new(std::sync::Barrier::new(2));
    let writer_start = start.clone();
    let writer = std::thread::spawn(move || {
        let connection = open_runtime_connection(&writer_path).unwrap();
        writer_start.wait();
        for _ in 0..100 {
            connection.execute("UPDATE projects SET cwd='/revision-' || (SELECT revision+2 FROM native_source_revisions WHERE kind='project' AND resource_id='project') WHERE project_id='project'", []).unwrap();
        }
    });
    start.wait();
    for _ in 0..100 {
        let source = load_project_source(&path, "project").unwrap();
        assert_eq!(
            source.record.cwd,
            PathBuf::from(format!("/revision-{}", source.revision))
        );
    }
    writer.join().unwrap();
    assert_eq!(load_project_source(&path, "project").unwrap().revision, 201);
}

#[tokio::test(flavor = "current_thread")]
async fn project_source_uses_the_same_actual_typed_coordinator() {
    let (_directory, path) = fixture();
    let coordinator = StoreCoordinator::acquire(&path).unwrap();
    let before = coordinator.stats().completed;
    let source = coordinator
        .load_project_source("project".into())
        .await
        .unwrap();
    assert_eq!(source.revision, 1);
    assert_eq!(source.record.project_id, "project");
    assert_eq!(coordinator.stats().completed, before + 1);
    coordinator.shutdown().await.unwrap();
}
