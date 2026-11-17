//! Actual model Ask -> real broker -> browser fleet snapshot/streams, beside an
//! unchanged native observer; headless fail-closed with only fleet observers.
use crate::tests::{seed_direct_session, ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use crate::SessionManager;
use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode},
    response::IntoResponse,
    Json, Router,
};
use futures_core::Stream;
use nac_core::sessions;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tower::ServiceExt;
use uuid::Uuid;

type BodyStream = Pin<Box<dyn Stream<Item = Result<Bytes, axum::Error>> + Send>>;

struct Frames {
    body: BodyStream,
    buffer: String,
}
impl Frames {
    fn new(response: axum::response::Response) -> Self {
        Self {
            body: Box::pin(response.into_body().into_data_stream()),
            buffer: String::new(),
        }
    }
    async fn next(&mut self) -> serde_json::Value {
        loop {
            if let Some(end) = self.buffer.find("\n\n") {
                let chunk: String = self.buffer.drain(..end + 2).collect();
                if let Some(data) = chunk.lines().find_map(|line| line.strip_prefix("data: ")) {
                    return serde_json::from_str(data).unwrap();
                }
                continue;
            }
            let bytes = tokio::time::timeout(
                Duration::from_secs(10),
                std::future::poll_fn(|cx| self.body.as_mut().poll_next(cx)),
            )
            .await
            .expect("attention frame")
            .expect("open stream")
            .unwrap();
            self.buffer.push_str(std::str::from_utf8(&bytes).unwrap());
        }
    }
}

type Sessions = BTreeMap<String, serde_json::Value>;

/// Apply frames to a session map until `done` holds; returns frames seen.
async fn until(
    frames: &mut Frames,
    state: &mut Sessions,
    mut done: impl FnMut(&Sessions) -> bool,
) -> Vec<serde_json::Value> {
    let mut seen = Vec::new();
    while !done(state) {
        let frame = frames.next().await;
        match frame["kind"].as_str().unwrap() {
            "snapshot" => {
                state.clear();
                for session in frame["sessions"].as_array().unwrap() {
                    state.insert(
                        session["session_id"].as_str().unwrap().into(),
                        session.clone(),
                    );
                }
            }
            "changes" => {
                for session in frame["upserts"].as_array().unwrap() {
                    state.insert(
                        session["session_id"].as_str().unwrap().into(),
                        session.clone(),
                    );
                }
                for id in frame["removed"].as_array().unwrap() {
                    state.remove(id.as_str().unwrap());
                }
            }
            other => panic!("unexpected frame {other}: {frame}"),
        }
        seen.push(frame);
    }
    seen
}

fn get(path: &str, host: &str) -> Request<Body> {
    Request::builder()
        .uri(path)
        .header("host", host)
        .body(Body::empty())
        .unwrap()
}

async fn open(app: &Router, path: &str) -> Frames {
    let response = app.clone().oneshot(get(path, "localhost")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    Frames::new(response)
}

async fn json(app: &Router, path: &str) -> serde_json::Value {
    let response = app.clone().oneshot(get(path, "localhost")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap(),
    )
    .unwrap()
}

fn session(snapshot: &serde_json::Value, id: &str) -> serde_json::Value {
    snapshot["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|session| session["session_id"] == id)
        .cloned()
        .unwrap()
}

fn pending_permissions(session: Option<&serde_json::Value>) -> Vec<String> {
    session
        .and_then(|session| session["pending"].as_array())
        .into_iter()
        .flatten()
        .filter(|decision| decision["kind"] == "permission")
        .map(|decision| decision["request_id"].as_str().unwrap().to_owned())
        .collect()
}

struct Fixture {
    root: PathBuf,
    manager: SessionManager,
    app: Router,
    requests: Arc<Mutex<Vec<serde_json::Value>>>,
    calls: Arc<AtomicUsize>,
    provider: tokio::task::JoinHandle<()>,
    _env: ScopedModelEnv,
}

async fn fixture() -> Fixture {
    let root = std::env::temp_dir().join(format!("nac-fleet-attention-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let calls = Arc::new(AtomicUsize::new(0));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let (observed, recorded) = (calls.clone(), requests.clone());
    let route = axum::routing::post(move |Json(request): Json<serde_json::Value>| {
        let (calls, requests) = (observed.clone(), recorded.clone());
        async move {
            let index = calls.fetch_add(1, Ordering::SeqCst);
            let stream = request["stream"] == true;
            requests.lock().unwrap().push(request);
            let item = match index {
                0 => {
                    serde_json::json!({"type":"function_call","call_id":"fleet-ask","name":"exec_command","arguments":serde_json::json!({"cmd":"pwd"}).to_string()})
                }
                1 => {
                    serde_json::json!({"type":"message","content":[{"type":"output_text","text":"done"}]})
                }
                _ => panic!("unexpected provider call {index}"),
            };
            let response = serde_json::json!({"status":"completed","output":[item],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}});
            if stream {
                let event = serde_json::json!({"type":"response.completed","response":response});
                (
                    [("content-type", "text/event-stream")],
                    format!("data: {event}\n\n"),
                )
                    .into_response()
            } else {
                Json(response).into_response()
            }
        }
    });
    let provider = tokio::spawn(async move {
        axum::serve(listener, Router::new().route("/responses", route))
            .await
            .unwrap();
    });
    seed_direct_session(&root, "session");
    seed_direct_session(&root, "dormant");
    seed_direct_session(&root, "child");
    let path = root.join("store.db");
    let mut snapshot = sessions::load_session(&path, "session").unwrap();
    snapshot.base_url = base;
    sessions::update_session_config(&path, &snapshot).unwrap();
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute(
            "INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,created_at,updated_at)
             VALUES('child','session','session','general','private child description',1,'idle',0,'now','now')",
            [],
        )
        .unwrap();
    let manager = SessionManager::new_async(crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let app = crate::router(manager.clone());
    Fixture {
        root,
        manager,
        app,
        requests,
        calls,
        provider,
        _env: env,
    }
}

impl Fixture {
    async fn post(&self, path: &str, body: &'static str) -> StatusCode {
        self.app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("host", "localhost")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
    }

    async fn submit(&self) {
        assert_eq!(
            self.post("/sessions/session/runs", r#"{"prompt":"run the command"}"#)
                .await,
            StatusCode::ACCEPTED
        );
    }

    async fn finish(self) {
        self.manager.quiesce_persistence_callers().await;
        self.manager.drain_persistence().await.unwrap();
        drop(self.app);
        drop(self.manager);
        self.provider.abort();
        let _ = self.provider.await;
        std::fs::remove_dir_all(self.root).unwrap();
    }
}

fn settled(state: &Sessions) -> bool {
    state.get("session").is_some_and(|session| {
        pending_permissions(Some(session)).is_empty()
            && session["last_outcome"]["disposition"] == "completed"
            && session["activity"]["kind"] == "idle"
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_pending_permission_reaches_every_browser_stream_and_resolves_beside_native() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = fixture().await;
    let (app, manager) = (fixture.app.clone(), fixture.manager.clone());
    manager
        .inner
        .attention
        .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    let native = app
        .clone()
        .oneshot(get("/attention/events", "127.0.0.1:12345"))
        .await
        .unwrap();
    assert_eq!(native.status(), StatusCode::OK);
    let mut native = Frames::new(native);
    assert_eq!(native.next().await["kind"], "baseline");

    let service = manager.attach_session("session").await.unwrap();
    let interactive = service.subscribe_events_for_client_with_replay(
        nac_core::events::SessionClientId::new(),
        None,
        32,
    );
    let mut first = open(&app, "/attention/stream").await;
    let mut second = open(&app, "/attention/stream").await;
    assert_eq!(manager.inner.fleet_attention.stream_count(), 2);
    // Browser streams never take or share the single native seat.
    let busy = app
        .clone()
        .oneshot(get("/attention/events", "127.0.0.1:12345"))
        .await
        .unwrap();
    assert_eq!(busy.status(), StatusCode::CONFLICT);

    let (mut one, mut two) = (Sessions::new(), Sessions::new());
    until(&mut first, &mut one, |state| state.len() == 3).await;
    until(&mut second, &mut two, |state| state.len() == 3).await;
    let baseline = json(&app, "/attention").await;
    // Unknown and unsupported are reported, never collapsed into "none".
    assert_eq!(
        session(&baseline, "session")["availability"]["permissions"],
        "available"
    );
    assert_eq!(
        session(&baseline, "session")["availability"]["work"],
        "unknown"
    );
    assert_eq!(session(&baseline, "session")["activity"]["kind"], "idle");
    let dormant = session(&baseline, "dormant");
    assert_eq!(dormant["availability"]["permissions"], "unknown");
    assert_eq!(dormant["availability"]["reviews"], "unknown");
    assert_eq!(dormant["activity"]["kind"], "unknown");
    let child = session(&baseline, "child");
    assert_eq!(child["availability"]["permissions"], "unsupported");
    assert_eq!(child["lineage"]["kind"], "traditional-child");
    assert_eq!(child["lineage"]["parent_session_id"], "session");
    assert_eq!(child["lineage"]["root_session_id"], "session");
    assert!(session(&baseline, "dormant")["lineage"].is_null());
    assert!(!baseline.to_string().contains("private child description"));

    fixture.submit().await;
    let has_pending = |state: &Sessions| !pending_permissions(state.get("session")).is_empty();
    let frames = until(&mut first, &mut one, has_pending).await;
    until(&mut second, &mut two, has_pending).await;
    let exact = service.list_permission_requests().unwrap()[0].id.clone();
    assert_eq!(pending_permissions(one.get("session")), vec![exact.clone()]);
    assert_eq!(pending_permissions(two.get("session")), vec![exact.clone()]);
    assert_eq!(one["session"]["activity"]["kind"], "run");
    let text = serde_json::to_string(&frames).unwrap();
    for secret in ["pwd", "exec_command", "run the command"] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }
    let current = json(&app, "/attention").await;
    assert_eq!(
        pending_permissions(Some(&session(&current, "session"))),
        vec![exact.clone()]
    );
    // The native observer sees the same identity from the same classification.
    loop {
        let frame = native.next().await;
        if frame["change"]["kind"] == "decision_pending" {
            assert_eq!(frame["change"]["decision"]["request_id"], exact);
            break;
        }
    }

    let target = format!("/sessions/session/permissions/{exact}");
    assert_eq!(
        fixture.post(&target, r#"{"reply":"reject"}"#).await,
        StatusCode::NO_CONTENT
    );
    // The resolved identity disappears; the durable outcome follows settlement.
    until(&mut first, &mut one, settled).await;
    until(&mut second, &mut two, settled).await;
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 2);
    loop {
        let frame = native.next().await;
        assert_ne!(frame["kind"], "reset", "{frame}");
        if frame["change"]["kind"] == "decision_resolved" {
            assert_eq!(frame["change"]["decision"]["request_id"], exact);
            break;
        }
    }
    let filtered = json(&app, "/attention?project_id=missing").await;
    assert_eq!(filtered["sessions"], serde_json::json!([]));

    drop(first);
    drop(second);
    tokio::time::timeout(Duration::from_secs(5), async {
        while manager.inner.fleet_attention.refresher_running() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("refresher retires with its last stream");
    assert_eq!(manager.inner.fleet_attention.stream_count(), 0);
    drop(native);
    manager.inner.attention.stop();
    drop(interactive);
    drop(service);
    drop(manager);
    fixture.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn headless_ask_with_only_fleet_attention_observers_still_fails_closed() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = fixture().await;
    let (app, manager) = (fixture.app.clone(), fixture.manager.clone());
    let mut first = open(&app, "/attention/stream").await;
    let _second = open(&app, "/attention/stream").await;
    let mut state = Sessions::new();
    until(&mut first, &mut state, |state| state.len() == 3).await;
    let service = manager.attach_session("session").await.unwrap();
    fixture.submit().await;
    // No session event subscriber: the Ask is denied before it is ever pending,
    // exactly as without any attention observer.
    let frames = until(&mut first, &mut state, |state| {
        settled(state) && state["session"]["last_outcome"]["run_id"].is_string()
    })
    .await;
    for frame in &frames {
        assert!(!frame.to_string().contains("\"permission\""), "{frame}");
    }
    assert!(service.list_permission_requests().unwrap().is_empty());
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 2);
    let denial = fixture.requests.lock().unwrap()[1].to_string();
    assert!(
        denial.contains("no interactive session client is connected"),
        "{denial}"
    );
    drop(first);
    drop(service);
    drop(manager);
    fixture.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fleet_routes_keep_shared_web_guards_and_bound_concurrent_streams() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = fixture().await;
    let app = fixture.app.clone();
    for path in ["/attention", "/attention/stream"] {
        let response = app
            .clone()
            .oneshot(get(path, "evil.example"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{path}");
    }
    // The native route keeps its own exact-authority guard, unconfigured here.
    let native = app
        .clone()
        .oneshot(get("/attention/events", "localhost"))
        .await
        .unwrap();
    assert_eq!(native.status(), StatusCode::NOT_FOUND);
    let mut streams = Vec::new();
    for _ in 0..crate::application::fleet_attention::FLEET_ATTENTION_MAX_STREAMS {
        streams.push(open(&app, "/attention/stream").await);
    }
    let busy = app
        .clone()
        .oneshot(get("/attention/stream", "localhost"))
        .await
        .unwrap();
    assert_eq!(busy.status(), StatusCode::SERVICE_UNAVAILABLE);
    // Snapshots remain available as the polling fallback.
    let snapshot = json(&app, "/attention").await;
    assert_eq!(snapshot["sessions"].as_array().unwrap().len(), 3);
    drop(streams);
    fixture.finish().await;
}

#[test]
fn wire_entry_carries_exact_question_review_and_permission_identities_only() {
    use crate::application::fleet_attention::{FleetAttentionEntry, FleetAttentionFacts};
    use nac_core::events::{
        AttentionAvailability, AttentionDecision, AttentionFacet, AttentionOperation,
        AttentionSource, AttentionSourceSnapshot,
    };
    let entry = FleetAttentionEntry {
        revision: 7,
        facts: FleetAttentionFacts {
            project_id: Some("project".into()),
            lineage: None,
            attention: AttentionSourceSnapshot {
                source: AttentionSource {
                    session_id: "session".into(),
                    epoch: Uuid::new_v4(),
                },
                revision: 0,
                work: None,
                pending: vec![
                    AttentionDecision::Question {
                        request_id: "question-1".into(),
                        run_id: "run-1".into(),
                        generation: "generation-1".into(),
                        revision: 3,
                    },
                    AttentionDecision::Permission {
                        request_id: "permission-1".into(),
                    },
                    AttentionDecision::Review {
                        review_id: "review-1".into(),
                    },
                ],
                availability: AttentionAvailability {
                    work: AttentionFacet::Unknown,
                    questions: AttentionFacet::Available,
                    permissions: AttentionFacet::Available,
                    reviews: AttentionFacet::Available,
                    topology: AttentionFacet::Available,
                },
            },
            operation: Some(AttentionOperation::Run("run-1".into())),
            last_outcome: None,
            inbox_pending: true,
            recovery_pending: false,
        },
    };
    let wire =
        serde_json::to_value(super::FleetAttentionSessionDto::new("session", &entry)).unwrap();
    assert_eq!(
        wire,
        serde_json::json!({
            "session_id": "session",
            "revision": 7,
            "project_id": "project",
            "lineage": null,
            "pending": [
                {"kind": "question", "request_id": "question-1", "run_id": "run-1", "generation": "generation-1", "revision": 3},
                {"kind": "permission", "request_id": "permission-1"},
                {"kind": "review", "review_id": "review-1"},
            ],
            "work": null,
            "availability": {"work": "unknown", "questions": "available", "permissions": "available", "reviews": "available", "topology": "available"},
            "activity": {"kind": "run", "run_id": "run-1"},
            "last_outcome": null,
            "queued": true,
            "recovery_pending": false,
        })
    );
}
