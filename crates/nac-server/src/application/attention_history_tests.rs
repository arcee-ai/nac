//! Actual-owner transport timing controls, not model/native qualification.
use super::*;
use crate::tests::{seed_direct_session, ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use axum::{
    body::{Body, Bytes},
    http::Request,
};
use futures_core::Stream;
use nac_core::{sessions, store, types::Message};
use std::{path::PathBuf, pin::Pin, sync::mpsc};
use tower::ServiceExt;

type Feed = Pin<Box<dyn Stream<Item = std::result::Result<Bytes, axum::Error>> + Send>>;
struct Fixture {
    manager: SessionManager,
    root: PathBuf,
    _env: ScopedModelEnv,
}
impl Fixture {
    async fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-history-wake-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
        store::initialize(&root.join("store.db")).unwrap();
        seed_direct_session(&root, "session");
        let manager = SessionManager::new_async(crate::ServerOptions {
            root_cwd: root.clone(),
            store_path: Some(root.join("store.db")),
            worker_executable: None,
            managed_host: None,
        })
        .await
        .unwrap();
        manager
            .inner
            .attention
            .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
        Self {
            manager,
            root,
            _env: env,
        }
    }
    async fn body(manager: SessionManager) -> Feed {
        let response = crate::router(manager)
            .oneshot(
                Request::builder()
                    .uri("/attention/events")
                    .header("host", "127.0.0.1:12345")
                    .header("x-nac-completion-cursor", "new")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        Box::pin(response.into_body().into_data_stream())
    }
    async fn open(&self) -> Feed {
        let mut feed = Self::body(self.manager.clone()).await;
        assert_eq!(frame(&mut feed).await["kind"], "completions");
        assert_eq!(frame(&mut feed).await["kind"], "baseline");
        feed
    }
    fn live(&self) -> Arc<Live> {
        self.manager
            .inner
            .attention
            .0
            .lock()
            .unwrap()
            .live
            .upgrade()
            .unwrap()
    }
    fn wait_gate(&self) -> (Arc<HistoryWaitGate>, tokio::sync::oneshot::Sender<()>) {
        let (send, receive) = tokio::sync::oneshot::channel();
        let gate = Arc::new(HistoryWaitGate {
            reached: Notify::new(),
            resume: Mutex::new(Some(receive)),
        });
        self.manager
            .inner
            .attention
            .0
            .lock()
            .unwrap()
            .history_wait_gate = Some(gate.clone());
        (gate, send)
    }
    fn read_gate(&self) -> (Arc<ReadGate>, mpsc::Sender<()>) {
        let (send, receive) = mpsc::channel();
        let gate = Arc::new(ReadGate {
            reached: Notify::new(),
            release: Mutex::new(receive),
        });
        self.manager
            .inner
            .attention
            .0
            .lock()
            .unwrap()
            .history_read_gate = Some(gate.clone());
        (gate, send)
    }
    async fn commit(&self, run: &str, index: u64) {
        let path = self.root.join("store.db");
        let run = run.to_owned();
        store::spawn_blocking_store_caller(move || {
            store::TranscriptLogWriter::new(&path)
                .unwrap()
                .append_run_prompt(
                    "session",
                    index,
                    &Message::User {
                        content: "transport only".into(),
                    },
                    &run,
                )
                .unwrap();
            sessions::save_session_run_state(
                &path,
                &sessions::SessionRunStateUpdate {
                    session_id: "session".into(),
                    ssh: None,
                    sandbox_spec: None,
                    run_state: Default::default(),
                    finished_run_id: Some(run.clone()),
                    finished_run_disposition: Some(store::RunTerminalDisposition::Completed),
                    failed_run_id: None,
                    failed_run_failure: None,
                    goal_settlement: None,
                    heartbeat_settlement: None,
                    finished_run_result: Some("transport result".into()),
                    updated_at: "now".into(),
                },
            )
            .unwrap();
            let page = store::read_completion_page(
                &path,
                Some(&store::CompletionCursor {
                    store: store::read_completion_page(&path, None)
                        .unwrap()
                        .cursor
                        .store,
                    sequence: 0,
                }),
            )
            .unwrap();
            assert!(page.items.iter().any(|item| item.run_id == run));
            eprintln!(
                "history-wake-canonical {}",
                serde_json::json!({"run":run,"page":page})
            );
        })
        .await
        .unwrap();
    }
    fn counts(&self) -> (usize, usize) {
        let state = self.manager.inner.attention.0.lock().unwrap();
        (state.history_reads, state.history_waits)
    }
    async fn finish(self) {
        self.manager.inner.attention.stop();
        self.manager.quiesce_persistence_callers().await;
        self.manager.drain_persistence().await.unwrap();
        drop(self.manager);
        std::fs::remove_dir_all(self.root).unwrap();
    }
}
async fn frame(feed: &mut Feed) -> serde_json::Value {
    let bytes = std::future::poll_fn(|cx| feed.as_mut().poll_next(cx))
        .await
        .unwrap()
        .unwrap();
    let text = std::str::from_utf8(&bytes).unwrap();
    serde_json::from_str(
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap(),
    )
    .unwrap()
}
fn reading(mut feed: Feed) -> JoinHandle<(Feed, serde_json::Value)> {
    tokio::spawn(async move {
        let value = frame(&mut feed).await;
        (feed, value)
    })
}
async fn reached(notify: &Notify) {
    tokio::time::timeout(Duration::from_secs(5), notify.notified())
        .await
        .unwrap();
}
async fn dirty_after(live: &Live, before: u64) {
    tokio::time::timeout(Duration::from_secs(1), async {
        while live.state.lock().unwrap().generation <= before {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
async fn result(mut task: JoinHandle<(Feed, serde_json::Value)>) -> Option<serde_json::Value> {
    match tokio::time::timeout(Duration::from_secs(1), &mut task).await {
        Ok(value) => {
            let (feed, value) = value.unwrap();
            drop(feed);
            Some(value)
        }
        Err(_) => {
            task.abort();
            let _ = task.await;
            None
        }
    }
}
fn exact(value: Option<serde_json::Value>, run: &str, marker: &str) {
    assert!(
        value.is_some(),
        "{marker}: committed row did not wake the original quiet stream"
    );
    let value = value.unwrap();
    assert_eq!(value["kind"], "completions");
    assert_eq!(value["page"]["items"][0]["run_id"], run);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn history_wake_quiet_wait_finds_committed_row() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let f = Fixture::new().await;
    let feed = f.open().await;
    let live = f.live();
    let boundary = live.hub.boundary();
    let generation = live.state.lock().unwrap().generation;
    let (gate, release) = f.wait_gate();
    let mut task = reading(feed);
    reached(&gate.reached).await;
    release.send(()).unwrap();
    assert!(tokio::time::timeout(Duration::from_millis(30), &mut task)
        .await
        .is_err());
    let counts = f.counts();
    f.commit("quiet-A", 0).await;
    dirty_after(&live, generation).await;
    assert_eq!(live.hub.boundary(), boundary);
    let value = result(task).await;
    drop(live);
    f.finish().await;
    eprintln!("history-wake-wait-entry {counts:?}");
    exact(value, "quiet-A", "S4_QUIET_WAKE_EXPECTED");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn history_wake_old_empty_read_retains_during_read_dirty() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let f = Fixture::new().await;
    let feed = f.open().await;
    let live = f.live();
    let generation = live.state.lock().unwrap().generation;
    let (gate, release) = f.read_gate();
    let task = reading(feed);
    reached(&gate.reached).await;
    f.commit("during-read-A", 0).await;
    dirty_after(&live, generation).await;
    release.send(()).unwrap();
    let value = result(task).await;
    drop(live);
    f.finish().await;
    exact(value, "during-read-A", "S4_DURING_READ_EXPECTED");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn history_wake_read_to_wait_gap_retains_dirty() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let f = Fixture::new().await;
    let feed = f.open().await;
    let live = f.live();
    let generation = live.state.lock().unwrap().generation;
    let (gate, release) = f.wait_gate();
    let task = reading(feed);
    reached(&gate.reached).await;
    f.commit("before-wait-A", 0).await;
    dirty_after(&live, generation).await;
    release.send(()).unwrap();
    let value = result(task).await;
    drop(live);
    f.finish().await;
    exact(value, "before-wait-A", "S4_WAIT_GAP_EXPECTED");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn history_wake_coalescing_and_spurious_hints_return_to_pending() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let f = Fixture::new().await;
    let feed = f.open().await;
    let live = f.live();
    let (gate, release) = f.wait_gate();
    let task = reading(feed);
    reached(&gate.reached).await;
    let reads = f.counts().0;
    for i in 0..3 {
        f.commit(&format!("burst-{i}"), i).await;
    }
    dirty_after(&live, 0).await;
    release.send(()).unwrap();
    let (feed, page) = tokio::time::timeout(Duration::from_secs(1), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(page["page"]["items"].as_array().unwrap().len(), 3);
    assert_eq!(f.counts().0, reads + 1);
    drop(feed);
    drop(live);
    f.finish().await;
    // Isolate spurious ingress from any delayed terminal hints in the burst.
    let f = Fixture::new().await;
    let feed = f.open().await;
    let live = f.live();
    let (gate, release) = f.wait_gate();
    let mut task = reading(feed);
    reached(&gate.reached).await;
    let (reads, waits) = f.counts();
    {
        let mut state = live.state.lock().unwrap();
        for _ in 0..3 {
            live.dirty(&mut state, "session");
        }
    }
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(1), async {
        while f.counts().1 == waits {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(tokio::time::timeout(Duration::from_millis(30), &mut task)
        .await
        .is_err());
    assert_eq!(f.counts().0, reads + 1);
    task.abort();
    let _ = task.await;
    drop(live);
    f.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn history_wake_initial_cutoff_registration_and_snapshot_races() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for during_snapshot in [false, true] {
        let f = Fixture::new().await;
        f.commit("cutoff-A", 0).await;
        let mut read_release = None;
        let mut bootstrap = None;
        let gate = if during_snapshot {
            let (gate, release) = f.read_gate();
            read_release = Some(release);
            Some(gate)
        } else {
            let gate = Arc::new(BootstrapGate::default());
            f.manager.inner.attention.0.lock().unwrap().bootstrap_gate = Some(gate.clone());
            bootstrap = Some(gate);
            None
        };
        let opening = tokio::spawn(Fixture::body(f.manager.clone()));
        if let Some(gate) = &gate {
            reached(&gate.reached).await;
        } else {
            reached(&bootstrap.as_ref().unwrap().reached).await;
        }
        f.commit("cutoff-B", 1).await;
        if let Some(release) = read_release {
            release.send(()).unwrap();
        } else {
            bootstrap.unwrap().resume.notify_one();
        }
        let mut feed = opening.await.unwrap();
        let cutoff = frame(&mut feed).await;
        assert_eq!(
            cutoff["page"]["cursor"],
            if during_snapshot { 1 } else { 2 }
        );
        assert!(cutoff["page"]["items"].as_array().unwrap().is_empty());
        assert_eq!(frame(&mut feed).await["kind"], "baseline");
        if during_snapshot {
            assert_eq!(
                frame(&mut feed).await["page"]["items"][0]["run_id"],
                "cutoff-B"
            );
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(30), frame(&mut feed))
                .await
                .is_err()
        );
        drop(feed);
        f.finish().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn history_wake_reset_beats_dirty_and_unemitted_history() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let f = Fixture::new().await;
    let feed = f.open().await;
    let (gate, release) = f.read_gate();
    let task = reading(feed);
    reached(&gate.reached).await;
    f.commit("retired-A", 0).await;
    f.manager.inner.attention.stop();
    release.send(()).unwrap();
    let (mut feed, value) = task.await.unwrap();
    assert_eq!(value["kind"], "reset");
    assert!(std::future::poll_fn(|cx| feed.as_mut().poll_next(cx))
        .await
        .is_none());
    drop(feed);
    f.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn history_wake_cancelled_accepted_read_retains_seat_until_actual_return() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let f = Fixture::new().await;
    let feed = f.open().await;
    let (gate, release) = f.read_gate();
    let task = reading(feed);
    reached(&gate.reached).await;
    f.commit("cancelled-reader-A", 0).await;
    task.abort();
    let _ = task.await;
    assert!(matches!(
        f.manager
            .inner
            .attention
            .open(f.manager.clone(), None)
            .await,
        Err(AttentionSubscribeError::Busy)
    ));
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(1), async {
        while f.manager.inner.attention.0.lock().unwrap().seat.is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let mut successor = f.open().await;
    assert!(
        tokio::time::timeout(Duration::from_millis(30), frame(&mut successor))
            .await
            .is_err()
    );
    drop(successor);
    f.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn history_wake_current_reset_wins_and_watch_closure_is_terminal() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let f = Fixture::new().await;
    let mut observer = f
        .manager
        .inner
        .attention
        .open(f.manager.clone(), None)
        .await
        .unwrap();
    let live = f.live();
    {
        let mut state = live.state.lock().unwrap();
        live.dirty(&mut state, "session");
    }
    live.close();
    assert!(matches!(
        observer.next_activity().await,
        NativeAttentionActivity::Current(AttentionRead::Reset(_))
    ));
    drop(observer);
    drop(live);
    f.finish().await;

    let f = Fixture::new().await;
    let mut observer = f
        .manager
        .inner
        .attention
        .open(f.manager.clone(), None)
        .await
        .unwrap();
    // Exercise the private port's channel-error branch on the actual owner;
    // normal Live retirement uses the reset/terminal path just asserted above.
    let (sender, receiver) = watch::channel(Some(0));
    observer.history = receiver;
    drop(sender);
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(1), observer.next_activity())
            .await
            .unwrap(),
        NativeAttentionActivity::Current(AttentionRead::Closed)
    ));
    drop(observer);
    f.finish().await;
}
