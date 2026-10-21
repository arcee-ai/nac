use super::*;

struct Fixture {
    root: PathBuf,
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("native-source-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("store.db");
        initialize(&path).unwrap();
        super::super::insert_test_session(&path, "template");
        Connection::open(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET backend='arcee-api' WHERE session_id='template'",
                [],
            )
            .unwrap();
        Self { root, path }
    }
    fn snapshot(&self, id: &str) -> crate::sessions::SessionSnapshot {
        let mut s = crate::sessions::load_session(&self.path, "template").unwrap();
        s.session_id = id.into();
        s
    }
    fn bind(&self, snapshot: &crate::sessions::SessionSnapshot) -> NativeSourceBinding {
        NativeSourceBinding {
            operation_id: Uuid::new_v4(),
            source_id: Uuid::new_v4(),
            source_generation: 1,
            canonical_effect_sha256: [1; 32],
            creation_snapshot_sha256: creation_snapshot_sha256(snapshot).unwrap(),
            session_id: snapshot.session_id.clone(),
            project_id: snapshot.project_id.clone(),
            sources: vec![SourceVersion {
                kind: SourceKind::Session,
                resource_id: snapshot.session_id.clone(),
                revision: 0,
            }],
        }
    }
    fn raw(&self) -> Connection {
        Connection::open(&self.path).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn reserved_absence_refuses_standalone_create_and_same_effect_replay() {
    let f = Fixture::new();
    let s = f.snapshot("intended");
    let b = f.bind(&s);
    let owner = NativeSourceReservation::reserve(
        &f.path,
        b.clone(),
        std::time::Instant::now() + std::time::Duration::from_secs(60),
    )
    .unwrap();
    assert!(crate::sessions::create_session(&f.path, &s).is_err());
    assert!(NativeSourceReservation::reserve(
        &f.path,
        b.clone(),
        std::time::Instant::now() + std::time::Duration::from_secs(60)
    )
    .is_err());
    let mut other = b;
    other.operation_id = Uuid::new_v4();
    assert!(NativeSourceReservation::reserve(
        &f.path,
        other,
        std::time::Instant::now() + std::time::Duration::from_secs(60)
    )
    .is_err());
    owner.release_known_no_start().unwrap();
    crate::sessions::create_session(&f.path, &s).unwrap();
}

#[test]
fn exact_owner_creation_restores_fences_before_commit_and_retains_unknown() {
    let f = Fixture::new();
    let s = f.snapshot("intended");
    let b = f.bind(&s);
    let owner = NativeSourceReservation::reserve(
        &f.path,
        b.clone(),
        std::time::Instant::now() + std::time::Duration::from_secs(60),
    )
    .unwrap();
    owner.begin_preparation().unwrap();
    let mut c = open_runtime_connection(&f.path).unwrap();
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    owner.insert_creation(&tx, &f.path, &s).unwrap();
    assert!(tx
        .execute(
            "UPDATE sessions SET cwd='/changed' WHERE session_id='intended'",
            []
        )
        .is_err());
    tx.commit().unwrap();
    assert!(owner
        .insert_creation(&c.transaction().unwrap(), &f.path, &s)
        .is_err());
    owner.mark_uncertain().unwrap();
    drop(owner);
    assert!(f
        .raw()
        .execute("DELETE FROM sessions WHERE session_id='intended'", [])
        .is_err());
    assert!(NativeSourceReservation::reserve(
        &f.path,
        b,
        std::time::Instant::now() + std::time::Duration::from_secs(60)
    )
    .is_err());
}

#[test]
fn failed_owned_creation_restores_slots_even_if_caller_commits_outer_transaction() {
    let f = Fixture::new();
    let s = f.snapshot("intended");
    let b = f.bind(&s);
    let owner = NativeSourceReservation::reserve(
        &f.path,
        b,
        std::time::Instant::now() + std::time::Duration::from_secs(60),
    )
    .unwrap();
    owner.begin_preparation().unwrap();
    let mut c = open_runtime_connection(&f.path).unwrap();
    c.execute_batch("CREATE TRIGGER injected_creation_failure AFTER INSERT ON sessions WHEN NEW.session_id='intended' BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    assert!(owner.insert_creation(&tx, &f.path, &s).is_err());
    tx.commit().unwrap();
    assert!(crate::sessions::create_session(&f.path, &s).is_err());
    assert_eq!(
        f.raw()
            .query_row("SELECT state FROM native_source_reservations", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "preparing"
    );
}

#[test]
fn outer_rollback_does_not_advance_the_original_owner_in_memory() {
    let f = Fixture::new();
    let s = f.snapshot("intended");
    let owner = NativeSourceReservation::reserve(
        &f.path,
        f.bind(&s),
        std::time::Instant::now() + std::time::Duration::from_secs(60),
    )
    .unwrap();
    owner.begin_preparation().unwrap();
    let mut c = open_runtime_connection(&f.path).unwrap();
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    owner.insert_creation(&tx, &f.path, &s).unwrap();
    tx.rollback().unwrap();
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    owner.insert_creation(&tx, &f.path, &s).unwrap();
    tx.commit().unwrap();
    assert!(crate::sessions::load_session(&f.path, "intended").is_ok());
}

#[test]
fn own_creation_rejects_payload_and_store_substitution() {
    let f = Fixture::new();
    let s = f.snapshot("intended");
    let owner = NativeSourceReservation::reserve(
        &f.path,
        f.bind(&s),
        std::time::Instant::now() + std::time::Duration::from_secs(60),
    )
    .unwrap();
    owner.begin_preparation().unwrap();
    let mut changed = s.clone();
    changed.cwd = PathBuf::from("/substituted");
    let mut c = open_runtime_connection(&f.path).unwrap();
    let tx = c.transaction().unwrap();
    assert!(owner.insert_creation(&tx, &f.path, &changed).is_err());
    tx.rollback().unwrap();
    let other = Fixture::new();
    let mut c = open_runtime_connection(&other.path).unwrap();
    let tx = c.transaction().unwrap();
    assert!(owner.insert_creation(&tx, &f.path, &s).is_err());
}

#[test]
fn source_revisions_detect_delete_reinsert_aba_and_model_project_changes() {
    let f = Fixture::new();
    let c = f.raw();
    c.execute_batch("INSERT INTO model_configurations(config_id,name,backend,model,base_url,created_at,updated_at) VALUES('model','model','arcee-api','a','https://example.invalid','a','a');
        INSERT INTO projects(project_id,name,cwd,created_at,updated_at) VALUES('project','project','/project','a','a');").unwrap();
    for (kind, table, key, id, update) in [
        (
            SourceKind::Model,
            "model_configurations",
            "config_id",
            "model",
            "model='b'",
        ),
        (
            SourceKind::Project,
            "projects",
            "project_id",
            "project",
            "default_model_config_id='model'",
        ),
    ] {
        let before = source_revision(&c, kind.clone(), id).unwrap();
        c.execute_batch(&format!("UPDATE {table} SET {update} WHERE {key}='{id}'"))
            .unwrap();
        assert!(source_revision(&c, kind.clone(), id).unwrap() > before);
    }
    let before = source_revision(&c, SourceKind::Session, "template").unwrap();
    let snapshot = crate::sessions::load_session(&f.path, "template").unwrap();
    crate::sessions::delete_session(&f.path, "template").unwrap();
    crate::sessions::create_session(&f.path, &snapshot).unwrap();
    assert!(source_revision(&c, SourceKind::Session, "template").unwrap() > before);
    let mut b = f.bind(&f.snapshot("intended"));
    b.sources.push(SourceVersion {
        kind: SourceKind::Session,
        resource_id: "template".into(),
        revision: before,
    });
    assert!(NativeSourceReservation::reserve(
        &f.path,
        b,
        std::time::Instant::now() + std::time::Duration::from_secs(60)
    )
    .is_err());
}

#[test]
fn reserved_session_allows_history_but_refuses_upsert_resource_changes() {
    let f = Fixture::new();
    let s = crate::sessions::load_session(&f.path, "template").unwrap();
    let mut b = f.bind(&f.snapshot("intended"));
    b.sources.push(SourceVersion {
        kind: SourceKind::Session,
        resource_id: "template".into(),
        revision: source_revision(&f.raw(), SourceKind::Session, "template").unwrap(),
    });
    let _owner = NativeSourceReservation::reserve(
        &f.path,
        b,
        std::time::Instant::now() + std::time::Duration::from_secs(60),
    )
    .unwrap();
    crate::sessions::save_session(&f.path, &s).unwrap();
    f.raw()
        .execute(
            "UPDATE sessions SET run_count=run_count+1 WHERE session_id='template'",
            [],
        )
        .unwrap();
    let mut changed = s;
    changed.cwd = PathBuf::from("/new-location");
    assert!(crate::sessions::save_session(&f.path, &changed).is_err());
    assert!(crate::sessions::delete_session(&f.path, "template").is_err());
}

#[test]
fn preparation_drop_or_denial_never_frees_durable_slots() {
    let f = Fixture::new();
    let s = f.snapshot("intended");
    let b = f.bind(&s);
    let owner = NativeSourceReservation::reserve(
        &f.path,
        b.clone(),
        std::time::Instant::now() + std::time::Duration::from_secs(60),
    )
    .unwrap();
    owner.begin_preparation().unwrap();
    assert!(owner.release_known_no_start().is_err());
    assert!(crate::sessions::create_session(&f.path, &s).is_err());
    assert!(NativeSourceReservation::reserve(
        &f.path,
        b,
        std::time::Instant::now() + std::time::Duration::from_secs(60)
    )
    .is_err());
}

#[test]
fn expiry_denies_work_without_erasing_the_original_reservation() {
    let f = Fixture::new();
    let s = f.snapshot("intended");
    let cutoff = Instant::now() + std::time::Duration::from_millis(25);
    let owner = NativeSourceReservation::reserve(&f.path, f.bind(&s), cutoff).unwrap();
    assert_eq!(owner.original_cutoff(), cutoff);
    assert_eq!(owner.binding().session_id, "intended");
    std::thread::sleep(std::time::Duration::from_millis(30));
    assert!(owner.begin_preparation().is_err());
    drop(owner);
    assert!(crate::sessions::create_session(&f.path, &s).is_err());
}

#[test]
fn tombstoned_model_and_existing_intended_session_are_not_absence_authority() {
    let f = Fixture::new();
    let c = f.raw();
    c.execute_batch("INSERT INTO model_configurations(config_id,name,backend,model,base_url,created_at,updated_at) VALUES('gone','gone','arcee-api','a','https://example.invalid','a','a'); DELETE FROM model_configurations WHERE config_id='gone';").unwrap();
    let mut b = f.bind(&f.snapshot("intended"));
    b.sources.push(SourceVersion {
        kind: SourceKind::Model,
        resource_id: "gone".into(),
        revision: source_revision(&c, SourceKind::Model, "gone").unwrap(),
    });
    assert!(NativeSourceReservation::reserve(
        &f.path,
        b,
        Instant::now() + std::time::Duration::from_secs(60)
    )
    .is_err());
    let s = crate::sessions::load_session(&f.path, "template").unwrap();
    let mut b = f.bind(&s);
    b.sources[0].revision = source_revision(&c, SourceKind::Session, "template").unwrap();
    assert!(NativeSourceReservation::reserve(
        &f.path,
        b,
        Instant::now() + std::time::Duration::from_secs(60)
    )
    .is_err());
}

#[test]
fn project_membership_reservation_blocks_phantoms_and_actual_model_writer() {
    let f = Fixture::new();
    let c = f.raw();
    c.execute_batch("INSERT INTO model_configurations(config_id,name,backend,model,base_url,created_at,updated_at) VALUES('model','model','arcee-api','a','https://example.invalid','a','a'); INSERT INTO projects(project_id,name,cwd,created_at,updated_at) VALUES('project','project','/project','a','a');").unwrap();
    let mut s = f.snapshot("intended");
    s.project_id = Some("project".into());
    let mut b = f.bind(&s);
    for (kind, id) in [
        (SourceKind::Project, "project"),
        (SourceKind::Model, "model"),
    ] {
        b.sources.push(SourceVersion {
            revision: source_revision(&c, kind.clone(), id).unwrap(),
            kind,
            resource_id: id.into(),
        });
    }
    let owner = NativeSourceReservation::reserve(
        &f.path,
        b,
        Instant::now() + std::time::Duration::from_secs(60),
    )
    .unwrap();
    assert!(c
        .execute(
            "UPDATE projects SET default_model_config_id='model' WHERE project_id='project'",
            []
        )
        .is_err());
    assert!(c
        .execute(
            "INSERT INTO session_projects VALUES('template','project')",
            []
        )
        .is_err());
    assert!(super::super::delete_model_configuration(&f.path, "model").is_err());
    owner.begin_preparation().unwrap();
    let mut c = open_runtime_connection(&f.path).unwrap();
    let tx = c.transaction().unwrap();
    owner.insert_creation(&tx, &f.path, &s).unwrap();
    tx.commit().unwrap();
    assert!(f
        .raw()
        .execute(
            "DELETE FROM session_projects WHERE session_id='intended'",
            []
        )
        .is_err());
}

#[tokio::test]
async fn managed_owner_dispatch_preserves_original_state_and_ordinary_writer_conflicts() {
    let f = Fixture::new();
    let s = f.snapshot("intended");
    let b = f.bind(&s);
    let coordinator = crate::store::StoreCoordinator::acquire(&f.path).unwrap();
    let path = f.path.clone();
    crate::store::spawn_blocking_store_caller(move || {
        let owner = NativeSourceReservation::reserve(
            &path,
            b,
            Instant::now() + std::time::Duration::from_secs(60),
        )
        .unwrap();
        owner.check_current().unwrap();
        owner.begin_preparation().unwrap();
        assert!(crate::sessions::create_session(&path, &s).is_err());
        owner.mark_uncertain().unwrap();
        assert!(owner.check_current().is_err());
    })
    .await
    .unwrap();
    coordinator.shutdown().await.unwrap();
    assert_eq!(
        f.raw()
            .query_row("SELECT state FROM native_source_reservations", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "uncertain"
    );
}

#[test]
fn reserved_child_exit_retains_original_slots() {
    let Some(root) = std::env::var_os("NAC_NATIVE_SOURCE_TEST_CHILD") else {
        return;
    };
    let root = PathBuf::from(root);
    let path = root.join("store.db");
    let binding: NativeSourceBinding =
        serde_json::from_slice(&std::fs::read(root.join("binding.json")).unwrap()).unwrap();
    let source = NativeSourceReservation::reserve(
        &path,
        binding,
        Instant::now() + std::time::Duration::from_secs(60),
    )
    .unwrap();
    source.begin_preparation().unwrap();
    std::process::exit(0);
}

#[test]
fn process_loss_does_not_reconstruct_or_free_preparing_owner() {
    let f = Fixture::new();
    let s = f.snapshot("intended");
    let b = f.bind(&s);
    std::fs::write(f.root.join("binding.json"), serde_json::to_vec(&b).unwrap()).unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "store::native_source_reservation::tests::reserved_child_exit_retains_original_slots",
            "--nocapture",
        ])
        .env("NAC_NATIVE_SOURCE_TEST_CHILD", &f.root)
        .status()
        .unwrap();
    assert!(status.success());
    let observed = commands::observe_reservation(&f.path, b.operation_id)
        .unwrap()
        .unwrap();
    assert_eq!(observed.status, commands::ReservationStatus::Preparing);
    assert_eq!(observed.binding.operation_id, b.operation_id);
    assert_eq!(observed.binding.session_id, b.session_id);
    assert!(commands::observe_reservation(&f.path, Uuid::new_v4())
        .unwrap()
        .is_none());
    assert!(crate::sessions::create_session(&f.path, &s).is_err());
    assert!(NativeSourceReservation::reserve(
        &f.path,
        b,
        Instant::now() + std::time::Duration::from_secs(60)
    )
    .is_err());
    assert_eq!(
        f.raw()
            .query_row("SELECT state FROM native_source_reservations", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "preparing"
    );
}
