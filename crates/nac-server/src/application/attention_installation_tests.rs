//! Deterministic real bind/canonical-read controls; no provider or model run.
use super::*;

struct Fixture {
    root: std::path::PathBuf,
    manager: SessionManager,
    service: Arc<SessionService>,
    subscription: NativeAttentionSubscription,
    live: Arc<Live>,
    _environment: crate::tests::ScopedModelEnv,
}
impl Fixture {
    async fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-installation-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let environment =
            crate::tests::ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
        crate::tests::seed_direct_session(&root, "session");
        let manager = SessionManager::new_async(crate::ServerOptions {
            root_cwd: root.clone(),
            store_path: Some(root.join("store.db")),
            worker_executable: None,
            managed_host: None,
        })
        .await
        .unwrap();
        let service = manager.attach_session("session").await.unwrap();
        manager
            .inner
            .attention
            .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
        let subscription = manager
            .inner
            .attention
            .open(manager.clone(), None)
            .await
            .unwrap();
        let live = Arc::clone(&subscription._lease.0);
        // Drive the actual canonical read/apply seam explicitly at the bind
        // cutpoint. Do not race a second test-owned copy of reconciliation.
        let task = live.task.lock().unwrap().take().unwrap();
        task.abort();
        let _ = task.await;
        Self {
            root,
            manager,
            service,
            subscription,
            live,
            _environment: environment,
        }
    }
    async fn reconcile(&self) {
        let generation = self.live.state.lock().unwrap().sources["session"].generation;
        let rows = read(
            &self.manager,
            Some("session"),
            Arc::clone(&self.live._permit),
        )
        .await
        .unwrap();
        self.live.apply("session", generation, rows).unwrap();
    }
    async fn retire(&mut self) -> AttentionRecord {
        let registration = self.live.state.lock().unwrap().sources["session"]
            .binding
            .as_ref()
            .unwrap()
            .registration
            .unwrap();
        self.service.remove_attention_observer(registration);
        self.reconcile().await;
        let AttentionRead::Record(record) = self.subscription.subscription.next().await else {
            panic!("retirement record")
        };
        let AttentionRecordChange::SourceReplaced(snapshot) = &record.change else {
            panic!("retirement replacement: {record:?}")
        };
        assert_eq!(snapshot.availability.permissions, AttentionFacet::Unknown);
        assert!(snapshot.work.is_none());
        assert!(!record.new_attention);
        (*record).clone()
    }
    fn hold_installation(
        &self,
    ) -> (
        std::sync::mpsc::Sender<()>,
        Arc<ReadGate>,
        tokio::task::JoinHandle<()>,
    ) {
        let (release, receiver) = std::sync::mpsc::channel();
        let gate = Arc::new(ReadGate {
            reached: Notify::new(),
            release: Mutex::new(receiver),
        });
        self.manager
            .inner
            .attention
            .0
            .lock()
            .unwrap()
            .installation_gate = Some(Arc::clone(&gate));
        let live = Arc::clone(&self.live);
        let service = Arc::clone(&self.service);
        let task = tokio::task::spawn_blocking(move || live.bind(&service));
        (release, gate, task)
    }
    async fn close(self) {
        let Self {
            root,
            manager,
            service,
            subscription,
            live,
            _environment,
        } = self;
        live.close();
        drop(subscription);
        drop(live);
        drop(service);
        manager.quiesce_persistence_callers().await;
        manager.drain_persistence().await.unwrap();
        drop(manager);
        std::fs::remove_dir_all(root).unwrap();
        drop(_environment);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn installation_frontier_blocks_partial_replacement_until_real_snapshot_installs() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let mut f = Fixture::new().await;
    let lost = f.retire().await;
    let boundary = f.live.hub.boundary();
    let (release, gate, installing) = f.hold_installation();
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    // This generation is the NEW binding's generation, not merely a stale
    // read. The actual pre-fix apply publishes Unknown at this exact cutpoint.
    f.reconcile().await;
    let during = f.live.hub.boundary();
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), installing)
        .await
        .unwrap()
        .unwrap();
    f.reconcile().await;
    let AttentionRead::Record(replaced) = f.subscription.subscription.next().await else {
        panic!("installed replacement")
    };
    let AttentionRecordChange::SourceReplaced(snapshot) = &replaced.change else {
        panic!("replacement: {replaced:?}")
    };
    let available = snapshot.availability.permissions;
    assert_ne!(lost.source.epoch, replaced.source.epoch);
    assert!(!replaced.new_attention);
    assert!(snapshot.pending.is_empty() && snapshot.work.is_none());
    f.close().await;
    assert_eq!(
        during, boundary,
        "installation-in-progress published a partial source"
    );
    assert_eq!(available, AttentionFacet::Available);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn installation_frontier_keeps_committed_question_and_rejects_old_read_and_token() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let mut f = Fixture::new().await;
    let stale_token = f.live.state.lock().unwrap().sources["session"]
        .binding
        .as_ref()
        .unwrap()
        .token;
    let stale_snapshot = f.live.state.lock().unwrap().sources["session"]
        .service
        .clone()
        .unwrap();
    f.retire().await;
    let old_generation = f.live.state.lock().unwrap().sources["session"].generation;
    let old_rows = read(&f.manager, Some("session"), Arc::clone(&f.live._permit))
        .await
        .unwrap();
    let (release, gate, installing) = f.hold_installation();
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    // Canonical SQLite commit during installation. This is a metadata-reader
    // fixture, not a new question creation API or a claim about run admission.
    let request = nac_core::store::QuestionRequest {
        session_id: "session".into(),
        request_id: "install-question".into(),
        run_id: "install-run".into(),
        generation: "install-generation".into(),
        text: "Fixture question".into(),
        choices: vec![],
        responder_class: nac_core::store::QuestionResponder::HumanDecision,
    };
    let mut connection = rusqlite::Connection::open(f.root.join("store.db")).unwrap();
    let transaction = connection.transaction().unwrap();
    transaction.execute("INSERT INTO task_questions(session_id,request_id,request_json,creation_digest,config_version,project_id,revision,status,created_at) SELECT session_id,?1,?2,'installation-fixture',config_version,(SELECT project_id FROM session_projects WHERE session_id='session'),1,'pending','fixture' FROM sessions WHERE session_id='session'", rusqlite::params![request.request_id, serde_json::to_string(&request).unwrap()]).unwrap();
    transaction.commit().unwrap();
    drop(connection);
    {
        let mut state = f.live.state.lock().unwrap();
        f.live.dirty(&mut state, "session");
    }
    f.live.apply("session", old_generation, old_rows).unwrap();
    let pending_generation = f.live.state.lock().unwrap().sources["session"].generation;
    Sink {
        live: Arc::downgrade(&f.live),
        token: stale_token,
    }
    .service_changed("session", stale_snapshot);
    assert_eq!(
        f.live.state.lock().unwrap().sources["session"].generation,
        pending_generation
    );
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), installing)
        .await
        .unwrap()
        .unwrap();
    f.reconcile().await;
    let AttentionRead::Record(replaced) = f.subscription.subscription.next().await else {
        panic!("replacement")
    };
    assert!(matches!(
        &replaced.change,
        AttentionRecordChange::SourceReplaced(_)
    ));
    assert!(!replaced.new_attention);
    let AttentionRead::Record(pending) = f.subscription.subscription.next().await else {
        panic!("question")
    };
    assert!(
        matches!(&pending.change, AttentionRecordChange::Fact(AttentionChange::DecisionPending(AttentionDecision::Question { request_id, .. })) if request_id == "install-question")
    );
    assert!(pending.new_attention);
    let current = f.live.state.lock().unwrap().sources["session"]
        .published
        .clone()
        .unwrap();
    assert_eq!(current.pending.len(), 1);
    assert_eq!(current.availability.permissions, AttentionFacet::Available);
    assert!(tokio::time::timeout(
        Duration::from_millis(20),
        f.subscription.subscription.next()
    )
    .await
    .is_err());
    f.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn installation_frontier_failed_synchronous_install_resets_instead_of_waiting_forever() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let mut f = Fixture::new().await;
    f.retire().await;
    f.manager
        .inner
        .attention
        .0
        .lock()
        .unwrap()
        .fail_installation_snapshot = true;
    f.live.bind(&f.service);
    let closed = f.live.state.lock().unwrap().closed;
    f.close().await;
    assert!(
        closed,
        "failed install left a permanently pending observation owner"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn installation_frontier_does_not_starve_another_dirty_source() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let mut f = Fixture::new().await;
    f.retire().await;
    crate::tests::seed_direct_session(&f.root, "zz-other");
    let (release, gate, installing) = f.hold_installation();
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    {
        let mut state = f.live.state.lock().unwrap();
        f.live.dirty(&mut state, "zz-other");
    }
    let reader = Reader {
        observation: AttentionStoreObservation::subscribe(&f.manager.inner.store_path),
        _permit: Arc::clone(&f.live._permit),
    };
    let reconciling = tokio::spawn(run(Arc::downgrade(&f.live), f.manager.clone(), reader));
    let next =
        tokio::time::timeout(Duration::from_secs(5), f.subscription.subscription.next()).await;
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), installing)
        .await
        .unwrap()
        .unwrap();
    reconciling.abort();
    let _ = reconciling.await;
    f.close().await;
    let AttentionRead::Record(record) = next.unwrap() else {
        panic!("other source did not progress")
    };
    assert_eq!(
        record.source.session_id, "zz-other",
        "pending installation was selected instead"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn installation_frontier_bootstrap_cannot_return_a_partially_installed_baseline() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let Fixture {
        root,
        manager,
        service,
        subscription,
        live,
        _environment,
    } = Fixture::new().await;
    live.close();
    drop(subscription);
    drop(live);
    let bootstrap = Arc::new(BootstrapGate::default());
    manager.inner.attention.0.lock().unwrap().bootstrap_gate = Some(Arc::clone(&bootstrap));
    let opening_manager = manager.clone();
    let mut opening = tokio::spawn(async move {
        opening_manager
            .inner
            .attention
            .open(opening_manager.clone(), None)
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), bootstrap.reached.notified())
        .await
        .unwrap();
    let live = manager
        .inner
        .attention
        .0
        .lock()
        .unwrap()
        .live
        .upgrade()
        .unwrap();
    let registration = live.state.lock().unwrap().sources["session"]
        .binding
        .as_ref()
        .unwrap()
        .registration
        .unwrap();
    service.remove_attention_observer(registration);
    let (release, receiver) = std::sync::mpsc::channel();
    let gate = Arc::new(ReadGate {
        reached: Notify::new(),
        release: Mutex::new(receiver),
    });
    manager.inner.attention.0.lock().unwrap().installation_gate = Some(Arc::clone(&gate));
    let binding_live = Arc::clone(&live);
    let binding_service = Arc::clone(&service);
    let installing = tokio::task::spawn_blocking(move || binding_live.bind(&binding_service));
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    bootstrap.resume.notify_one();
    let early = tokio::time::timeout(Duration::from_millis(50), &mut opening)
        .await
        .ok();
    let returned_early = early.is_some();
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), installing)
        .await
        .unwrap()
        .unwrap();
    let subscription = match early {
        Some(result) => result.unwrap().unwrap(),
        None => tokio::time::timeout(Duration::from_secs(5), opening)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
    };
    let availability = live.state.lock().unwrap().sources["session"]
        .published
        .as_ref()
        .unwrap()
        .availability
        .permissions;
    live.close();
    drop(subscription);
    drop(live);
    drop(service);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
    drop(_environment);
    assert!(
        !returned_early,
        "bootstrap returned while its source was still installing"
    );
    assert_eq!(availability, AttentionFacet::Available);
}
