use super::*;

#[test]
fn store_hard_denial_covers_the_session_lease_directory_beside_it() {
    let backend = ExecutionBackend::Local {
        workspace_cwd: PathBuf::from("/workspace"),
    };
    let store = Path::new("/state/store.db");
    for (path, denied) in [
        ("/state/store.db.run-locks", true),
        ("/state/store.db.run-locks/00.lock", true),
        ("/state/store.db.run-locks-notes", false),
    ] {
        let resources = file_resources("edit", PathBuf::from(path), &backend, store, true);
        assert_eq!(resources[0].hard_denial.is_some(), denied, "{path}");
    }
}
