use super::*;

fn fixture() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
            "CREATE TABLE sessions(session_id TEXT PRIMARY KEY, behavior TEXT NOT NULL, sandbox_json TEXT);
             CREATE TABLE traditional_children(child_session_id TEXT, parent_session_id TEXT, root_session_id TEXT);
             CREATE TABLE managed_orchestrators(orchestrator_session_id TEXT, parent_session_id TEXT, root_session_id TEXT);
             CREATE TABLE terminal_remote_cleanups(session_id TEXT, pidfile TEXT);
             CREATE TABLE episodes(session_id TEXT);
             CREATE TABLE workset_items(session_id TEXT);
             CREATE TABLE threads(session_id TEXT);
             CREATE TABLE worksets(session_id TEXT);
             CREATE TABLE session_forks(source_session_id TEXT, fork_session_id TEXT);
             INSERT INTO sessions(session_id, behavior) VALUES
               ('retired','orchestrator'), ('hybrid','direct-with-orchestrator'),
               ('managed','orchestrator'), ('child','direct'), ('nested','direct'),
               ('direct','direct'), ('direct-child','direct'), ('fork','direct');
             INSERT INTO managed_orchestrators VALUES('managed','hybrid','hybrid');
             INSERT INTO traditional_children VALUES
               ('child','managed','hybrid'), ('nested','child','hybrid'), ('direct-child','direct','direct');
             INSERT INTO session_forks VALUES('retired','fork');",
        ).unwrap();
    conn
}

#[test]
fn retired_roots_and_owned_descendants_are_selected_but_forks_survive() {
    let conn = fixture();
    assert_eq!(all_session_ids(&conn).unwrap().len(), 8);
    let actual = doomed_sessions(&conn).unwrap();
    let expected = ["retired", "hybrid", "managed", "child", "nested"]
        .into_iter()
        .map(str::to_owned)
        .collect();
    assert_eq!(actual, expected);
}

#[test]
fn malformed_ownership_and_unknown_behavior_fail_closed() {
    for change in [
        "UPDATE sessions SET behavior='unknown' WHERE session_id='direct'",
        "UPDATE sessions SET behavior='direct' WHERE session_id='managed'",
        "INSERT INTO traditional_children VALUES('direct','missing','missing')",
        "INSERT INTO traditional_children VALUES('managed','direct','direct')",
        "INSERT INTO traditional_children VALUES('direct','direct-child','direct-child')",
        "UPDATE traditional_children SET root_session_id='direct' WHERE child_session_id='child'",
        "UPDATE traditional_children SET root_session_id='child' WHERE child_session_id='nested'",
    ] {
        let conn = fixture();
        conn.execute_batch(change).unwrap();
        assert!(doomed_sessions(&conn).is_err(), "{change}");
    }
}

#[test]
fn retired_resource_authority_blocks_purge_but_surviving_resources_do_not() {
    for change in [
        "UPDATE sessions SET sandbox_json='{}' WHERE session_id='child'",
        "INSERT INTO terminal_remote_cleanups VALUES('retired','/remote/pid')",
    ] {
        let conn = fixture();
        conn.execute_batch(change).unwrap();
        let doomed = doomed_sessions(&conn).unwrap();
        let error = ensure_resources_drained(&conn, &doomed).unwrap_err();
        assert!(error.to_string().contains("compatible prior NAC binary"));
        assert_eq!(doomed_sessions(&conn).unwrap(), doomed);
    }
    let conn = fixture();
    conn.execute_batch(
        "UPDATE sessions SET sandbox_json='{}' WHERE session_id='direct';
             INSERT INTO terminal_remote_cleanups VALUES('direct','/remote/pid');",
    )
    .unwrap();
    ensure_resources_drained(&conn, &doomed_sessions(&conn).unwrap()).unwrap();
}

#[test]
fn prior_owner_leases_exclude_retirement_and_release_after_failure() {
    let root = std::env::temp_dir().join(format!("nac-retirement-locks-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.db");
    std::fs::write(&path, "").unwrap();
    let sessions = ["retired".to_owned(), "survivor".to_owned()]
        .into_iter()
        .collect();
    let process = crate::sessions::StoreProcessLease::try_acquire(&path).unwrap();
    assert!(acquire_retirement_leases(&path, &sessions).is_err());
    drop(process);
    let existing = crate::sessions::SessionOperationLease::try_acquire(&path, "retired").unwrap();
    assert!(acquire_retirement_leases(&path, &sessions).is_err());
    drop(existing);
    let survivor = crate::sessions::SessionResourceLease::try_acquire(&path, "survivor").unwrap();
    assert!(acquire_retirement_leases(&path, &sessions).is_err());
    drop(survivor);
    let retirement = acquire_retirement_leases(&path, &sessions).unwrap();
    assert!(crate::sessions::SessionOperationLease::try_acquire(&path, "retired").is_err());
    assert!(crate::sessions::HostAdmissionLease::try_acquire(&path).is_err());
    drop(retirement);
    assert!(crate::sessions::SessionOperationLease::try_acquire(&path, "retired").is_ok());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn purge_is_transactional_and_preserves_independent_fork_provenance() {
    let mut conn = fixture();
    conn.execute_batch(
        "INSERT INTO episodes VALUES('retired'),('direct');
             INSERT INTO workset_items VALUES('retired'),('direct');
             INSERT INTO threads VALUES('retired'),('direct');
             INSERT INTO worksets VALUES('retired'),('direct');",
    )
    .unwrap();
    let doomed = doomed_sessions(&conn).unwrap();
    {
        let tx = conn.transaction().unwrap();
        purge_owned_rows(&tx, &doomed).unwrap();
        assert_eq!(
            tx.query_row::<i64, _, _>("SELECT count(*) FROM sessions", [], |row| row.get(0))
                .unwrap(),
            3
        );
        tx.rollback().unwrap();
    }
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM sessions", [], |row| row.get(0))
            .unwrap(),
        8
    );
    let tx = conn.transaction().unwrap();
    purge_owned_rows(&tx, &doomed).unwrap();
    tx.commit().unwrap();
    for table in ["episodes", "workset_items", "threads", "worksets"] {
        let count: i64 = conn
            .query_row(
                &format!("SELECT count(*) FROM {table} WHERE session_id='direct'"),
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
    assert_eq!(conn.query_row::<i64, _, _>("SELECT count(*) FROM session_forks WHERE source_session_id='retired' AND fork_session_id='fork'", [], |row| row.get(0)).unwrap(), 1);
}

#[test]
fn purge_uses_real_schema_cascades_and_keeps_direct_session_and_fork() {
    let root = std::env::temp_dir().join(format!("nac-retirement-schema-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    initialize_synthetic_predecessor(&path).unwrap();
    for id in ["hybrid", "child", "direct", "fork"] {
        insert_test_session(&path, id);
    }
    let mut conn = open_runtime_connection(&path).unwrap();
    conn.execute_batch(
            "DROP TRIGGER IF EXISTS session_direct_only_insert;
             DROP TRIGGER IF EXISTS session_direct_only_update;
             UPDATE sessions SET behavior='direct';
             UPDATE sessions SET behavior='direct-with-orchestrator' WHERE session_id='hybrid';
             INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,created_at,updated_at)
               VALUES('child','hybrid','hybrid','general','owned child',1,'idle',0,'now','now');
             INSERT INTO session_forks(source_session_id,fork_session_id,source_message_idx,created_at)
               VALUES('hybrid','fork',0,'now');",
        ).unwrap();
    let doomed = doomed_sessions(&conn).unwrap();
    assert_eq!(
        doomed,
        ["hybrid".to_owned(), "child".to_owned()]
            .into_iter()
            .collect()
    );
    {
        let tx = conn.transaction().unwrap();
        purge_owned_rows(&tx, &doomed).unwrap();
        assert_eq!(
            tx.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap(),
            0
        );
        tx.rollback().unwrap();
    }
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM traditional_children", [], |row| row
            .get(0))
            .unwrap(),
        1
    );
    let tx = conn.transaction().unwrap();
    purge_owned_rows(&tx, &doomed).unwrap();
    tx.commit().unwrap();
    let surviving: Vec<String> = conn
        .prepare("SELECT session_id FROM sessions ORDER BY session_id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(surviving, ["direct", "fork"]);
    assert_eq!(conn.query_row::<i64, _, _>("SELECT count(*) FROM session_forks WHERE source_session_id='hybrid' AND fork_session_id='fork'", [], |row| row.get(0)).unwrap(), 1);
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn real_schema_cleanup_authority_is_retained_on_refusal() {
    let root =
        std::env::temp_dir().join(format!("nac-retirement-cleanup-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    initialize_synthetic_predecessor(&path).unwrap();
    insert_test_session(&path, "retired");
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS session_direct_only_insert;
             DROP TRIGGER IF EXISTS session_direct_only_update;
             UPDATE sessions SET behavior='orchestrator' WHERE session_id='retired';
             INSERT INTO terminal_remote_cleanups(session_id,pidfile,created_at)
             VALUES('retired','/remote/owned-pid','now');",
    )
    .unwrap();
    let doomed = doomed_sessions(&conn).unwrap();
    assert!(ensure_resources_drained(&conn, &doomed).is_err());
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM terminal_remote_cleanups", [], |row| {
            row.get(0)
        })
        .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT count(*) FROM sessions WHERE session_id='retired'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        1
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn previous_schema_upgrade_rolls_back_and_retries_as_one_transaction() {
    let root =
        std::env::temp_dir().join(format!("nac-retirement-upgrade-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    let conn = create_v52_store(&path);
    for id in [
        "hybrid",
        "child",
        "nested",
        "managed",
        "direct",
        "direct-child",
        "fork",
        "standalone",
    ] {
        insert_v52_session(&conn, id);
    }
    std::fs::write(root.join("user-file"), "preserve this file").unwrap();
    {
        conn.execute_batch(
                "UPDATE sessions SET behavior='direct';
                 UPDATE sessions SET behavior='direct-with-orchestrator' WHERE session_id='hybrid';
                 UPDATE sessions SET behavior='orchestrator' WHERE session_id='managed';
                 UPDATE sessions SET backend='openai-responses', last_user_prompt='orchestrator wording remains', light_model_json='malformed legacy light bytes' WHERE session_id='direct';
                 INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,created_at,updated_at)
                   VALUES('child','hybrid','hybrid','general','owned child',1,'idle',0,'now','now'),
                         ('nested','child','hybrid','general','nested child',1,'idle',0,'now','now'),
                         ('direct-child','direct','direct','general','surviving child',1,'idle',0,'now','now');
                 INSERT INTO managed_orchestrators(orchestrator_session_id,parent_session_id,root_session_id,description,status,generation,created_at,updated_at)
                   VALUES('managed','hybrid','hybrid','managed child','idle',0,'now','now');
                 INSERT INTO session_forks(source_session_id,fork_session_id,source_message_idx,created_at)
                   VALUES('hybrid','fork',0,'now');
                 INSERT INTO model_configurations(config_id,name,backend,model,base_url,allow_insecure_http,api_key_env,created_at,updated_at,light_model_json)
                   VALUES('legacy-route','old setup','openai-responses','old-model','https://example.invalid/v1',0,'NAC_CONFIG_PRESERVE','before','after','malformed inert value'),
                         ('no-key','no-key setup','openai-responses','old-model','https://example.invalid/v1',0,NULL,'before','after',NULL);
                 INSERT INTO session_goals(session_id,goal_id,objective,status,tokens_used,time_used_ms,created_at,updated_at,version)
                   VALUES('direct','goal-direct','preserve goal','paused',17,1234,'now','now',4),
                         ('hybrid','goal-retired','retired goal','paused',2,3,'now','now',1);
                 INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at,version)
                   VALUES('direct','queue','pending','preserve inbox','now','now',3),
                         ('hybrid','queue','pending','retired inbox','now','now',1);
                 INSERT INTO permission_grants(id,session_id,action,resource,backend,session_config_version,created_at)
                   VALUES('grant-direct','direct','read','/tmp/project','local',0,'now'),
                         ('grant-retired','hybrid','read','/tmp/project','local',0,'now');
                 INSERT INTO orchestrator_compaction_checkpoints(session_id,summary,tail_start_message_index,source_prefix_sha256,system_policy_sha256,prompt_policy_version,old_context_estimate,new_context_estimate,created_at)
                   VALUES('direct','preserve summary',0,zeroblob(32),zeroblob(32),1,20,10,'now'),
                         ('hybrid','retired summary',0,zeroblob(32),zeroblob(32),1,20,10,'now');
                 INSERT INTO thread_events(id,session_id,thread_name,event_json,created_at)
                   VALUES(100,'direct','__orchestrator__','{}','now'),(150,'hybrid','__orchestrator__','{}','now');
                 INSERT INTO transcript_append_receipts(session_id,operation_id,digest,start_idx,end_idx,last_message_id)
                   VALUES('direct','direct-op','digest',0,1,100),('hybrid','retired-op','digest',0,1,150);
                 PRAGMA user_version=52;",
            ).unwrap();
    }
    conn.execute(
        "UPDATE thread_events SET event_json=?1 WHERE id=100",
        [crate::store::encode_transcript_log_entry(
            0,
            &crate::types::Message::User {
                content: "preserved direct transcript".into(),
            },
        )
        .unwrap()],
    )
    .unwrap();
    drop(conn);
    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("before commit"))).is_err());
    {
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            52
        );
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT count(*) FROM sessions", [], |row| row.get(0))
                .unwrap(),
            8
        );
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT count(*) FROM traditional_children", [], |row| row
                .get(0))
                .unwrap(),
            3
        );
    }
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    {
        let conn = open_runtime_connection(&path).unwrap();
        let connections = crate::store::list_provider_connections(&path).unwrap();
        assert_eq!(connections.len(), 1);
        assert_eq!(connections[0].connection_id, "legacy-route");
        assert_eq!(connections[0].api_key_env, "NAC_CONFIG_PRESERVE");
        assert_eq!(connections[0].base_url, "https://example.invalid/v1");
        let surviving: Vec<String> = conn
            .prepare("SELECT session_id FROM sessions ORDER BY session_id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(surviving, ["direct", "direct-child", "fork", "standalone"]);
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT last_user_prompt FROM sessions WHERE session_id='direct'",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            "orchestrator wording remains"
        );
        assert!(!column_exists(&conn, "sessions", "light_model_json").unwrap());
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM traditional_children WHERE child_session_id='direct-child'",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(conn.query_row::<(String,i64,i64,i64),_,_>("SELECT objective,tokens_used,time_used_ms,version FROM session_goals WHERE session_id='direct'", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).unwrap(), ("preserve goal".into(),17,1234,4));
        assert_eq!(
            conn.query_row::<(String, i64), _, _>(
                "SELECT content,version FROM session_inbox WHERE session_id='direct'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?))
            )
            .unwrap(),
            ("preserve inbox".into(), 3)
        );
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM permission_grants WHERE id='grant-direct'",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT summary FROM session_compaction_checkpoints WHERE session_id='direct'",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            "preserve summary"
        );
        assert_eq!(conn.query_row::<i64,_,_>("SELECT last_message_id FROM transcript_append_receipts WHERE session_id='direct' AND operation_id='direct-op'", [], |row| row.get(0)).unwrap(), 100);
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT seq FROM sqlite_sequence WHERE name='session_events'",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            150
        );
        for table in [
            "session_goals",
            "session_inbox",
            "permission_grants",
            "session_compaction_checkpoints",
            "session_events",
            "transcript_append_receipts",
        ] {
            assert_eq!(
                conn.query_row::<i64, _, _>(
                    &format!("SELECT count(*) FROM {table} WHERE session_id='hybrid'"),
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
                0,
                "{table}"
            );
        }
        assert_eq!(conn.query_row::<i64, _, _>("SELECT count(*) FROM session_forks WHERE source_session_id='hybrid' AND fork_session_id='fork'", [], |row| row.get(0)).unwrap(), 1);
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM pragma_foreign_key_check",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            0
        );
        assert!(conn
            .execute(
                "UPDATE sessions SET behavior='orchestrator' WHERE session_id='direct'",
                []
            )
            .is_err());
    }
    assert_eq!(
        std::fs::read_to_string(root.join("user-file")).unwrap(),
        "preserve this file"
    );
    assert!(crate::sessions::load_session(&path, "direct").is_ok());
    std::fs::remove_dir_all(root).unwrap();
}

fn create_v52_store(path: &Path) -> Connection {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(include_str!("fixtures/v52.sql"))
        .unwrap();
    conn
}

fn insert_v52_session(conn: &Connection, id: &str) {
    conn.execute("INSERT INTO sessions(session_id,cwd,store_path,model,base_url,messages_json,created_at,updated_at) VALUES (?1,'/tmp/project','/tmp/store.db','test-model','https://example.invalid','[]','now','now')", [id]).unwrap();
}

fn previous_schema_with_retired(path: &Path, cleanup: bool) {
    let conn = create_v52_store(path);
    insert_v52_session(&conn, "retired");
    if cleanup {
        conn.execute("INSERT INTO terminal_remote_cleanups(session_id,pidfile,created_at) VALUES('retired','/remote/pid','now')", []).unwrap();
    }
}

#[test]
fn contradictory_intermediate_root_refuses_upgrade_without_mutation() {
    let root = std::env::temp_dir().join(format!("nac-retirement-root-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    let conn = create_v52_store(&path);
    for id in ["retired", "child", "nested"] {
        insert_v52_session(&conn, id);
    }
    conn.execute_batch(
        "UPDATE sessions SET behavior='direct' WHERE session_id IN ('child','nested');
         INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,created_at,updated_at)
         VALUES('child','retired','retired','general','child',1,'idle',0,'now','now'),
               ('nested','child','child','general','nested',1,'idle',0,'now','now');",
    ).unwrap();
    let before: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    drop(conn);
    let error = crate::store::initialize(&path).unwrap_err();
    assert!(format!("{error:#}").contains("contradictory ownership root"));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("PRAGMA user_version", [], |row| row.get(0))
            .unwrap(),
        before
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM sessions", [], |row| row.get(0))
            .unwrap(),
        3
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM traditional_children", [], |row| row
            .get(0))
            .unwrap(),
        2
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn peer_and_pending_resource_authority_refuse_without_retirement_changes() {
    for variant in ["lease", "process", "remote", "sandbox"] {
        let root =
            std::env::temp_dir().join(format!("nac-retirement-refusal-{}", uuid::Uuid::new_v4()));
        let path = root.join("store.db");
        previous_schema_with_retired(&path, variant == "remote");
        if variant == "sandbox" {
            Connection::open(&path)
                .unwrap()
                .execute(
                    "UPDATE sessions SET sandbox_json='{}' WHERE session_id='retired'",
                    [],
                )
                .unwrap();
        }
        let lease = (variant == "lease").then(|| {
            crate::sessions::SessionOperationLease::try_acquire(&path, "retired").unwrap()
        });
        let process = (variant == "process")
            .then(|| crate::sessions::StoreProcessLease::try_acquire(&path).unwrap());
        assert!(initialize(&path).is_err());
        assert!(open_runtime_connection(&path).is_err());
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            52
        );
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM sessions WHERE session_id='retired'",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            1
        );
        if variant == "remote" {
            assert_eq!(
                conn.query_row::<i64, _, _>(
                    "SELECT count(*) FROM terminal_remote_cleanups",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
                1
            );
        }
        if variant == "sandbox" {
            let sandbox: Option<String> = conn
                .query_row(
                    "SELECT sandbox_json FROM sessions WHERE session_id='retired'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(sandbox.as_deref(), Some("{}"));
        }
        drop(conn);
        drop(lease);
        drop(process);
        if variant == "lease" || variant == "process" {
            initialize(&path).unwrap();
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn serving_coordinator_upgrades_under_its_existing_process_lease() {
    let root = std::env::temp_dir().join(format!(
        "nac-retirement-coordinator-{}",
        uuid::Uuid::new_v4()
    ));
    let path = root.join("store.db");
    previous_schema_with_retired(&path, false);
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    owner.initialize().await.unwrap();
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM sessions", [], |row| row.get(0))
            .unwrap(),
        0
    );
    drop(conn);
    owner.shutdown().await.unwrap();
    drop(owner);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn competing_upgrades_serialize_and_purge_once() {
    use std::sync::mpsc;
    use std::time::Duration;

    let root =
        std::env::temp_dir().join(format!("nac-retirement-startups-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    previous_schema_with_retired(&path, false);
    let (locked_tx, locked_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first_path = path.clone();
    let first = std::thread::spawn(move || {
        initialize_with_hooks(
            &first_path,
            || {},
            || {
                locked_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            },
            || Ok(()),
        )
    });
    locked_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let (preflight_tx, preflight_rx) = mpsc::channel();
    let second_path = path.clone();
    let second = std::thread::spawn(move || {
        initialize_with_hooks(
            &second_path,
            || {
                preflight_tx.send(()).unwrap();
            },
            || {},
            || Ok(()),
        )
    });
    preflight_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    release_tx.send(()).unwrap();
    first.join().unwrap().unwrap();
    second.join().unwrap().unwrap();
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM sessions", [], |row| row.get(0))
            .unwrap(),
        0
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn pending_podman_creation_refuses_upgrade_and_preserves_record() {
    use std::os::unix::fs::PermissionsExt;

    struct Cleanup(Vec<PathBuf>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            for path in &self.0 {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }

    let temp = std::env::temp_dir();
    let nonce = uuid::Uuid::new_v4();
    let root = temp.join(format!("nac-retirement-podman-store-{nonce}"));
    let path = root.join("store.db");
    previous_schema_with_retired(&path, false);
    let staging = temp.join(format!("nac-retirement-record-staging-{nonce}"));
    let record = temp.join(format!("nac-podman-create-retirement-{nonce}"));
    let _cleanup = Cleanup(vec![root.clone(), staging.clone(), record.clone()]);
    std::fs::create_dir(&staging).unwrap();
    std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o700)).unwrap();
    let binding = staging.join("store.path");
    let bytes = serde_json::to_vec(&path.canonicalize().unwrap()).unwrap();
    std::fs::write(&binding, &bytes).unwrap();
    std::fs::set_permissions(&binding, std::fs::Permissions::from_mode(0o600)).unwrap();
    std::fs::rename(&staging, &record).unwrap();
    assert!(initialize(&path).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        52
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT count(*) FROM sessions WHERE session_id='retired'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(std::fs::read(record.join("store.path")).unwrap(), bytes);
    drop(conn);
    std::fs::rename(&record, &staging).unwrap();
    std::fs::remove_dir_all(staging).unwrap();
    initialize(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn v53_retirement_rejects_orphaned_managed_inbox_origin_atomically() {
    let root = std::env::temp_dir().join(format!("nac-v54-orphan-inbox-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    std::fs::create_dir_all(&root).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("fixtures/v53.sql"))
        .unwrap();
    conn.execute("INSERT INTO sessions(session_id,behavior,cwd,store_path,model,base_url,messages_json,created_at,updated_at) VALUES ('direct','direct','/tmp/project','/tmp/store.db','test-model','https://example.invalid','[]','now','now')", []).unwrap();
    conn.execute("INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at,version,completion_source,completion_session_id,completion_generation) VALUES('direct','queue','pending','preserve','now','now',0,'managed_orchestrator','missing',1)", []).unwrap();
    drop(conn);
    let error = initialize(&path).unwrap_err().to_string();
    assert!(
        error.contains("retired managed completion remains in a surviving inbox"),
        "{error}"
    );
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        53
    );
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT content FROM session_inbox WHERE session_id='direct'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        "preserve"
    );
    assert!(column_exists(&conn, "sessions", "light_model_json").unwrap());
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn v54_retirement_preserves_live_direct_data_and_edited_connections() {
    let root = std::env::temp_dir().join(format!("nac-v54-retirement-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    std::fs::create_dir_all(&root).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("fixtures/v53.sql"))
        .unwrap();
    // The direct-retirement predecessor is v54 after the speed migration.
    conn.pragma_update(None, "user_version", 54).unwrap();
    conn.execute("INSERT INTO sessions(session_id,behavior,cwd,store_path,model,base_url,messages_json,created_at,updated_at) VALUES ('direct','direct','/tmp/project','/tmp/store.db','test-model','https://example.invalid','[]','now','now')", []).unwrap();
    conn.execute_batch(
        "INSERT INTO model_configurations(config_id,name,backend,model,base_url,allow_insecure_http,api_key_env,created_at,updated_at)
         VALUES('edited','edited','openai-responses','old','https://old.invalid',0,'OLD_KEY','before','before'),
               ('deleted','deleted','openai-responses','old','https://old.invalid',0,'DELETED_KEY','before','before');
         INSERT INTO provider_connections(connection_id,backend,base_url,allow_insecure_http,api_key_env,created_at,updated_at)
         VALUES('edited','openai-responses','https://new.invalid',0,'NEW_KEY','before','after');
         INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at,version)
         VALUES('direct','queue','pending','keep me','now','now',2);
         INSERT INTO thread_events(id,session_id,thread_name,event_json,created_at)
         VALUES(77,'direct','__orchestrator__','{}','now');",
    ).unwrap();
    drop(conn);
    let reached_commit = std::cell::Cell::new(false);
    assert!(initialize_with_hooks(
        &path,
        || {},
        || {},
        || {
            reached_commit.set(true);
            Err(anyhow!("before commit"))
        }
    )
    .is_err());
    assert!(
        reached_commit.get(),
        "migration must reach the injected rollback point"
    );
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        54
    );
    assert!(column_exists(&conn, "sessions", "light_model_json").unwrap());
    assert!(column_exists(&conn, "projects", "default_model_config_id").unwrap());
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM model_configurations", [], |r| r
            .get(0))
            .unwrap(),
        2
    );
    drop(conn);
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    for table in [
        "managed_orchestrator_terminal_receipts",
        "managed_orchestrators",
        "worker_dispatches",
        "episodes",
        "threads",
        "workset_items",
        "worksets",
        "thread_steering",
        "model_configurations",
    ] {
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |r| r.get(0)
            )
            .unwrap(),
            0,
            "{table}"
        );
    }
    assert!(!column_exists(&conn, "sessions", "light_model_json").unwrap());
    assert!(!column_exists(&conn, "projects", "default_model_config_id").unwrap());
    assert_eq!(
        conn.query_row::<(String, String), _, _>(
            "SELECT base_url, api_key_env FROM provider_connections WHERE connection_id='edited'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?))
        )
        .unwrap(),
        ("https://new.invalid".into(), "NEW_KEY".into())
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM provider_connections", [], |r| r
            .get(0))
            .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT content FROM session_inbox WHERE session_id='direct'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        "keep me"
    );
    assert!(conn.execute("INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at,version,completion_source,completion_session_id,completion_generation) VALUES('direct','queue','pending','invalid','now','now',0,'managed_orchestrator','missing',1)", []).is_err());
    assert!(conn.execute("UPDATE session_inbox SET completion_source='managed_orchestrator', completion_session_id='missing', completion_generation=1 WHERE session_id='direct'", []).is_err());
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT id FROM session_events WHERE session_id='direct'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        77
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn competing_v53_upgrades_serialize_and_preserve_the_connection() {
    use std::sync::mpsc;
    use std::time::Duration;

    let root = std::env::temp_dir().join(format!("nac-v54-concurrent-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    std::fs::create_dir_all(&root).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("fixtures/v53-fresh.sql"))
        .unwrap();
    conn.execute("INSERT INTO provider_connections VALUES('route','openai-responses','https://example.invalid',0,'KEY','before','after')", []).unwrap();
    drop(conn);
    let (locked_tx, locked_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first_path = path.clone();
    let first = std::thread::spawn(move || {
        initialize_with_hooks(
            &first_path,
            || {},
            || {
                locked_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            },
            || Ok(()),
        )
    });
    locked_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let (preflight_tx, preflight_rx) = mpsc::channel();
    let second_path = path.clone();
    let second = std::thread::spawn(move || {
        initialize_with_hooks(
            &second_path,
            || {
                preflight_tx.send(()).unwrap();
            },
            || {},
            || Ok(()),
        )
    });
    preflight_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    release_tx.send(()).unwrap();
    first.join().unwrap().unwrap();
    second.join().unwrap().unwrap();
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT api_key_env FROM provider_connections WHERE connection_id='route'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        "KEY"
    );
    assert!(!table_exists(&conn, "model_configurations").unwrap());
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}
