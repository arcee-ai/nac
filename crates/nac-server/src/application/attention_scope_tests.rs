//! Real dormant question + owned persistence + canonical scope writes + SSE.
use super::*;
use crate::tests::{seed_direct_session, ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode},
    response::Response,
    Json, Router,
};
use futures_core::Stream;
use nac_core::{sessions, store};
use std::{
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

type EventBody = Pin<Box<dyn Stream<Item = std::result::Result<Bytes, axum::Error>> + Send>>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Change {
    Config,
    Assign,
    Delete,
}
struct Fixture {
    root: std::path::PathBuf,
    manager: SessionManager,
    app: Router,
    body: Option<EventBody>,
    question: store::QuestionRecord,
    project: Option<String>,
    provider: tokio::task::JoinHandle<()>,
    calls: Arc<AtomicUsize>,
    _env: ScopedModelEnv,
}
async fn request(app: Router, method: &str, uri: &str, body: serde_json::Value) -> Response {
    app.oneshot(
        Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}
async fn json(response: Response) -> serde_json::Value {
    serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap()
}
async fn frame(body: &mut EventBody) -> serde_json::Value {
    let bytes = std::future::poll_fn(|cx| body.as_mut().poll_next(cx))
        .await
        .unwrap()
        .unwrap();
    serde_json::from_str(
        std::str::from_utf8(&bytes)
            .unwrap()
            .lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap(),
    )
    .unwrap()
}
impl Fixture {
    async fn new(change: Change) -> Self {
        let root = std::env::temp_dir().join(format!("nac-attention-scope-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let env = ScopedModelEnv::isolated(&root.join("home"), Some("scope-test-key"));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&calls);
        let provider = tokio::spawn(async move {
            axum::serve(listener,Router::new().route("/responses",axum::routing::post(move || {let observed=Arc::clone(&observed);async move {
            assert_eq!(observed.fetch_add(1,Ordering::SeqCst),0,"observation/scope change must not start work");
            Json(serde_json::json!({"status":"completed","output":[{"type":"function_call","call_id":"scope","name":"request_question","arguments":serde_json::json!({"request_id":"scope-question","text":"Private fixture question","choices":[],"responder_class":"human_decision"}).to_string()}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}))
        }}))).await.unwrap();
        });
        seed_direct_session(&root, "session");
        let path = root.join("store.db");
        let mut snapshot = sessions::load_session(&path, "session").unwrap();
        snapshot.base_url = base;
        sessions::update_session_config(&path, &snapshot).unwrap();
        let options = || crate::ServerOptions {
            root_cwd: root.clone(),
            store_path: Some(path.clone()),
            worker_executable: None,
            managed_host: None,
        };
        let producer = SessionManager::new_async(options()).await.unwrap();
        let producing = crate::router(producer.clone());
        let project = if change != Change::Config {
            let response = request(
                producing.clone(),
                "POST",
                "/projects",
                serde_json::json!({"cwd":root}),
            )
            .await;
            assert_eq!(response.status(), StatusCode::CREATED);
            Some(
                json(response).await["project_id"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
            )
        } else {
            None
        };
        if change == Change::Delete {
            let response = request(
                producing.clone(),
                "POST",
                &format!("/projects/{}/sessions", project.as_ref().unwrap()),
                serde_json::json!({"session_id":"session"}),
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
        }
        let response = request(
            producing.clone(),
            "POST",
            "/sessions/session/runs",
            serde_json::json!({"prompt":"Ask a human question"}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let service = producer.inner.active_sessions.read().await["session"].clone();
        tokio::time::timeout(Duration::from_secs(5), async {
            while service.has_active_operation() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let question = store::list_task_questions(&path, "session")
            .unwrap()
            .remove(0);
        assert_eq!(question.status, "pending");
        drop(service);
        drop(producing);
        producer.quiesce_persistence_callers().await;
        producer.drain_persistence().await.unwrap();
        drop(producer);
        let manager = SessionManager::new_async(options()).await.unwrap();
        let app = crate::router(manager.clone());
        assert!(manager.inner.active_sessions.read().await.is_empty());
        Self {
            root,
            manager,
            app,
            body: None,
            question,
            project,
            provider,
            calls,
            _env: env,
        }
    }
    fn enable(&self) {
        self.manager
            .inner
            .attention
            .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    }
    async fn open(&mut self) {
        self.enable();
        let response = self
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/attention/events")
                    .header("host", "127.0.0.1:12345")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        self.body = Some(Box::pin(response.into_body().into_data_stream()));
        let baseline = frame(self.body.as_mut().unwrap()).await;
        assert_eq!(baseline["kind"], "baseline");
        assert_eq!(
            baseline["sources"][0]["pending"][0]["request_id"],
            self.question.request.request_id
        );
        assert!(self.manager.inner.active_sessions.read().await.is_empty());
    }
    async fn change(&self, change: Change) -> Response {
        match change {
            Change::Config => {
                request(
                    self.app.clone(),
                    "PATCH",
                    "/sessions/session/config",
                    serde_json::json!({"orchestrator_compaction_threshold":64000}),
                )
                .await
            }
            Change::Assign => self.assign("session").await,
            Change::Delete => {
                request(
                    self.app.clone(),
                    "DELETE",
                    &format!("/projects/{}", self.project.as_ref().unwrap()),
                    serde_json::json!({}),
                )
                .await
            }
        }
    }
    async fn assign(&self, session: &str) -> Response {
        request(
            self.app.clone(),
            "POST",
            &format!("/projects/{}/sessions", self.project.as_ref().unwrap()),
            serde_json::json!({"session_id":session}),
        )
        .await
    }
    fn question_pending(&self) -> bool {
        store::read_attention_metadata(&self.root.join("store.db"), Some("session")).unwrap()[0]
            .question
            .is_some()
    }
    async fn quiet(&mut self) {
        assert!(tokio::time::timeout(
            Duration::from_millis(40),
            frame(self.body.as_mut().unwrap())
        )
        .await
        .is_err());
    }
    async fn close(self) {
        let Self {
            root,
            manager,
            app,
            body,
            provider,
            calls,
            _env,
            ..
        } = self;
        drop(body);
        drop(app);
        manager.quiesce_persistence_callers().await;
        manager.drain_persistence().await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        drop(manager);
        provider.abort();
        let _ = provider.await;
        std::fs::remove_dir_all(root).unwrap();
        drop(_env);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn owned_dormant_questions_resolve_after_scope_commits_but_not_rollback_or_retry() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for change in [Change::Config, Change::Assign, Change::Delete] {
        let mut f = Fixture::new(change).await;
        f.open().await;
        let unchanged = request(
            f.app.clone(),
            "PATCH",
            "/sessions/session/config",
            serde_json::json!({}),
        )
        .await;
        assert_eq!(unchanged.status(), StatusCode::OK);
        assert!(f.question_pending());
        f.quiet().await;
        let sql = rusqlite::Connection::open(f.root.join("store.db")).unwrap();
        sql.execute_batch("CREATE TRIGGER rollback_scope AFTER UPDATE ON task_questions WHEN NEW.status='cancelled' BEGIN SELECT RAISE(ABORT,'scope rollback fixture'); END;").unwrap();
        assert_eq!(
            f.change(change).await.status(),
            StatusCode::INTERNAL_SERVER_ERROR,
            "{change:?}"
        );
        assert!(f.question_pending());
        f.quiet().await;
        sql.execute_batch("DROP TRIGGER rollback_scope").unwrap();
        drop(sql);
        let lost_response = f.change(change).await;
        assert_eq!(lost_response.status(), StatusCode::OK, "{change:?}");
        drop(lost_response);
        let resolved =
            tokio::time::timeout(Duration::from_secs(5), frame(f.body.as_mut().unwrap()))
                .await
                .unwrap();
        assert_eq!(
            resolved["change"]["kind"], "decision_resolved",
            "{resolved}"
        );
        assert_eq!(
            resolved["change"]["decision"]["request_id"],
            f.question.request.request_id
        );
        assert_eq!(resolved["new_attention"], false);
        assert!(!f.question_pending());
        let retry = f.change(change).await;
        assert_eq!(
            retry.status(),
            match change {
                Change::Config => StatusCode::OK,
                Change::Assign => StatusCode::CONFLICT,
                Change::Delete => StatusCode::NOT_FOUND,
            }
        );
        f.quiet().await;
        assert!(f.manager.inner.active_sessions.read().await.is_empty());
        f.close().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn owned_scope_mutations_have_the_same_outcomes_without_an_observer() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for change in [Change::Config, Change::Assign, Change::Delete] {
        let f = Fixture::new(change).await;
        assert!(f.manager.inner.attention.authority().is_none());
        assert_eq!(f.change(change).await.status(), StatusCode::OK);
        assert!(!f.question_pending());
        assert!(f.manager.inner.active_sessions.read().await.is_empty());
        f.close().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scope_commit_after_a_captured_baseline_cannot_reintroduce_a_stale_question() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let f = Fixture::new(Change::Config).await;
    f.enable();
    let (release, receive) = std::sync::mpsc::channel();
    let gate = Arc::new(ReadGate {
        reached: Notify::new(),
        release: Mutex::new(receive),
    });
    f.manager.inner.attention.0.lock().unwrap().after_read_gate = Some(Arc::clone(&gate));
    let app = f.app.clone();
    let opening = tokio::spawn(async move {
        app.oneshot(
            Request::builder()
                .uri("/attention/events")
                .header("host", "127.0.0.1:12345")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
    });
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    assert_eq!(f.change(Change::Config).await.status(), StatusCode::OK);
    release.send(()).unwrap();
    let response = opening.await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let mut body: EventBody = Box::pin(response.into_body().into_data_stream());
    let baseline = frame(&mut body).await;
    assert_eq!(baseline["sources"][0]["pending"], serde_json::json!([]));
    drop(body);
    f.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scope_commit_during_actual_service_handoff_resolves_the_old_identity_once() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let mut f = Fixture::new(Change::Config).await;
    f.open().await;
    let (release, receive) = std::sync::mpsc::channel();
    let gate = Arc::new(ReadGate {
        reached: Notify::new(),
        release: Mutex::new(receive),
    });
    f.manager.inner.attention.0.lock().unwrap().after_read_gate = Some(Arc::clone(&gate));
    let service = f
        .manager
        .session_attachment()
        .attach_question_target("session")
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    assert_eq!(f.change(Change::Config).await.status(), StatusCode::OK);
    release.send(()).unwrap();
    let handoff = tokio::time::timeout(Duration::from_secs(5), frame(f.body.as_mut().unwrap()))
        .await
        .unwrap();
    assert_eq!(handoff["change"]["kind"], "source_replaced");
    assert_eq!(handoff["new_attention"], false);
    let resolved = frame(f.body.as_mut().unwrap()).await;
    assert_eq!(resolved["change"]["kind"], "decision_resolved");
    assert_eq!(
        resolved["change"]["decision"]["request_id"],
        f.question.request.request_id
    );
    f.quiet().await;
    drop(service);
    f.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scope_hint_overflow_retires_observation_without_changing_a_committed_assignment() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let mut f = Fixture::new(Change::Assign).await;
    f.manager.inner.attention.0.lock().unwrap().limits = Some(AttentionLimits {
        sources: 1,
        ..Default::default()
    });
    f.open().await;
    seed_direct_session(&f.root, "extra");
    assert_eq!(f.assign("extra").await.status(), StatusCode::OK);
    let reset = tokio::time::timeout(Duration::from_secs(5), frame(f.body.as_mut().unwrap()))
        .await
        .unwrap();
    assert_eq!(reset["kind"], "reset");
    assert!(f.question_pending());
    assert_eq!(
        sessions::load_session_summary(&f.root.join("store.db"), "extra")
            .unwrap()
            .unwrap()
            .project_id,
        f.project
    );
    f.close().await;
}
