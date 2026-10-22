//! Mechanical controls with private synthetic admission, real source reservation,
//! real checked SQLite commit and actual publish method. No protected effects,
//! genuine admission, Native cache acceptance or terminal proof is qualified.
use super::*;
use crate::runtime::{
    create_owner_test_helpers::{finish, Fixture},
    CreateFactoryOwner, PreparedSessionResources,
};

async fn publication() -> (
    Fixture,
    Arc<CreateFactoryOwner>,
    AdmittedSessionPublication,
    PathBuf,
) {
    let (fixture, custody) = tokio::task::spawn_blocking(|| {
        let fixture = Fixture::unbound_snapshot();
        let custody = finish(&fixture);
        (fixture, custody)
    })
    .await
    .unwrap();
    let owner = fixture.observer().upgrade().unwrap();
    let source = custody.source().unwrap();
    let (parts, fixture_store) = crate::session_service::tests::test_active_service(
        "published-create-veto",
        &source.binding().session_id,
    );
    let mut service = parts.service;
    let metadata = Arc::make_mut(&mut service.metadata);
    metadata.store_path = source.bound_store_path().to_path_buf();
    metadata.cwd = source
        .bound_store_path()
        .parent()
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    metadata.project_id = source.binding().project_id.clone();
    service.workspace_git = None;
    let snapshot = {
        let mut snapshot = service.session_snapshot.lock().await;
        let snapshot = snapshot.as_mut().unwrap();
        snapshot.cwd = source.bound_store_path().parent().unwrap().to_path_buf();
        snapshot.clone()
    };
    let reservation = Arc::clone(&source);
    tokio::task::spawn_blocking(move || reservation.bind_prepared_snapshot(&snapshot))
        .await
        .unwrap()
        .unwrap();
    // Private fixture composition only: ordinary production builders cannot
    // install this field, and no production factory constructor is introduced.
    service.protected_create_context = Some(Arc::clone(custody.context()));
    let mut stage = PreparedCreatePublication::retain(
        service,
        PreparedSessionResources::for_test(None),
        custody,
    );
    let publication = stage.try_issue().await.unwrap();
    (fixture, owner, publication, fixture_store)
}
#[tokio::test]
async fn published_veto_requires_real_commit_and_publish_and_the_same_original_factory() {
    let (_fixture, owner, mut publication, fixture_store) = publication().await;
    assert!(publication.check_published_create_for(&owner).is_err());
    publication.persist_creation().await.unwrap();
    assert!(sessions::load_session(publication.store_path(), publication.session_id()).is_ok());
    assert!(publication.check_published_create_for(&owner).is_err());
    let mut observed = None;
    publication
        .publish(|service| {
            observed = Some(service);
            Ok(())
        })
        .unwrap();
    assert!(observed.is_some());
    publication.check_published_create_for(&owner).unwrap();
    let other = tokio::task::spawn_blocking(Fixture::new).await.unwrap();
    assert!(publication
        .check_published_create_for(&other.observer().upgrade().unwrap())
        .is_err());
    publication.check_published_create_for(&owner).unwrap();
    drop((publication, observed));
    let _ = std::fs::remove_dir_all(fixture_store.parent().unwrap());
}
#[tokio::test]
async fn failed_publish_cannot_pass_veto_after_the_checked_store_commit() {
    let (_fixture, owner, mut publication, fixture_store) = publication().await;
    publication.persist_creation().await.unwrap();
    assert!(publication
        .publish(|_| anyhow::bail!("actual callback refused"))
        .is_err());
    assert!(publication.check_published_create_for(&owner).is_err());
    assert!(publication.check_recorded_create_for(&owner).is_err());
    assert!(sessions::load_session(publication.store_path(), publication.session_id()).is_ok());
    drop(publication);
    let _ = std::fs::remove_dir_all(fixture_store.parent().unwrap());
}
#[tokio::test]
async fn panicked_publish_cannot_pass_veto_after_the_attempt_was_consumed() {
    let (_fixture, owner, mut publication, fixture_store) = publication().await;
    publication.persist_creation().await.unwrap();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = publication.publish(|_| panic!("private publication callback panic"));
    }));
    assert!(outcome.is_err());
    assert!(publication.check_recorded_create_for(&owner).is_err());
    assert!(
        publication.check_published_create_for(&owner).is_err(),
        "consumed attempt is not successful publication"
    );
    assert!(sessions::load_session(publication.store_path(), publication.session_id()).is_ok());
    drop(publication);
    let _ = std::fs::remove_dir_all(fixture_store.parent().unwrap());
}

#[tokio::test]
async fn synthetic_constructor_cannot_pass_veto_even_after_actual_commit_and_publish() {
    struct SyntheticOwner(Instant);
    impl VerifiedPublicationResources for SyntheticOwner {
        fn check_current(&self) -> Result<()> {
            Ok(())
        }
        fn original_deadline(&self) -> Instant {
            self.0
        }
        fn retire(&self) {}
    }
    let (parts, path) = crate::session_service::tests::test_active_service(
        "synthetic-publication-veto",
        "baseline",
    );
    let mut service = parts.service;
    Arc::make_mut(&mut service.metadata).session_id = Some("fresh".into());
    service
        .session_snapshot
        .lock()
        .await
        .as_mut()
        .unwrap()
        .session_id = "fresh".into();
    let mut publication = AdmittedSessionPublication::from_verified_runtime(
        service,
        Some(PreparedSessionResources::for_test(None)),
        SessionPublicationKind::Create,
        Box::new(SyntheticOwner(Instant::now() + Duration::from_secs(30))),
        PublicationSource::Synthetic,
    )
    .unwrap();
    publication.persist_creation().await.unwrap();
    publication.publish(|_| Ok(())).unwrap();
    let fixture = tokio::task::spawn_blocking(Fixture::new).await.unwrap();
    assert!(publication
        .check_published_create_for(&fixture.observer().upgrade().unwrap())
        .is_err());
    assert!(publication
        .check_recorded_create_for(&fixture.observer().upgrade().unwrap())
        .is_err());
    assert!(publication
        .take_recorded_create_for(&fixture.observer().upgrade().unwrap())
        .is_err());
    assert!(sessions::load_session(&path, "fresh").is_ok());
    drop(publication);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn recorded_history_survives_retirement_without_reviving_create_or_releasing_sources() {
    let (_fixture, owner, mut publication, fixture_store) = publication().await;
    assert!(publication.check_recorded_create_for(&owner).is_err());
    publication.persist_creation().await.unwrap();
    assert!(publication.check_recorded_create_for(&owner).is_err());
    publication.publish(|_| Ok(())).unwrap();
    publication.check_published_create_for(&owner).unwrap();
    publication.retirement().retire();
    assert!(publication.check_published_create_for(&owner).is_err());
    publication.check_recorded_create_for(&owner).unwrap();
    let other = tokio::task::spawn_blocking(Fixture::new).await.unwrap();
    assert!(publication
        .check_recorded_create_for(&other.observer().upgrade().unwrap())
        .is_err());
    let path = publication.store_path().to_path_buf();
    let operation = owner.binding().operation_id.to_string();
    let slots: i64 = tokio::task::spawn_blocking(move || {
        let connection = rusqlite::Connection::open(path).unwrap();
        connection
            .query_row(
                "SELECT COUNT(*) FROM native_source_slots WHERE operation_id=?1",
                [operation],
                |row| row.get(0),
            )
            .unwrap()
    })
    .await
    .unwrap();
    assert!(slots > 0, "recorded history never retires any held source");
    drop(publication);
    let _ = std::fs::remove_dir_all(fixture_store.parent().unwrap());
}

#[tokio::test]
async fn recorded_core_half_is_one_use_and_retains_same_service_after_create_retirement() {
    let (_fixture, factory, mut publication, fixture_store) = publication().await;
    assert!(publication.take_recorded_create_for(&factory).is_err());
    publication.persist_creation().await.unwrap();
    assert!(publication.take_recorded_create_for(&factory).is_err());
    let mut cached = None;
    publication
        .publish(|service| {
            cached = Some(service);
            Ok(())
        })
        .unwrap();
    let recorded = publication.take_recorded_create_for(&factory).unwrap();
    assert!(publication.take_recorded_create_for(&factory).is_err());
    recorded.check_original_history().unwrap();
    assert!(recorded.is_service(cached.as_ref().unwrap()));
    assert_eq!(
        recorded.binding().operation_id,
        factory.binding().operation_id
    );
    assert_eq!(
        recorded.binding().claim_sequence,
        factory.binding().claim_sequence
    );
    assert_eq!(
        recorded.binding().intent_sha256,
        factory.binding().intent_sha256
    );
    assert_eq!(
        Some(recorded.config_version()),
        publication.config_version()
    );
    publication.retirement().retire();
    assert!(publication.check_published_create_for(&factory).is_err());
    drop(publication);
    recorded.check_original_history().unwrap();
    let path = cached.as_ref().unwrap().metadata().store_path.clone();
    let operation = recorded.binding().operation_id.to_string();
    let slots: i64 = tokio::task::spawn_blocking(move || {
        rusqlite::Connection::open(path)
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM native_source_slots WHERE operation_id=?1",
                [operation],
                |row| row.get(0),
            )
            .unwrap()
    })
    .await
    .unwrap();
    assert!(
        slots > 0,
        "Core half retains history; it cannot release sources"
    );
    drop((recorded, cached));
    let _ = std::fs::remove_dir_all(fixture_store.parent().unwrap());
}

#[tokio::test]
async fn original_recorded_terminal_cleanup_keeps_same_service_and_runtime_owner() {
    // Private synthetic admission, same real checked publication/store owner.
    // This proves local cleanup mechanics, never genuine participant admission.
    let (_fixture, factory, mut publication, fixture_store) = publication().await;
    publication.persist_creation().await.unwrap();
    let mut cached = None;
    publication
        .publish(|service| {
            cached = Some(service);
            Ok(())
        })
        .unwrap();
    let recorded = publication.take_recorded_create_for(&factory).unwrap();
    assert!(recorded.is_service(cached.as_ref().unwrap()));
    let recorded = match recorded.retain_terminal([0; 32]) {
        Err(original) => original,
        Ok(_) => panic!("zero digest accepted"),
    };
    let mut terminal = match recorded.retain_terminal([0x72; 32]) {
        Ok(terminal) => terminal,
        Err(_) => panic!("original terminal refused"),
    };
    publication.retirement().retire();
    assert!(publication.check_current().is_err());
    let service_before = Arc::clone(cached.as_ref().unwrap());
    terminal.cleanup_after_authenticated_ack().await.unwrap();
    terminal.cleanup_after_authenticated_ack().await.unwrap();
    assert!(Arc::ptr_eq(&service_before, cached.as_ref().unwrap()));
    // Original runtime lifetime remains separate from one-use publication.
    factory.binding();
    let path = publication.store_path().to_owned();
    let operation = factory.binding().operation_id.to_string();
    let counts = tokio::task::spawn_blocking(move || {
        let c = rusqlite::Connection::open(path).unwrap();
        let slots: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM native_source_slots WHERE operation_id=?1",
                [&operation],
                |r| r.get(0),
            )
            .unwrap();
        let ack: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM native_create_acknowledgements WHERE operation_id=?1",
                [&operation],
                |r| r.get(0),
            )
            .unwrap();
        (slots, ack)
    })
    .await
    .unwrap();
    assert_eq!(counts, (0, 1));
    assert!(Arc::strong_count(&service_before) > 1);
    drop((terminal, publication, cached, service_before));
    let _ = std::fs::remove_dir_all(fixture_store.parent().unwrap());
}
