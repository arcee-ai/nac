//! Full in-process provider -> real store/service -> assembled native SSE path.
//! No browser, OS notification, real credentials or external model is involved.
use super::*;
use futures_core::Stream;
use nac_core::store;
use std::pin::Pin;

async fn next_frame<S: Stream + Unpin>(stream: &mut S) -> serde_json::Value
where
    S::Item: AsRef<[u8]>,
{
    let bytes = std::future::poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx))
        .await
        .unwrap();
    let text = std::str::from_utf8(bytes.as_ref()).unwrap();
    serde_json::from_str(
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn native_attention_real_question_answer_and_goal_completion_are_exact_and_once() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("attention-real-provider");
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let arrived = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let goal_id = Arc::new(StdMutex::new(String::new()));
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let handler = {
        let arrived = arrived.clone();
        let release = release.clone();
        let goal_id = goal_id.clone();
        let calls = calls.clone();
        move || {
            let arrived = arrived.clone();
            let release = release.clone();
            let goal_id = goal_id.clone();
            let calls = calls.clone();
            async move {
                let index = calls.fetch_add(1, Ordering::SeqCst);
                let item = match index {
                    0 => {
                        arrived.notify_one();
                        release.notified().await;
                        serde_json::json!({"type":"function_call","call_id":"question","name":"request_question","arguments":serde_json::json!({"request_id":"choice","text":"PRIVATE QUESTION TEXT","choices":["CSV","JSON"],"responder_class":"human_decision"}).to_string()})
                    }
                    1 => {
                        serde_json::json!({"type":"function_call","call_id":"goal","name":"update_goal","arguments":serde_json::json!({"goal_id":goal_id.lock().unwrap().clone(),"status":"complete"}).to_string()})
                    }
                    2 => {
                        serde_json::json!({"type":"message","content":[{"type":"output_text","text":"Selected export completed"}]})
                    }
                    _ => panic!("unexpected provider call {index}"),
                };
                Json(
                    serde_json::json!({"status":"completed","output":[item],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}),
                )
            }
        }
    };
    let provider = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/responses", axum::routing::post(handler)),
        )
        .await
        .unwrap();
    });
    seed_direct_session_with_base_url(&root, "session", base);
    let manager = SessionManager::new_async(ServerOptions {
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
        .configure_native(uuid::Uuid::new_v4(), "127.0.0.1:12345".into());
    let app = router(manager.clone());
    let response = app
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
    // Map errors explicitly; next_frame then works with bounded SSE byte frames.
    let mut body = Box::pin(
        async_stream::stream! {let mut body=response.into_body().into_data_stream();while let Some(frame)=std::future::poll_fn(|cx|Pin::new(&mut body).poll_next(cx)).await {yield frame.unwrap();}},
    );
    let baseline = next_frame(&mut body).await;
    assert_eq!(baseline["kind"], "baseline");
    assert!(manager.inner.active_sessions.read().await.is_empty());
    let submitted = post_json(
        app.clone(),
        "/sessions/session/runs",
        serde_json::json!({"prompt":"Request exact export choice then finish"}),
    )
    .await;
    assert_eq!(submitted.status(), StatusCode::ACCEPTED);
    let old_run = response_json(submitted).await["run_id"]
        .as_str()
        .unwrap()
        .to_owned();
    tokio::time::timeout(Duration::from_secs(5), arrived.notified())
        .await
        .unwrap();
    let goal = post_json(
        app.clone(),
        "/sessions/session/goal",
        serde_json::json!({"objective":"Finish selected export"}),
    )
    .await;
    assert_eq!(goal.status(), StatusCode::CREATED);
    let goal = response_json(goal).await;
    *goal_id.lock().unwrap() = goal["goal_id"].as_str().unwrap().into();
    release.notify_one();
    let mut observed = Vec::new();
    let pending = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let frame = next_frame(&mut body).await;
            assert!(!frame.to_string().contains("PRIVATE QUESTION TEXT"));
            assert_ne!(frame["change"]["work"]["disposition"], "completed");
            observed.push(frame.clone());
            if frame["change"]["kind"] == "decision_pending" {
                break frame;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(pending["change"]["decision"]["request_id"], "choice");
    assert_eq!(pending["change"]["decision"]["run_id"], old_run);
    assert_eq!(pending["new_attention"], true);
    let service = manager.inner.active_sessions.read().await["session"].clone();
    tokio::time::timeout(Duration::from_secs(5), async {
        while service.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let answered=post_json(app.clone(),"/sessions/session/questions/choice/answer",serde_json::json!({"request_id":"choice","run_id":old_run,"generation":old_run,"expected_revision":1,"answer":"CSV"})).await;
    assert_eq!(answered.status(), StatusCode::OK);
    let answered = response_json(answered).await;
    let completed = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let frame = next_frame(&mut body).await;
            observed.push(frame.clone());
            if frame["change"]["work"]["disposition"] == "completed" {
                break frame;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(
        completed["change"]["work"]["run_id"],
        answered["continuation_run_id"]
    );
    assert_eq!(completed["new_attention"], true);
    assert_eq!(
        observed
            .iter()
            .filter(|frame| frame["change"]["kind"] == "decision_pending")
            .count(),
        1
    );
    assert_eq!(
        observed
            .iter()
            .filter(|frame| frame["change"]["kind"] == "decision_resolved")
            .count(),
        1
    );
    assert_eq!(
        observed
            .iter()
            .filter(|frame| frame["change"]["work"]["disposition"] == "completed")
            .count(),
        1
    );
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    let goal = store::load_session_goal(&root.join("store.db"), "session")
        .unwrap()
        .unwrap();
    assert_eq!(goal.status, GoalStatus::Complete);
    assert!(goal.accounting_run_id.is_none());
    assert!(service.list_permission_requests().unwrap().is_empty());
    assert!(service.list_permission_grants().unwrap().is_empty());
    drop(body);
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    provider.abort();
    let _ = provider.await;
    drop(service);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
