use super::*;
use nac_core::projects::{self, NewProject};
use std::{
    os::unix::fs::{symlink, MetadataExt},
    path::Path,
    sync::MutexGuard,
};

pub(crate) struct Fixture {
    pub(crate) manager: SessionManager,
    pub(crate) root: PathBuf,
    pub(crate) config: nac_managed::ManagedHostConfig,
    _model_environment: crate::tests::ScopedModelEnv,
    _environment: MutexGuard<'static, ()>,
}

impl Fixture {
    pub(crate) fn new() -> Self {
        let environment = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root =
            std::env::temp_dir().join(format!("nac_location_facts_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let model_environment =
            crate::tests::ScopedModelEnv::isolated(&root.join("nac-home"), None);
        let config = nac_managed::ManagedHostConfig {
            version: nac_managed::LEGACY_MANAGED_CONFIG_VERSION,
            logical_host_id: "native-host".into(),
            host_incarnation_id: Some("incarnation-one".into()),
            owner: Some("native-owner".into()),
            public_hostname: "native.example.test".into(),
            repository_root: root.join("repositories"),
            state_root: root.join("state"),
            home_root: root.join("home"),
            github_client_id: "test-client".into(),
            model_backend: "arcee-api".into(),
            model_id: "model".into(),
            model_endpoint: "https://api.arcee.ai/api/v1".into(),
            model_auth_issuer: None,
            model_credential_file: root.join("credential"),
            model_credential_source: nac_managed::ManagedModelCredentialSource::MountedApiKey,
            model_credential_environment_names: vec![],
            managed_control_bind: None,
            managed_control_issuer: None,
            managed_control_jwks_file: None,
            managed_upgrade_expectation: None,
        };
        for directory in [
            &config.repository_root,
            &config.state_root,
            &config.home_root,
        ] {
            std::fs::create_dir_all(directory).unwrap();
        }
        let manager = Self::manager(&root, config.clone());
        Self {
            manager,
            root,
            config,
            _model_environment: model_environment,
            _environment: environment,
        }
    }
    fn manager(root: &Path, config: nac_managed::ManagedHostConfig) -> SessionManager {
        SessionManager::new_unowned_fixture(crate::ServerOptions {
            root_cwd: root.into(),
            store_path: Some(root.join("store.db")),
            worker_executable: None,
            managed_host: Some(config),
        })
        .unwrap()
    }
    pub(crate) fn register(&self, name: &str, cwd: PathBuf, ssh_host: Option<String>) {
        projects::insert_project(
            &self.root.join("store.db"),
            NewProject {
                project_id: name.into(),
                name: Some(name.into()),
                description: None,
                cwd,
                ssh_host,
                ssh_port: None,
                ssh_identity_file: None,
                default_model_config_id: None,
            },
        )
        .unwrap();
    }
    fn selector(name: &str) -> ManagedLocationSelector {
        ManagedLocationSelector::RegisteredProject {
            project_id: name.into(),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[tokio::test]
async fn configured_root_fact_uses_actual_config_build_and_opened_directory() {
    let fixture = Fixture::new();
    let fact = fixture
        .manager
        .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
        .await
        .unwrap();
    assert_eq!(fact.canonical_cwd, fixture.config.repository_root);
    assert_ne!(fact.canonical_cwd, fixture.manager.inner.root_cwd);
    assert_eq!(fact.binding.logical_host_id, "native-host");
    assert_eq!(fact.binding.host_incarnation_id, "incarnation-one");
    assert_eq!(fact.binding.configured_owner, "native-owner");
    assert_eq!(
        fact.binding.build_id,
        crate::build_identity::current().build_id
    );
    assert_eq!(
        fact.binding.release_id,
        crate::managed_running_target().unwrap().release_id
    );
    assert_eq!(
        fact.binding.source_revision,
        crate::build_identity::current().source_revision
    );
    let metadata = std::fs::metadata(&fixture.config.repository_root).unwrap();
    assert_eq!(fact.directory_identity.device, metadata.dev());
    assert_eq!(fact.directory_identity.inode, metadata.ino());
    assert_eq!(fact.directory_identity, fact.repository_identity);
    assert!(fact.project.is_none());
    let resolution = fixture
        .manager
        .resolve_managed_location_fact(fact.clone())
        .await
        .unwrap();
    assert_eq!(resolution.fact(), &fact);
    assert_eq!(
        resolution.directory_handle().metadata().unwrap().ino(),
        metadata.ino()
    );
    assert!(projects::list_projects(&fixture.root.join("store.db"))
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn registered_project_fact_uses_current_native_row_and_never_a_path_selector() {
    let fixture = Fixture::new();
    let cwd = fixture.config.repository_root.join("checkout/subdirectory");
    std::fs::create_dir_all(&cwd).unwrap();
    fixture.register("project", cwd.clone(), None);
    let fact = fixture
        .manager
        .managed_location_fact(Fixture::selector("project"))
        .await
        .unwrap();
    assert_eq!(fact.canonical_cwd, cwd);
    assert_eq!(fact.project.as_ref().unwrap().project_id, "project");
    fixture
        .manager
        .resolve_managed_location_fact(fact)
        .await
        .unwrap();
    assert_eq!(
        fixture
            .manager
            .managed_location_fact(Fixture::selector("/private/path"))
            .await
            .unwrap_err(),
        ManagedLocationFactError::ProjectUnavailable
    );
    for id in [String::new(), "x".repeat(257)] {
        assert_eq!(
            fixture
                .manager
                .managed_location_fact(Fixture::selector(&id))
                .await
                .unwrap_err(),
            ManagedLocationFactError::InvalidSelector
        );
    }
}

#[tokio::test]
async fn outside_prefix_sibling_and_remote_projects_are_refused() {
    let fixture = Fixture::new();
    let outside = fixture.root.join("repositories-other");
    std::fs::create_dir_all(&outside).unwrap();
    fixture.register("outside", outside, None);
    fixture.register(
        "remote",
        PathBuf::from("/repositories/remote"),
        Some("ssh-host".into()),
    );
    assert_eq!(
        fixture
            .manager
            .managed_location_fact(Fixture::selector("outside"))
            .await
            .unwrap_err(),
        ManagedLocationFactError::OutsideRepository
    );
    assert_eq!(
        fixture
            .manager
            .managed_location_fact(Fixture::selector("remote"))
            .await
            .unwrap_err(),
        ManagedLocationFactError::RemoteProject
    );
}

#[tokio::test]
async fn final_and_ancestor_symlinks_cannot_supply_a_contained_directory_fact() {
    let fixture = Fixture::new();
    let checkout = fixture.config.repository_root.join("checkout");
    std::fs::create_dir_all(checkout.join("nested")).unwrap();
    fixture.register("project", checkout.join("nested"), None);
    std::fs::rename(&checkout, fixture.root.join("moved-checkout")).unwrap();
    symlink(fixture.root.join("moved-checkout"), &checkout).unwrap();
    assert_eq!(
        fixture
            .manager
            .managed_location_fact(Fixture::selector("project"))
            .await
            .unwrap_err(),
        ManagedLocationFactError::DirectoryUnavailable
    );
    std::fs::remove_file(&checkout).unwrap();
    std::fs::rename(fixture.root.join("moved-checkout"), &checkout).unwrap();
    let nested = checkout.join("nested");
    std::fs::rename(&nested, checkout.join("real")).unwrap();
    symlink(checkout.join("real"), nested).unwrap();
    assert_eq!(
        fixture
            .manager
            .managed_location_fact(Fixture::selector("project"))
            .await
            .unwrap_err(),
        ManagedLocationFactError::DirectoryUnavailable
    );
}

#[tokio::test]
async fn directory_or_mount_root_replacement_invalidates_prior_fact() {
    let fixture = Fixture::new();
    let cwd = fixture.config.repository_root.join("checkout");
    std::fs::create_dir(&cwd).unwrap();
    fixture.register("project", cwd.clone(), None);
    let fact = fixture
        .manager
        .managed_location_fact(Fixture::selector("project"))
        .await
        .unwrap();
    std::fs::rename(&cwd, fixture.config.repository_root.join("old-checkout")).unwrap();
    std::fs::create_dir(&cwd).unwrap();
    assert_eq!(
        fixture
            .manager
            .resolve_managed_location_fact(fact)
            .await
            .unwrap_err(),
        ManagedLocationFactError::Changed
    );
    let root_fact = fixture
        .manager
        .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
        .await
        .unwrap();
    std::fs::rename(
        &fixture.config.repository_root,
        fixture.root.join("old-repositories"),
    )
    .unwrap();
    std::fs::create_dir(&fixture.config.repository_root).unwrap();
    assert_eq!(
        fixture
            .manager
            .resolve_managed_location_fact(root_fact)
            .await
            .unwrap_err(),
        ManagedLocationFactError::Changed
    );
}

#[tokio::test]
async fn repinned_or_deleted_project_invalidates_prior_fact() {
    let fixture = Fixture::new();
    let cwd = fixture.config.repository_root.join("checkout");
    std::fs::create_dir(&cwd).unwrap();
    fixture.register("project", cwd, None);
    let fact = fixture
        .manager
        .managed_location_fact(Fixture::selector("project"))
        .await
        .unwrap();
    projects::update_project(
        &fixture.root.join("store.db"),
        "project",
        projects::ProjectPatch {
            pinned: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        fixture
            .manager
            .resolve_managed_location_fact(fact)
            .await
            .unwrap_err(),
        ManagedLocationFactError::Changed
    );
    let fact = fixture
        .manager
        .managed_location_fact(Fixture::selector("project"))
        .await
        .unwrap();
    projects::delete_project(&fixture.root.join("store.db"), "project").unwrap();
    assert_eq!(
        fixture
            .manager
            .resolve_managed_location_fact(fact)
            .await
            .unwrap_err(),
        ManagedLocationFactError::ProjectUnavailable
    );
}

#[tokio::test]
async fn unbound_host_and_other_incarnation_owner_or_release_cannot_match_a_fact() {
    let fixture = Fixture::new();
    let fact = fixture
        .manager
        .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
        .await
        .unwrap();
    let mut config = fixture.config.clone();
    config.host_incarnation_id = Some("incarnation-two".into());
    let next = Fixture::manager(&fixture.root, config);
    assert_eq!(
        next.resolve_managed_location_fact(fact.clone())
            .await
            .unwrap_err(),
        ManagedLocationFactError::Changed
    );
    let mut config = fixture.config.clone();
    config.owner = Some("different-owner".into());
    let next = Fixture::manager(&fixture.root, config);
    assert_eq!(
        next.resolve_managed_location_fact(fact.clone())
            .await
            .unwrap_err(),
        ManagedLocationFactError::Changed
    );
    let mut wrong_release = fact;
    wrong_release.binding.release_id = "different-release".into();
    assert_eq!(
        fixture
            .manager
            .resolve_managed_location_fact(wrong_release)
            .await
            .unwrap_err(),
        ManagedLocationFactError::Changed
    );
    let mut config = fixture.config.clone();
    config.host_incarnation_id = None;
    let legacy = Fixture::manager(&fixture.root, config);
    assert_eq!(
        legacy
            .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
            .await
            .unwrap_err(),
        ManagedLocationFactError::UnboundHost
    );
}

#[tokio::test]
async fn configured_root_symlink_is_refused_even_when_it_points_at_a_real_directory() {
    let fixture = Fixture::new();
    std::fs::rename(
        &fixture.config.repository_root,
        fixture.root.join("actual-repositories"),
    )
    .unwrap();
    symlink(
        fixture.root.join("actual-repositories"),
        &fixture.config.repository_root,
    )
    .unwrap();
    assert_eq!(
        fixture
            .manager
            .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
            .await
            .unwrap_err(),
        ManagedLocationFactError::DirectoryUnavailable
    );
}

#[test]
fn descriptor_walk_rejects_parent_traversal_and_follows_no_symlink() {
    let fixture = Fixture::new();
    let root = filesystem::open_absolute_directory(&fixture.config.repository_root).unwrap();
    assert!(filesystem::open_directory_beneath(&root, Path::new("..")).is_err());
    assert!(filesystem::open_directory_beneath(&root, &fixture.root).is_err());
    assert!(filesystem::open_absolute_directory(Path::new("relative")).is_err());
    let nested = fixture.config.repository_root.join("nested");
    std::fs::create_dir(&nested).unwrap();
    symlink(&nested, fixture.config.repository_root.join("alias")).unwrap();
    assert!(filesystem::open_directory_beneath(&root, Path::new("alias")).is_err());
    assert!(filesystem::open_directory_beneath(&root, Path::new("nested/../nested")).is_err());
}

#[tokio::test]
async fn unmanaged_host_and_missing_or_nondirectory_project_cwds_are_refused() {
    let fixture = Fixture::new();
    let unmanaged = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: fixture.root.clone(),
        store_path: Some(fixture.root.join("unmanaged.db")),
        worker_executable: None,
        managed_host: None,
    })
    .unwrap();
    assert_eq!(
        unmanaged
            .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
            .await
            .unwrap_err(),
        ManagedLocationFactError::Unmanaged
    );
    let file = fixture.config.repository_root.join("file");
    std::fs::write(&file, "not a directory").unwrap();
    fixture.register("file", file, None);
    fixture.register(
        "missing",
        fixture.config.repository_root.join("missing"),
        None,
    );
    fixture.register(
        "traversal",
        fixture.config.repository_root.join("../home"),
        None,
    );
    for id in ["file", "missing", "traversal"] {
        assert_eq!(
            fixture
                .manager
                .managed_location_fact(Fixture::selector(id))
                .await
                .unwrap_err(),
            ManagedLocationFactError::DirectoryUnavailable
        );
    }
}
