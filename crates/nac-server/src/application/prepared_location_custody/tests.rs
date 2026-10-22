use super::*;
use crate::application::managed_locations::tests::Fixture;
use crate::ManagedLocationSelector;
use nac_core::{
    runtime::{self, ModelOptions, NacConfig, OptionalModelOption, RunOptions, StoreOptions},
    session_service::{
        admitted_publication_fixtures::{synthetic_publication, PublicationFixtureControl},
        AdmittedSessionPublication, SessionPublicationKind, SessionService,
    },
};
use std::os::unix::fs::MetadataExt;

mod transfer;

// Ordinary Local preparation supplies ONLY a synthetic receiving control. It
// never establishes production admission, retained factory custody or effects.
async fn synthetic_prepared(
    manager: &SessionManager,
    cwd: &std::path::Path,
    project: Option<&str>,
) -> (AdmittedSessionPublication, PublicationFixtureControl) {
    // Fixture::new already owns SERVER_MODEL_ENV_LOCK for this whole test.
    let _model_env = crate::tests::ScopedModelEnv::isolated(
        &cwd.join("synthetic-nac-home"),
        Some("test-only-key"),
    );
    let config = NacConfig::load_from_cwd(cwd).unwrap();
    let prepared = runtime::prepare_run_config_for_project_with_behavior(
        RunOptions {
            workspace_cwd: cwd.into(),
            config_cwd: Some(cwd.into()),
            store: StoreOptions {
                store_path: Some(manager.inner.store_path.clone()),
            },
            model: ModelOptions {
                backend: Some(nac_core::model::BackendKind::OpenAiResponses),
                api_model: Some("gpt-5.2".into()),
                api_key_env: OptionalModelOption::Value("OPENAI_API_KEY".into()),
                ..Default::default()
            },
            ..Default::default()
        },
        &config,
        project.map(str::to_owned),
        nac_core::sessions::SessionBehavior::Direct,
    )
    .await
    .unwrap();
    let (run_config, resources) = prepared.into_parts();
    synthetic_publication(
        SessionService::from_orchestrator_run_config(run_config).service,
        Some(resources),
        SessionPublicationKind::Create,
        std::time::Instant::now() + std::time::Duration::from_secs(30),
    )
    .unwrap()
}

async fn retain_root(manager: &SessionManager) -> PreparedLocationCustody {
    let fact = manager
        .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
        .await
        .unwrap();
    let location = manager.resolve_managed_location_fact(fact).await.unwrap();
    PreparedLocationCustody::retain(manager, location)
        .await
        .unwrap()
}

#[tokio::test]
async fn native_prepared_port_moves_original_descriptor_and_retains_host_lease_after_denial() {
    use std::os::fd::AsRawFd;
    let f = Fixture::new();
    let manager = manager(&f);
    let custody = retain_root(&manager).await;
    let descriptor = custody.location.directory_handle().as_raw_fd();
    let inode = custody
        .location
        .directory_handle()
        .metadata()
        .unwrap()
        .ino();
    let resources: Box<dyn nac_core::runtime::PreparationResourceCustody> = Box::new(custody);
    resources.check_outside_store().unwrap();
    resources.check_denial().unwrap();
    resources.deny();
    assert!(resources.check_denial().is_err());
    assert!(resources.check_outside_store().is_err());
    // fstat is a read of the original descriptor, without reopening/cloning it.
    let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
    assert_eq!(unsafe { libc::fstat(descriptor, metadata.as_mut_ptr()) }, 0);
    assert_eq!(unsafe { metadata.assume_init() }.st_ino, inode);
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
    drop(resources); // Test-owned known no-start: no production factory/effect.
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_ok()
    );
}

#[tokio::test]
async fn native_prepared_port_revalidates_original_names_and_never_revives_after_restore() {
    let f = Fixture::new();
    let manager = manager(&f);
    let custody = retain_root(&manager).await;
    let resources: Box<dyn nac_core::runtime::PreparationResourceCustody> = Box::new(custody);
    let moved = f.root.join("port-original-repository");
    std::fs::rename(&f.config.repository_root, &moved).unwrap();
    std::fs::create_dir(&f.config.repository_root).unwrap();
    assert!(resources.check_outside_store().is_err());
    std::fs::remove_dir(&f.config.repository_root).unwrap();
    std::fs::rename(&moved, &f.config.repository_root).unwrap();
    assert!(resources.check_denial().is_err());
    assert!(resources.check_outside_store().is_err());
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
}

#[tokio::test]
async fn native_prepared_pairing_checks_actual_scope_and_retirement() {
    let f = Fixture::new();
    let manager = manager(&f);
    let custody = retain_root(&manager).await;
    let (admitted, control) = synthetic_prepared(&manager, &f.config.repository_root, None).await;
    custody.verify_prepared(&manager, &admitted).await.unwrap();
    assert!(!control.is_retired());
    control.retire();
    assert!(custody.verify_prepared(&manager, &admitted).await.is_err());
    assert!(custody.check_denial().is_err());
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
}

#[tokio::test]
async fn native_prepared_pairing_refuses_project_substitution_even_at_the_same_directory() {
    let f = Fixture::new();
    let manager = manager(&f);
    f.register("selected", f.config.repository_root.clone(), None);
    let other_directory = f.config.repository_root.join("other-checkout");
    std::fs::create_dir(&other_directory).unwrap();
    f.register("other", other_directory, None);
    let fact = manager
        .managed_location_fact(ManagedLocationSelector::RegisteredProject {
            project_id: "selected".into(),
        })
        .await
        .unwrap();
    let location = manager.resolve_managed_location_fact(fact).await.unwrap();
    let custody = PreparedLocationCustody::retain(&manager, location)
        .await
        .unwrap();
    let (selected, _) =
        synthetic_prepared(&manager, &f.config.repository_root, Some("selected")).await;
    custody.verify_prepared(&manager, &selected).await.unwrap();
    let (other, control) =
        synthetic_prepared(&manager, &f.config.repository_root, Some("other")).await;
    assert!(custody.verify_prepared(&manager, &other).await.is_err());
    assert!(control.is_retired());
    assert!(
        custody.verify_prepared(&manager, &selected).await.is_err(),
        "matching data cannot revive denied original resources"
    );
}

#[tokio::test]
async fn native_prepared_pairing_refuses_wrong_directory_and_changed_original_names() {
    let f = Fixture::new();
    let manager = manager(&f);
    let custody = retain_root(&manager).await;
    let (wrong, control) = synthetic_prepared(&manager, &f.root, None).await;
    assert!(custody.verify_prepared(&manager, &wrong).await.is_err());
    assert!(control.is_retired());
    let custody = retain_root(&manager).await;
    let (admitted, control) = synthetic_prepared(&manager, &f.config.repository_root, None).await;
    let moved = f.root.join("original-repository");
    std::fs::rename(&f.config.repository_root, &moved).unwrap();
    std::fs::create_dir(&f.config.repository_root).unwrap();
    assert!(custody.verify_prepared(&manager, &admitted).await.is_err());
    assert!(control.is_retired());
    std::fs::remove_dir(&f.config.repository_root).unwrap();
    std::fs::rename(&moved, &f.config.repository_root).unwrap();
    assert!(custody.verify_prepared(&manager, &admitted).await.is_err());
}

#[tokio::test]
async fn native_prepared_pairing_refuses_another_prepared_store_with_identical_host_binding() {
    let f = Fixture::new();
    let manager = manager(&f);
    let other = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("another-prepared-store.db")),
        worker_executable: None,
        managed_host: manager.managed_host().cloned(),
    })
    .unwrap();
    nac_core::store::initialize(&other.inner.store_path).unwrap();
    let custody = retain_root(&manager).await;
    let (admitted, control) = synthetic_prepared(&other, &f.config.repository_root, None).await;
    assert!(custody.verify_prepared(&manager, &admitted).await.is_err());
    assert!(control.is_retired());
    assert!(custody.check_denial().is_err());
}

fn manager(f: &Fixture) -> SessionManager {
    let mut config = f.config.clone();
    config.version = nac_managed::MANAGED_CONFIG_VERSION;
    config.managed_control_bind = Some("127.0.0.1:3211".into());
    config.managed_control_issuer = Some("https://control.example.test".into());
    config.managed_control_jwks_file = Some(f.root.join("unused-controller-jwks.json"));
    let manager = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("store.db")),
        worker_executable: None,
        managed_host: Some(config),
    })
    .unwrap();
    nac_core::store::initialize(&manager.inner.store_path).unwrap();
    manager
}

#[tokio::test]
async fn native_prepared_location_retains_exact_directory_and_host_guard_even_after_denial() {
    let f = Fixture::new();
    let manager = manager(&f);
    let fact = manager
        .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
        .await
        .unwrap();
    let location = manager
        .resolve_managed_location_fact(fact.clone())
        .await
        .unwrap();
    let inode = location.directory_handle().metadata().unwrap().ino();
    let custody = PreparedLocationCustody::retain(&manager, location)
        .await
        .unwrap();
    assert_eq!(custody.fact(), &fact);
    assert_eq!(
        custody
            .location
            .directory_handle()
            .metadata()
            .unwrap()
            .ino(),
        inode
    );
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
    custody.deny();
    assert!(custody.check_denial().is_err());
    assert!(custody.check_outside_store(&manager).is_err());
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err(),
        "denial must retain real resources, not stand for terminal cleanup"
    );
    drop(custody); // Test-owned known no-start: no preparation was invoked.
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_ok()
    );
}

#[tokio::test]
async fn native_prepared_location_rejects_another_host_and_latches_directory_replacement() {
    let f = Fixture::new();
    let manager = manager(&f);
    let mut foreign_config = f.config.clone();
    foreign_config.host_incarnation_id = Some("different-incarnation".into());
    let foreign_manager = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("store.db")),
        worker_executable: None,
        managed_host: Some(foreign_config),
    })
    .unwrap();
    let foreign = foreign_manager
        .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
        .await
        .unwrap();
    let foreign = foreign_manager
        .resolve_managed_location_fact(foreign)
        .await
        .unwrap();
    assert!(
        PreparedLocationCustody::retain(&manager, foreign)
            .await
            .is_err(),
        "a legacy/different host binding cannot be paired with this original guard"
    );
    let fact = manager
        .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
        .await
        .unwrap();
    let location = manager.resolve_managed_location_fact(fact).await.unwrap();
    let custody = PreparedLocationCustody::retain(&manager, location)
        .await
        .unwrap();
    let moved = f.root.join("moved-repository");
    std::fs::rename(&f.config.repository_root, &moved).unwrap();
    std::fs::create_dir(&f.config.repository_root).unwrap();
    assert!(custody.check_outside_store(&manager).is_err());
    std::fs::remove_dir(&f.config.repository_root).unwrap();
    std::fs::rename(&moved, &f.config.repository_root).unwrap();
    assert!(custody.check_denial().is_err());
    assert!(custody.check_outside_store(&manager).is_err());
}

#[tokio::test]
async fn native_prepared_location_refuses_the_same_host_binding_on_a_different_store() {
    let f = Fixture::new();
    let manager = manager(&f);
    let fact = manager
        .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
        .await
        .unwrap();
    let location = manager.resolve_managed_location_fact(fact).await.unwrap();
    let custody = PreparedLocationCustody::retain(&manager, location)
        .await
        .unwrap();
    let other = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("other-store.db")),
        worker_executable: None,
        managed_host: manager.managed_host().cloned(),
    })
    .unwrap();
    assert_eq!(
        manager.managed_location_binding().unwrap(),
        other.managed_location_binding().unwrap()
    );
    assert!(custody.check_outside_store(&other).is_err());
    assert!(
        custody.check_outside_store(&manager).is_err(),
        "a scope mismatch cannot revive"
    );
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
}
