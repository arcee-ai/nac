//! Actual model Ask -> real broker -> native SSE -> human reply -> idle eviction.
use super::*;
use crate::tests::{seed_direct_session, ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use axum::response::IntoResponse;
use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode},
    Json, Router,
};
use futures_core::Stream;
use std::{
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;
type BodyStream = Pin<Box<dyn Stream<Item = std::result::Result<Bytes, axum::Error>> + Send>>;
async fn frame(body: &mut BodyStream) -> serde_json::Value {
    let bytes = tokio::time::timeout(
        Duration::from_secs(5),
        std::future::poll_fn(|cx| body.as_mut().poll_next(cx)),
    )
    .await
    .unwrap()
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
async fn fact(body: &mut BodyStream, kind: &str) -> serde_json::Value {
    for _ in 0..20 {
        let value = frame(body).await;
        if value["change"]["kind"] == kind {
            return value;
        }
        assert_ne!(value["kind"], "reset", "{value}");
        if kind == "source_replaced" {
            assert_ne!(
                value["change"]["kind"], "decision_resolved",
                "owner loss must be unknown, not resolution"
            );
        }
    }
    panic!("missing {kind}");
}
async fn post(app: Router, path: &str, body: serde_json::Value) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}
async fn open(app: Router) -> BodyStream {
    let response = app
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
    Box::pin(response.into_body().into_data_stream())
}
#[derive(Clone, Copy)]
enum Journey {
    Permission,
    #[cfg(feature = "review-fixture")]
    ReviewRetry,
    #[cfg(feature = "review-fixture")]
    ReviewLost,
    Unavailable(AttentionUnavailable),
}
struct ReviewEnvironment(Option<std::ffi::OsString>);
impl Drop for ReviewEnvironment {
    fn drop(&mut self) {
        unsafe {
            match self.0.take() {
                Some(value) => std::env::set_var("NAC_REVIEW_FIXTURE", value),
                None => std::env::remove_var("NAC_REVIEW_FIXTURE"),
            }
        }
    }
}
async fn journey(mode: Journey) {
    #[cfg(not(feature = "review-fixture"))]
    let review = false;
    #[cfg(feature = "review-fixture")]
    let review = matches!(mode, Journey::ReviewRetry | Journey::ReviewLost);
    assert!(!review || cfg!(feature = "review-fixture"));
    let root = std::env::temp_dir().join(format!("nac-decision-feed-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let _review_env = ReviewEnvironment(std::env::var_os("NAC_REVIEW_FIXTURE"));
    if review {
        // Existing explicit test-build reviewer seam; no vendor connection.
        unsafe {
            std::env::set_var("ARCEE_API_KEY", "dummy-review-key");
            std::env::set_var(
                "NAC_REVIEW_FIXTURE",
                r#"{"reject_containing":["pwd"],"category":"out_of_scope"}"#,
            );
        }
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let provider = tokio::spawn(async move {
        axum::serve(listener, Router::new().route("/responses", axum::routing::post(move |Json(request): Json<serde_json::Value>| {
            let calls = observed.clone(); async move {
                let index = calls.fetch_add(1, Ordering::SeqCst);
                let item = match index {
                    0 => serde_json::json!({"type":"function_call","call_id":"actual-ask","name":"exec_command","arguments":serde_json::json!({"cmd":"pwd"}).to_string()}),
                    1 => serde_json::json!({"type":"message","content":[{"type":"output_text","text":"Rejected command was not executed"}]}),
                    _ => panic!("unexpected provider call {index}"),
                };
                let response = serde_json::json!({"status":"completed","output":[item],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}});
                if request["stream"] == true {
                    ([("content-type", "text/event-stream")], format!("data: {}\n\n", serde_json::json!({"type":"response.completed","response":response}))).into_response()
                } else { Json(response).into_response() }
            }
        }))).await.unwrap();
    });
    seed_direct_session(&root, "session");
    let path = root.join("store.db");
    let mut snapshot = nac_core::sessions::load_session(&path, "session").unwrap();
    snapshot.base_url = base;
    nac_core::sessions::update_session_config(&path, &snapshot).unwrap();
    let manager = SessionManager::new_async(crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    manager
        .inner
        .attention
        .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    let app = crate::router(manager.clone());
    // Explicit product attachment/client is separate from passive observation.
    let service = manager.attach_session("session").await.unwrap();
    if review {
        service
            .set_permission_approval_mode(nac_core::permissions::PermissionApprovalMode::Review)
            .await
            .unwrap();
    }
    let interactive = service.subscribe_events_for_client_with_replay(
        nac_core::events::SessionClientId::new(),
        None,
        32,
    );
    let mut body = open(app.clone()).await;
    let baseline = frame(&mut body).await;
    assert_eq!(
        baseline["sources"][0]["availability"]["permissions"],
        "available"
    );
    assert_eq!(baseline["sources"][0]["pending"], serde_json::json!([]));
    let submitted = post(
        app.clone(),
        "/sessions/session/runs",
        serde_json::json!({"prompt":"Attempt the command only after exact permission"}),
    )
    .await;
    assert_eq!(submitted.status(), StatusCode::ACCEPTED);
    let pending = fact(&mut body, "decision_pending").await;
    assert_eq!(
        pending["change"]["decision"]["kind"],
        if review { "review" } else { "permission" }
    );
    assert_eq!(pending["new_attention"], true);
    let id_field = if review { "review_id" } else { "request_id" };
    let id = pending["change"]["decision"][id_field]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(Uuid::parse_str(&id).is_ok());
    assert!(!pending.to_string().contains("pwd"));
    assert!(!pending.to_string().contains("run_id"));
    let mut reset = false;
    if let Journey::Unavailable(reason) = mode {
        // Fault the bounded observation receipt, while actual authority remains live.
        let live = manager
            .inner
            .attention
            .0
            .lock()
            .unwrap()
            .live
            .upgrade()
            .unwrap();
        let (token, mut snapshot) = {
            let state = live.state.lock().unwrap();
            let source = &state.sources["session"];
            (
                source.binding.as_ref().unwrap().token,
                source.service.clone().unwrap(),
            )
        };
        snapshot.revision += 1;
        snapshot.broker.as_mut().unwrap().state = AttentionBrokerState::Unavailable(reason);
        Sink {
            live: Arc::downgrade(&live),
            token,
        }
        .service_changed("session", snapshot);
        assert_eq!(frame(&mut body).await["kind"], "reset");
        assert_eq!(service.list_permission_requests().unwrap()[0].id, id);
        reset = true;
    }
    if review {
        assert_eq!(service.list_blocked_permission_reviews().unwrap()[0].id, id);
    } else {
        assert_eq!(service.list_permission_requests().unwrap()[0].id, id);
        assert_eq!(
            post(
                app.clone(),
                &format!("/sessions/session/permissions/{id}"),
                serde_json::json!({"reply":"reject"})
            )
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        if !reset {
            let resolved = fact(&mut body, "decision_resolved").await;
            assert_eq!(resolved["change"]["decision"][id_field], id);
            assert_eq!(resolved["new_attention"], false);
        }
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        while service.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    #[cfg(feature = "review-fixture")]
    if matches!(mode, Journey::ReviewRetry) {
        let sql = rusqlite::Connection::open(root.join("store.db")).unwrap();
        sql.execute_batch("CREATE TRIGGER rollback_retry BEFORE INSERT ON session_inbox BEGIN SELECT RAISE(ABORT,'retry fixture'); END; BEGIN IMMEDIATE;").unwrap();
        let target = format!("/sessions/session/permissions/reviews/{id}/authorize-retry");
        let requesting = app.clone();
        let uri = target.clone();
        let retry =
            tokio::spawn(async move { post(requesting, &uri, serde_json::json!({})).await });
        let removed = fact(&mut body, "decision_resolved").await;
        assert_eq!(removed["change"]["decision"][id_field], id);
        sql.execute_batch("ROLLBACK").unwrap();
        assert_eq!(
            retry.await.unwrap().status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        sql.execute_batch("DROP TRIGGER rollback_retry").unwrap();
        drop(sql);
        let restored = fact(&mut body, "decision_pending").await;
        assert_eq!(restored["change"]["decision"][id_field], id);
        assert_eq!(
            restored["new_attention"], false,
            "restoration is current membership, never a new notice"
        );
        assert_eq!(service.list_blocked_permission_reviews().unwrap()[0].id, id);
        let live = manager
            .inner
            .attention
            .0
            .lock()
            .unwrap()
            .live
            .upgrade()
            .unwrap();
        assert!(live.state.lock().unwrap().sources["session"].published.as_ref().unwrap().pending.iter().any(|decision| matches!(decision, AttentionDecision::Review { review_id } if review_id == &id)));
        nac_core::session_service::SessionService::fail_next_retry_wake_for_test();
        assert_eq!(
            post(app.clone(), &target, serde_json::json!({}))
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            fact(&mut body, "decision_resolved").await["change"]["decision"][id_field],
            id
        );
        assert!(service
            .list_blocked_permission_reviews()
            .unwrap()
            .is_empty());
        assert_eq!(service.list_direct_inbox().unwrap().len(), 1);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            2,
            "failed wake keeps the real committed inbox item without a model run"
        );
    }
    if reset {
        drop(body);
        tokio::time::timeout(Duration::from_secs(5), async {
            while manager.inner.attention.0.lock().unwrap().seat.is_some() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        body = open(app.clone()).await;
        let baseline = frame(&mut body).await;
        assert_eq!(baseline["sources"][0]["pending"], serde_json::json!([]));
    }
    #[cfg(not(feature = "review-fixture"))]
    let may_replace = true;
    #[cfg(feature = "review-fixture")]
    let may_replace = !matches!(mode, Journey::ReviewRetry);
    if may_replace {
        let weak = Arc::downgrade(&service);
        drop(interactive);
        drop(service);
        // Exercise the real eviction owner. The feed must not keep this service alive.
        manager.sweep_idle_sessions(None).await;
        assert!(weak.upgrade().is_none());
        assert!(manager.inner.active_sessions.read().await.is_empty());
        let lost = fact(&mut body, "source_replaced").await;
        assert_eq!(
            lost["change"]["snapshot"]["availability"]["permissions"], "unknown",
            "{lost}"
        );
        assert_eq!(lost["new_attention"], false);
        assert_eq!(lost["change"]["snapshot"]["pending"], serde_json::json!([]));
        let replacement = manager.attach_session("session").await.unwrap();
        let replaced = fact(&mut body, "source_replaced").await;
        assert_eq!(
            replaced["change"]["snapshot"]["availability"]["permissions"], "available",
            "{replaced}"
        );
        assert_ne!(lost["source"]["epoch"], replaced["source"]["epoch"]);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            2,
            "observer/replacement must not wake model work"
        );
        drop(replacement);
    } else {
        // Reopening would legitimately admit the durable queued retry. Stop
        // admission during cleanup instead; this fixture must not start it.
        drop(interactive);
        drop(service);
    }
    drop(body);
    drop(app);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    provider.abort();
    let _ = provider.await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_owned_ask_reply_idle_eviction_and_replacement_keep_exact_identity_and_unknown_honest()
{
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    journey(Journey::Permission).await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_broker_authority_survives_observation_capacity_and_revision_unavailability() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for reason in [
        AttentionUnavailable::Capacity,
        AttentionUnavailable::SourceGap,
    ] {
        journey(Journey::Unavailable(reason)).await;
    }
}
#[cfg(feature = "review-fixture")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_review_sse_retry_rollback_restores_current_membership_silently_and_committed_wake_stays_resolved(
) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    journey(Journey::ReviewRetry).await;
}
#[cfg(feature = "review-fixture")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_idle_actionable_review_owner_eviction_is_unknown_not_resolution_or_a_new_notice() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    journey(Journey::ReviewLost).await;
}
