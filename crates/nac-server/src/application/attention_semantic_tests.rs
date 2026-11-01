//! Real HTTP admission/model/terminal transaction/semantic SSE at exact G2.
//! This is canonical service evidence, never an AppKit crash/ACK cutpoint.
#![expect(clippy::unwrap_used, reason = "isolated integration test assertions")]
use super::*;
use crate::tests::{ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode},
    response::IntoResponse,
    Json, Router,
};
use futures_core::Stream;
use nac_core::store;
use std::{
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

type Feed = Pin<Box<dyn Stream<Item = std::result::Result<Bytes, axum::Error>> + Send>>;
struct Provider(Option<tokio::task::JoinHandle<()>>);
impl Provider {
    async fn stop(mut self) {
        if let Some(task) = self.0.take() {
            task.abort();
            let _ = task.await;
        }
    }
}
impl Drop for Provider {
    fn drop(&mut self) {
        if let Some(task) = &self.0 {
            task.abort();
        }
    }
}
async fn post(app: Router, path: &str, value: serde_json::Value) -> serde_json::Value {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        response.status().is_success(),
        "{path}: {}",
        response.status()
    );
    serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap()
}
async fn open(app: Router, cursor: &str) -> Feed {
    let response = app
        .oneshot(
            Request::builder()
                .uri("/attention/events")
                .header("host", "127.0.0.1:12345")
                .header("x-nac-completion-cursor", cursor)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    Box::pin(response.into_body().into_data_stream())
}
async fn frame(body: &mut Feed) -> serde_json::Value {
    let bytes = tokio::time::timeout(
        Duration::from_secs(5),
        std::future::poll_fn(|cx| body.as_mut().poll_next(cx)),
    )
    .await
    .unwrap()
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
async fn completion(
    body: &mut Feed,
    run: &str,
    stale: &str,
    seen: &mut std::collections::BTreeSet<i64>,
) -> serde_json::Value {
    for _ in 0..100 {
        let value = frame(body).await;
        assert_ne!(value["kind"], "reset", "{value}");
        assert!(
            !(value["change"]["work"]["run_id"] == stale
                && value["change"]["work"]["disposition"] == "completed"),
            "legacy current-only completion cannot survive B: {value}"
        );
        if value["kind"] == "completions" {
            for item in value["page"]["items"].as_array().unwrap() {
                assert!(
                    seen.insert(item["sequence"].as_i64().unwrap()),
                    "duplicate semantic delivery: {item}"
                );
                if item["run_id"] == run {
                    return serde_json::json!({"item":item,"page":value["page"]});
                }
            }
        }
    }
    panic!("missing semantic completion {run}");
}
async fn interleave(behavior: &str) {
    let root = std::env::temp_dir().join(format!("nac-semantic-g2-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let calls = Arc::new(AtomicUsize::new(0));
    let entered_a = Arc::new(Notify::new());
    let release_a = Arc::new(Notify::new());
    let entered_b = Arc::new(Notify::new());
    let release_b = Arc::new(Notify::new());
    let handler = {
        let (calls, entered_a, release_a, entered_b, release_b) = (
            calls.clone(),
            entered_a.clone(),
            release_a.clone(),
            entered_b.clone(),
            release_b.clone(),
        );
        move |Json(request): Json<serde_json::Value>| {
            let (calls, entered_a, release_a, entered_b, release_b) = (
                calls.clone(),
                entered_a.clone(),
                release_a.clone(),
                entered_b.clone(),
                release_b.clone(),
            );
            async move {
                let index = calls.fetch_add(1, Ordering::SeqCst);
                assert!(index < 2);
                let (entered, release) = if index == 0 {
                    (entered_a, release_a)
                } else {
                    (entered_b, release_b)
                };
                entered.notify_one();
                tokio::time::timeout(Duration::from_secs(5), release.notified())
                    .await
                    .unwrap();
                let item = serde_json::json!({"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":format!("semantic result {index}")}]});
                let response = serde_json::json!({"status":"completed","output":[item.clone()],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}});
                if request["stream"] == true {
                    ([("content-type","text/event-stream")], format!("data: {}\n\ndata: {}\n\n", serde_json::json!({"type":"response.output_item.done","output_index":0,"item":item}),serde_json::json!({"type":"response.completed","response":response}))).into_response()
                } else {
                    Json(response).into_response()
                }
            }
        }
    };
    let provider = Provider(Some(tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/responses", axum::routing::post(handler)),
        )
        .await
        .unwrap();
    })));
    let path = root.join("store.db");
    let manager = SessionManager::new_async(crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path.clone()),
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
    let project = post(
        app.clone(),
        "/projects",
        serde_json::json!({"name":"semantic G2","cwd":root.clone()}),
    )
    .await;
    let created = post(app.clone(), "/sessions", serde_json::json!({"behavior":behavior,"project_id":project["project_id"],"model":"gpt-5.6-sol","backend":"openai-responses","base_url":base,"api_key_env":"OPENAI_API_KEY"})).await;
    let id = created["metadata"]["session_id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(created["metadata"]["behavior"], behavior);
    let service = manager.attach_session(&id).await.unwrap();
    let mut feed = open(app.clone(), "new").await;
    let cutoff = frame(&mut feed).await;
    assert_eq!(cutoff["kind"], "completions");
    assert_eq!(cutoff["page"]["baseline"], true);
    assert!(cutoff["page"]["items"].as_array().unwrap().is_empty());
    assert_eq!(frame(&mut feed).await["kind"], "baseline");
    let a = post(
        app.clone(),
        &format!("/sessions/{id}/runs"),
        serde_json::json!({"prompt":"semantic A"}),
    )
    .await;
    let a = a["run_id"].as_str().unwrap().to_owned();
    tokio::time::timeout(Duration::from_secs(5), entered_a.notified())
        .await
        .unwrap();
    let barrier = service.hold_attention_publication_for_test(&a).unwrap();
    release_a.notify_one();
    barrier.arrived().await.unwrap();
    assert!(
        service.active_run().is_none(),
        "barrier must be AFTER verified Idle, not terminal-but-finishing"
    );
    let b = post(
        app.clone(),
        &format!("/sessions/{id}/runs"),
        serde_json::json!({"prompt":"semantic B"}),
    )
    .await;
    let b = b["run_id"].as_str().unwrap().to_owned();
    assert_ne!(a, b);
    tokio::time::timeout(Duration::from_secs(5), entered_b.notified())
        .await
        .unwrap();
    assert_eq!(service.active_run().unwrap().run_id.as_str(), b);
    barrier.release();
    barrier.published().await.unwrap();
    let mut seen = std::collections::BTreeSet::new();
    let first = completion(&mut feed, &a, &a, &mut seen).await;
    assert_eq!(
        service.active_run().unwrap().run_id.as_str(),
        b,
        "semantic A observed while B is active"
    );
    assert_eq!(first["item"]["session_id"], id);
    assert_eq!(first["item"]["behavior"], behavior);
    assert_eq!(first["item"]["kind"], "request");
    assert!(first["item"]["goal_id"].is_null());
    assert!(first["item"]["mark_version"].is_null());
    release_b.notify_one();
    let second = completion(&mut feed, &b, &a, &mut seen).await;
    for item in [&first["item"], &second["item"]] {
        assert_eq!(item["session_id"], id);
        assert_eq!(item["behavior"], behavior);
        assert_eq!(item["kind"], "request");
        assert!(item["goal_id"].is_null() && item["mark_version"].is_null());
    }
    assert_eq!(first["page"]["store_id"], cutoff["page"]["store_id"]);
    assert_eq!(second["page"]["store_id"], cutoff["page"]["store_id"]);
    assert!(
        second["item"]["sequence"].as_i64().unwrap() > first["item"]["sequence"].as_i64().unwrap()
    );
    let cursor = format!(
        "{}:{}",
        cutoff["page"]["store_id"].as_str().unwrap(),
        cutoff["page"]["cursor"].as_i64().unwrap()
    );
    drop(feed);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if manager.inner.attention.0.lock().unwrap().seat.is_none() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let mut replay = open(app.clone(), &cursor).await;
    let page = frame(&mut replay).await;
    assert_eq!(page["kind"], "completions");
    let items = page["page"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0], first["item"]);
    assert_eq!(items[1], second["item"]);
    let canonical = store::read_completion_page(&path, None).unwrap();
    assert_eq!(canonical.cursor.sequence, 2);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    eprintln!(
        "semantic-g2-evidence {}",
        serde_json::json!({
            "behavior":behavior,"session":id,"run_a":a,"run_b":b,
            "silent_cutoff":cutoff["page"],"semantic_a_while_b_active":first,
            "semantic_b":second,"replayed":items,"model_posts":calls.load(Ordering::SeqCst)
        })
    );
    drop(replay);
    drop(barrier);
    drop(service);
    drop(app);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    provider.stop().await;
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn semantic_g2_real_http_direct_idle_before_publish_keeps_exact_a_during_b_and_replays() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    interleave("direct").await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn semantic_g2_real_http_dwo_idle_before_publish_keeps_exact_a_during_b_and_replays() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    interleave("direct-with-orchestrator").await;
}
