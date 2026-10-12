use super::*;
use nac_core::store::{
    self, ManagedAcceptedIdentity, ManagedMaintenanceState, ManagedOperationBinding,
};

struct StartupFixture {
    root: PathBuf,
    path: PathBuf,
    config: ManagedHostConfig,
    prior: ManagedOperationBinding,
    running: store::ManagedUpgradeTarget,
}

impl StartupFixture {
    fn new(version: u32, maintenance: bool) -> Self {
        let root = std::env::temp_dir().join(format!("nac-startup-cas-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("store.db");
        store::initialize(&path).unwrap();
        let mut config = static_config();
        config.version = version;
        config.state_root = root.join("state");
        config.repository_root = root.join("repositories");
        config.home_root = root.join("home");
        if version == nac_managed::MANAGED_CONFIG_VERSION {
            config.managed_host_key = None;
            config.model_credential_source = ManagedModelCredentialSource::MountedApiKey;
            config.model_credential_file = root.join("model-token");
        }
        let control = config.managed_control().unwrap().unwrap();
        let running = crate::managed_running_target().unwrap();
        let prior = ManagedOperationBinding {
            managed_host_id: config.logical_host_id.clone(),
            host_incarnation_id: control.host_incarnation_id.clone(),
            issuer: control.issuer.clone(),
            audience: format!(
                "urn:nac:managed-control:{}:{}",
                config.logical_host_id, control.host_incarnation_id
            ),
            authority_origin: control.issuer,
            operation_id: "operation-startup-a".into(),
            target: store::ManagedUpgradeTarget {
                release_id: "release-startup-a".into(),
                source_sha: "a".repeat(40),
                product_version: "0.0.1".into(),
                schema_version: running.schema_version,
                minimum_schema_version: running.minimum_schema_version,
            },
            actor: "user:owner".into(),
            beneficiary: "tenant:owner".into(),
        };
        store::prepare_managed_upgrade(
            &path,
            "jti-startup-a",
            &prior,
            store::ManagedControlAttemptAction::Prepare,
            i64::MAX,
            Vec::new(),
        )
        .unwrap();
        if !maintenance {
            assert!(store::accept_managed_forward_start(&path, &Self::identity(&prior)).unwrap());
        }
        config.managed_upgrade_expectation = Some(nac_managed::ManagedUpgradeExpectation {
            adopt_unbound_previous: false,
            previous_operation_id: prior.operation_id.clone(),
            previous_target: Self::target(&prior.target),
            operation_id: "operation-startup-b".into(),
            target: Self::target(&running),
            actor: prior.actor.clone(),
            beneficiary: prior.beneficiary.clone(),
        });
        config.validate().unwrap();
        Self {
            root,
            path,
            config,
            prior,
            running,
        }
    }

    fn identity(binding: &ManagedOperationBinding) -> ManagedAcceptedIdentity {
        ManagedAcceptedIdentity {
            managed_host_id: binding.managed_host_id.clone(),
            host_incarnation_id: binding.host_incarnation_id.clone(),
            operation_id: binding.operation_id.clone(),
            target: binding.target.clone(),
        }
    }

    fn target(target: &store::ManagedUpgradeTarget) -> nac_managed::ManagedControlTarget {
        nac_managed::ManagedControlTarget {
            release_id: target.release_id.clone(),
            source_sha: target.source_sha.clone(),
            product_version: target.product_version.clone(),
            schema_version: target.schema_version,
            minimum_schema_version: target.minimum_schema_version,
        }
    }

    fn retained_state(&self) -> serde_json::Value {
        serde_json::to_value(store::managed_maintenance_snapshot(&self.path).unwrap()).unwrap()
    }
}

impl Drop for StartupFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn v2_and_v3_startup_cas_replays_and_requires_exact_accept_before_serving() {
    for version in [
        nac_managed::MANAGED_CONFIG_VERSION,
        nac_managed::HOST_KEY_MANAGED_CONFIG_VERSION,
    ] {
        for maintenance in [false, true] {
            let fixture = StartupFixture::new(version, maintenance);
            let conn = rusqlite::Connection::open(&fixture.path).unwrap();
            conn.execute_batch("CREATE TABLE startup_retention_sentinel (id TEXT, history TEXT, billing INTEGER, metadata TEXT); INSERT INTO startup_retention_sentinel VALUES ('21856443-8ed8-40ab-9036-72e837c99f27', 'retained history', 42, 'retained metadata');").unwrap();
            let plan = managed_startup_plan(&fixture.path, Some(&fixture.config), &fixture.running)
                .unwrap();
            assert!(!plan.recovery_only);
            assert!(plan.preflight.requires_accept);
            let identity = plan.preflight.accepted_identity.unwrap();
            assert_eq!(identity.managed_host_id, fixture.config.logical_host_id);
            assert_eq!(
                Some(&identity.host_incarnation_id),
                fixture.config.host_incarnation_id.as_ref()
            );
            assert_eq!(identity.operation_id, "operation-startup-b");
            assert_eq!(identity.target, fixture.running);
            assert_eq!(
                plan.configured_identity,
                Some((
                    identity.managed_host_id.clone(),
                    identity.host_incarnation_id.clone()
                ))
            );
            let pending = fixture.retained_state();
            assert_eq!(pending["state"], "maintenance");
            let replay =
                managed_startup_plan(&fixture.path, Some(&fixture.config), &fixture.running)
                    .unwrap();
            assert!(replay.preflight.requires_accept);
            assert_eq!(replay.preflight.accepted_identity.as_ref(), Some(&identity));
            assert_eq!(fixture.retained_state(), pending);
            let mut wrong = identity.clone();
            wrong.operation_id = fixture.prior.operation_id.clone();
            assert!(!store::accept_managed_forward_start(&fixture.path, &wrong).unwrap());
            assert_eq!(fixture.retained_state(), pending);
            assert!(store::accept_managed_forward_start(&fixture.path, &identity).unwrap());
            let accepted =
                managed_startup_plan(&fixture.path, Some(&fixture.config), &fixture.running)
                    .unwrap();
            assert!(!accepted.preflight.requires_accept);
            assert_eq!(
                accepted.preflight.accepted_identity.as_ref(),
                Some(&identity)
            );
            assert_eq!(
                store::managed_maintenance_snapshot(&fixture.path)
                    .unwrap()
                    .state,
                ManagedMaintenanceState::Serving
            );
            assert!(store::try_admit_managed_work_for_identity(
                &fixture.path,
                &StartupFixture::identity(&fixture.prior)
            )
            .is_err());
            assert_eq!(
                conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                    .unwrap(),
                32
            );
            assert_eq!(
                conn.pragma_query_value::<String, _>(None, "journal_mode", |row| row.get(0))
                    .unwrap(),
                "wal"
            );
            let retained = conn
                .query_row(
                    "SELECT id, history, billing, metadata FROM startup_retention_sentinel",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .unwrap();
            assert_eq!(
                retained,
                (
                    "21856443-8ed8-40ab-9036-72e837c99f27".into(),
                    "retained history".into(),
                    42,
                    "retained metadata".into()
                )
            );
        }
    }
}

#[test]
fn v2_and_v3_startup_cas_denies_mismatch_before_model_import_and_retains_history() {
    let changes: [fn(&mut ManagedHostConfig); 8] = [
        |c| c.logical_host_id = "9a75182f-e3e5-42e0-a6fd-a6ba0abf6148".into(),
        |c| c.host_incarnation_id = Some("wrong-incarnation".into()),
        |c| {
            c.managed_upgrade_expectation
                .as_mut()
                .unwrap()
                .target
                .source_sha = "f".repeat(40)
        },
        |c| {
            c.managed_upgrade_expectation
                .as_mut()
                .unwrap()
                .previous_target
                .release_id = "stale-release".into()
        },
        |c| {
            c.managed_upgrade_expectation
                .as_mut()
                .unwrap()
                .previous_operation_id = "stale-operation".into()
        },
        |c| {
            c.managed_upgrade_expectation.as_mut().unwrap().operation_id =
                "operation-startup-a".into()
        },
        |c| c.managed_upgrade_expectation.as_mut().unwrap().actor = "user:other".into(),
        |c| c.host_incarnation_id = Some(String::new()),
    ];
    for version in [
        nac_managed::MANAGED_CONFIG_VERSION,
        nac_managed::HOST_KEY_MANAGED_CONFIG_VERSION,
    ] {
        for maintenance in [false, true] {
            let fixture = StartupFixture::new(version, maintenance);
            let before = fixture.retained_state();
            let environment_lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
            let environment = crate::tests::ScopedModelEnv::isolated(&fixture.root, None);
            for change in changes {
                let mut config = fixture.config.clone();
                change(&mut config);
                // Keep the static binding internally consistent to exercise the durable CAS.
                if let Some(key) = config.managed_host_key.as_mut() {
                    key.managed_host_id = config.logical_host_id.clone();
                    key.host_incarnation_id = config.host_incarnation_id.clone().unwrap();
                }
                assert!(
                    managed_startup_plan(&fixture.path, Some(&config), &fixture.running).is_err()
                );
                assert!(
                    crate::SessionManager::new_unowned_fixture(crate::ServerOptions {
                        root_cwd: fixture.root.clone(),
                        store_path: Some(fixture.path.clone()),
                        worker_executable: None,
                        managed_host: Some(config),
                    })
                    .is_err()
                );
                assert_eq!(fixture.retained_state(), before);
                assert!(!fixture.config.state_root.join("auth").exists());
            }
            drop(environment);
            drop(environment_lock);
            let mut no_expectation = fixture.config.clone();
            no_expectation.managed_upgrade_expectation = None;
            assert!(
                managed_startup_plan(&fixture.path, Some(&no_expectation), &fixture.running)
                    .is_err()
            );
            assert_eq!(fixture.retained_state(), before);
        }
    }
}

#[test]
fn startup_cas_keeps_legacy_and_standalone_paths_and_future_store_recovery_only() {
    let fixture = StartupFixture::new(nac_managed::HOST_KEY_MANAGED_CONFIG_VERSION, true);
    let legacy = config(ManagedModelCredentialSource::ManagedBootstrap, "arcee-auth");
    legacy.validate().unwrap();
    for config in [None, Some(&legacy)] {
        let plan = managed_startup_plan(&fixture.path, config, &fixture.running).unwrap();
        assert!(!plan.recovery_only);
        assert!(!plan.preflight.requires_accept);
        assert!(plan.preflight.accepted_identity.is_none());
        assert!(plan.configured_identity.is_none());
    }
    let before = fixture.retained_state();
    let conn = rusqlite::Connection::open(&fixture.path).unwrap();
    conn.pragma_update(None, "user_version", fixture.running.schema_version + 1)
        .unwrap();
    for version in [
        nac_managed::MANAGED_CONFIG_VERSION,
        nac_managed::HOST_KEY_MANAGED_CONFIG_VERSION,
    ] {
        let mut config = fixture.config.clone();
        config.version = version;
        if version == nac_managed::MANAGED_CONFIG_VERSION {
            config.managed_host_key = None;
            config.model_credential_source = ManagedModelCredentialSource::MountedApiKey;
            config.model_credential_file = fixture.root.join("model-token");
        }
        config.validate().unwrap();
        config.managed_upgrade_expectation = None;
        let plan = managed_startup_plan(&fixture.path, Some(&config), &fixture.running).unwrap();
        assert!(plan.recovery_only);
        assert!(!plan.preflight.requires_accept);
        assert!(plan.preflight.accepted_identity.is_none());
        config.managed_upgrade_expectation = fixture.config.managed_upgrade_expectation.clone();
        assert!(managed_startup_plan(&fixture.path, Some(&config), &fixture.running).is_err());
    }
    conn.pragma_update(None, "user_version", fixture.running.schema_version)
        .unwrap();
    assert_eq!(fixture.retained_state(), before);
}
