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
        Self::seed_retained_session(&path, &root);
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

    fn seed_retained_session(path: &Path, root: &Path) {
        let session_id = "21856443-8ed8-40ab-9036-72e837c99f27";
        let mut session = nac_core::sessions::new_snapshot(
            session_id.into(),
            root.to_path_buf(),
            "trinity-large-thinking".into(),
            "https://api.arcee.ai".into(),
            BackendKind::ArceeApi,
            None,
            None,
            None,
            vec![nac_core::types::Message::User {
                content: "retained history".into(),
            }],
            None,
            Default::default(),
        );
        session.unattributed_token_usage = Some(
            serde_json::from_value(serde_json::json!({
                "input_tokens": 42,
                "output_tokens": 7,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "total_tokens": 49,
                "cost": { "input": 123, "output": 456, "total": 579 }
            }))
            .unwrap(),
        );
        nac_core::sessions::create_session(path, &session).unwrap();
        nac_core::sessions::update_session_presentation(
            path,
            session_id,
            "Retained metadata",
            true,
            0,
        )
        .unwrap();
        store::TranscriptLogWriter::new(path)
            .unwrap()
            .append(
                session_id,
                1,
                &nac_core::types::Message::User {
                    content: "retained logged history".into(),
                },
            )
            .unwrap();
    }

    fn retained_data(&self) -> serde_json::Value {
        let session_id = "21856443-8ed8-40ab-9036-72e837c99f27";
        let connection = rusqlite::Connection::open(&self.path).unwrap();
        let presentation = connection.query_row(
            "SELECT title, pinned, sort_order, version FROM session_presentations WHERE session_id = ?1",
            [session_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?)),
        ).unwrap();
        let mut statement = connection.prepare(
            "SELECT id, thread_name, event_json, created_at FROM thread_events WHERE session_id = ?1 ORDER BY id",
        ).unwrap();
        let events = statement
            .query_map([session_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let schema: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        let journal: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(schema, store::schema_version());
        assert_eq!(store::MINIMUM_MIGRATABLE_SCHEMA_VERSION, 0);
        assert_eq!(journal, "wal");
        let session = nac_core::sessions::load_session(&self.path, session_id).unwrap();
        assert_eq!(session.session_id, session_id);
        // The durable facade returns the retained blob; the growable log is separate.
        assert_eq!(session.messages.len(), 1);
        assert_eq!(events.len(), 1);
        assert!(events[0].2.contains("retained logged history"));
        assert_eq!(
            session
                .unattributed_token_usage
                .as_ref()
                .unwrap()
                .cost
                .total,
            579
        );
        serde_json::json!({ "session": format!("{session:?}"), "presentation": presentation, "events": events, "schema": schema, "journal": journal })
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
            let session_id = "21856443-8ed8-40ab-9036-72e837c99f27";
            let retained_before = fixture.retained_data();
            let before = format!(
                "{:?}",
                nac_core::sessions::load_session(&fixture.path, session_id).unwrap()
            );
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
                store::schema_version()
            );
            assert_eq!(
                conn.pragma_query_value::<String, _>(None, "journal_mode", |row| row.get(0))
                    .unwrap(),
                "wal"
            );
            drop(conn);
            // Reopen through the real durable facade after the startup/accept commits.
            let retained = nac_core::sessions::load_session(&fixture.path, session_id).unwrap();
            assert_eq!(format!("{retained:?}"), before);
            assert_eq!(fixture.retained_data(), retained_before);
            assert_eq!(retained.session_id, session_id);
            assert_eq!(retained.unattributed_token_usage.unwrap().cost.total, 579);
            let reopened = rusqlite::Connection::open(&fixture.path).unwrap();
            let presentation = reopened.query_row(
                "SELECT title, pinned, version FROM session_presentations WHERE session_id = ?1",
                [session_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
            ).unwrap();
            assert_eq!(presentation, ("Retained metadata".into(), 1, 1));
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
            let retained_before = fixture.retained_data();
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
                assert_eq!(fixture.retained_data(), retained_before);
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
            assert_eq!(fixture.retained_data(), retained_before);
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

// Reconstruct the actual pre-terminal schema footprint and its target metadata;
// changing user_version alone would not establish a schema32 predecessor.
fn schema32_predecessor(fixture: &mut StartupFixture) {
    let connection = rusqlite::Connection::open(&fixture.path).unwrap();
    connection
        .execute_batch(
            "DROP TABLE human_shell_operations;
        DROP INDEX idx_session_inbox_admission;
        ALTER TABLE session_inbox DROP COLUMN admission_digest;
        ALTER TABLE session_inbox DROP COLUMN admission_id;",
        )
        .unwrap();
    fixture.prior.target.schema_version = 32;
    fixture
        .config
        .managed_upgrade_expectation
        .as_mut()
        .unwrap()
        .previous_target = StartupFixture::target(&fixture.prior.target);
    // These are nonsecret synthetic legacy ledger fixtures, never customer rows.
    fn legacy_target(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(fields) => {
                if fields.contains_key("schema_version") && fields.contains_key("release_id") {
                    fields.insert("schema_version".into(), 32.into());
                }
                for child in fields.values_mut() {
                    legacy_target(child);
                }
            }
            serde_json::Value::Array(values) => {
                for child in values {
                    legacy_target(child);
                }
            }
            _ => {}
        }
    }
    for (table, key, columns) in [
        (
            "managed_host_maintenance",
            "singleton",
            &["target_json", "accepted_identity_json"][..],
        ),
        (
            "managed_control_operations",
            "operation_id",
            &["binding_json", "latest_outcome_json"][..],
        ),
        (
            "managed_control_attempts",
            "jti",
            &["binding_json", "outcome_json"][..],
        ),
    ] {
        for column in columns {
            let mut statement = connection
                .prepare(&format!(
                    "SELECT CAST({key} AS TEXT), {column} FROM {table} WHERE {column} IS NOT NULL"
                ))
                .unwrap();
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            for (id, json) in rows {
                let mut value: serde_json::Value = serde_json::from_str(&json).unwrap();
                legacy_target(&mut value);
                connection
                    .execute(
                        &format!("UPDATE {table} SET {column}=?1 WHERE CAST({key} AS TEXT)=?2"),
                        rusqlite::params![value.to_string(), id],
                    )
                    .unwrap();
            }
        }
    }
    connection.pragma_update(None, "user_version", 32).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='human_shell_operations'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(connection.query_row("SELECT COUNT(*) FROM pragma_table_info('session_inbox') WHERE name IN ('admission_id','admission_digest')", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
}

fn raw_retained_records(path: &Path) -> Vec<Vec<Vec<rusqlite::types::Value>>> {
    let connection = rusqlite::Connection::open(path).unwrap();
    ["sessions", "thread_events", "session_presentations"]
        .into_iter()
        .map(|table| {
            let mut statement = connection
                .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                .unwrap();
            let columns = statement.column_count();
            statement
                .query_map([], |row| {
                    (0..columns).map(|column| row.get(column)).collect()
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        })
        .collect()
}

#[test]
fn managed_schema32_to34_startup_preserves_data_and_exact_identity_before_acceptance() {
    assert_eq!(store::schema_version(), 34);
    assert_eq!(store::MINIMUM_MIGRATABLE_SCHEMA_VERSION, 0);
    for version in [
        nac_managed::MANAGED_CONFIG_VERSION,
        nac_managed::HOST_KEY_MANAGED_CONFIG_VERSION,
    ] {
        for maintenance in [false, true] {
            let mut fixture = StartupFixture::new(version, maintenance);
            schema32_predecessor(&mut fixture);
            let before = raw_retained_records(&fixture.path);
            let connection = rusqlite::Connection::open(&fixture.path).unwrap();
            let read_schema = || {
                connection
                    .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                    .unwrap()
            };
            assert_eq!(read_schema(), 32);
            // An incorrect original-owner boundary cannot migrate the predecessor.
            let mut wrong = fixture.config.clone();
            wrong.managed_upgrade_expectation.as_mut().unwrap().actor = "user:other".into();
            assert!(managed_startup_plan(&fixture.path, Some(&wrong), &fixture.running).is_err());
            assert_eq!(read_schema(), 32);
            assert_eq!(raw_retained_records(&fixture.path), before);
            let plan = managed_startup_plan(&fixture.path, Some(&fixture.config), &fixture.running)
                .unwrap();
            let identity = plan.preflight.accepted_identity.unwrap();
            assert!(plan.preflight.requires_accept);
            assert_eq!(identity.managed_host_id, fixture.prior.managed_host_id);
            assert_eq!(
                identity.host_incarnation_id,
                fixture.prior.host_incarnation_id
            );
            assert_eq!(identity.target, fixture.running);
            assert_eq!(read_schema(), 32); // Exact controller CAS precedes migration.
            store::initialize(&fixture.path).unwrap(); // The ordinary automatic migration owner.
            assert_eq!(read_schema(), 34);
            assert_eq!(raw_retained_records(&fixture.path), before);
            let retained = fixture.retained_data();
            assert_eq!(retained["schema"], 34);
            assert_eq!(retained["journal"], "wal");
            let mut changed = identity.clone();
            changed.host_incarnation_id = "other-incarnation".into();
            assert!(!store::accept_managed_forward_start(&fixture.path, &changed).unwrap());
            assert!(store::accept_managed_forward_start(&fixture.path, &identity).unwrap());
            assert_eq!(raw_retained_records(&fixture.path), before);
            assert_eq!(fixture.retained_data(), retained);
            let reopened =
                managed_startup_plan(&fixture.path, Some(&fixture.config), &fixture.running)
                    .unwrap();
            assert!(!reopened.preflight.requires_accept);
            assert_eq!(reopened.preflight.accepted_identity, Some(identity));
        }
    }
}
