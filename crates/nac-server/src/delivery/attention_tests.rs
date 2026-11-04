use super::*;
use crate::tests::{seed_direct_session, test_manager, ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use axum::{body::Body, http::Request};
use futures_core::Stream;
use nac_core::{store, store::TranscriptLogWriter, types::Message};
use std::pin::Pin;
use std::{path::PathBuf, time::Duration};
use tower::ServiceExt;

fn root() -> PathBuf {
    let root = std::env::temp_dir().join(format!("nac-attention-http-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}
fn request(headers: &[(&str, &str)]) -> Request<Body> {
    let mut request = Request::builder()
        .uri("/attention/events")
        .header("host", "127.0.0.1:12345");
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    request.body(Body::empty()).unwrap()
}
async fn next<S: Stream + Unpin>(stream: &mut S) -> Option<S::Item> {
    std::future::poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)).await
}
fn data(bytes: &[u8]) -> serde_json::Value {
    let text = std::str::from_utf8(bytes).unwrap();
    let json = text
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .unwrap();
    serde_json::from_str(json).unwrap()
}
#[tokio::test]
async fn assembled_get_guards_precede_observer_and_bootstrap() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = root();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let manager = test_manager(&root);
    let app = crate::router(manager.clone());
    assert_eq!(
        app.clone().oneshot(request(&[])).await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
    manager
        .inner
        .attention
        .configure_native(uuid::Uuid::new_v4(), "127.0.0.1:12345".into());
    for headers in [
        vec![("origin", "https://evil.example")],
        vec![("origin", "null")],
        vec![("sec-fetch-site", "cross-site")],
        vec![("sec-fetch-site", "same-site")],
        vec![("host", "127.0.0.1:12345")],
        vec![
            ("origin", "http://127.0.0.1:12345"),
            ("origin", "http://127.0.0.1:12345"),
        ],
    ] {
        assert_eq!(
            app.clone()
                .oneshot(request(&headers))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    // There is still no subscription or canonical baseline; a valid request
    // takes the one seat. An absent direct broker is explicitly unknown.
    seed_direct_session(&root, "session");
    let response = app
        .clone()
        .oneshot(request(&[
            ("origin", "http://127.0.0.1:12345"),
            ("sec-fetch-site", "same-origin"),
        ]))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let mut body = response.into_body().into_data_stream();
    let baseline = data(&next(&mut body).await.unwrap().unwrap());
    assert_eq!(baseline["kind"], "baseline");
    assert_eq!(
        baseline["sources"][0]["availability"]["permissions"],
        "unknown"
    );
    assert_eq!(
        app.clone().oneshot(request(&[])).await.unwrap().status(),
        StatusCode::CONFLICT
    );
    assert!(manager.inner.active_sessions.read().await.is_empty());
    drop(body);
    manager.inner.attention.stop();
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn committed_hint_reconciles_question_sse_once_without_attaching_or_exposing_text() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = root();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let manager = test_manager(&root);
    seed_direct_session(&root, "session");
    manager
        .inner
        .attention
        .configure_native(uuid::Uuid::new_v4(), "127.0.0.1:12345".into());
    let path = root.join("store.db");
    let goal =
        store::create_session_goal(&path, "session", "private objective", None, None).unwrap();
    let response = crate::router(manager.clone())
        .oneshot(request(&[]))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let mut body = response.into_body().into_data_stream();
    let baseline = data(&next(&mut body).await.unwrap().unwrap());
    assert_eq!(baseline["sources"][0]["pending"], serde_json::json!([]));
    let path = root.join("store.db");
    let run = uuid::Uuid::new_v4().to_string();
    TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "session",
            0,
            &Message::User {
                content: "private prompt".into(),
            },
            &run,
        )
        .unwrap();
    // This fixture seeds the durable question; the production postcommit goal
    // hint exercises scoped reconciliation. Core tests independently cover the
    // private question writer's postcommit hint (no public mutation test port).
    let request = store::QuestionRequest {
        session_id: "session".into(),
        request_id: "question".into(),
        run_id: run.clone(),
        generation: run,
        text: "PRIVATE QUESTION CANARY".into(),
        choices: vec![],
        responder_class: store::QuestionResponder::HumanDecision,
    };
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute("INSERT INTO task_questions(session_id,request_id,request_json,config_version,goal_id,revision,status,created_at,creation_digest) VALUES('session','question',?1,0,?2,1,'pending','now','fixture')",rusqlite::params![serde_json::to_string(&request).unwrap(),goal.goal_id]).unwrap();
    let paused = store::update_session_goal_by_user(
        &path,
        "session",
        &goal.goal_id,
        goal.version,
        store::UserGoalUpdate {
            status: Some(store::GoalStatus::Paused),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        store::read_attention_metadata(&path, Some("session")).unwrap()[0]
            .question
            .is_some()
    );
    let pending = tokio::time::timeout(Duration::from_secs(3), next(&mut body))
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(!std::str::from_utf8(&pending).unwrap().contains("CANARY"));
    let pending = data(&pending);
    assert_eq!(pending["change"]["kind"], "decision_pending", "{pending}");
    assert_eq!(pending["change"]["decision"]["request_id"], "question");
    assert_eq!(pending["new_attention"], true);
    connection
        .execute(
            "UPDATE task_questions SET status='cancelled',revision=2 WHERE session_id='session'",
            [],
        )
        .unwrap();
    store::update_session_goal_by_user(
        &path,
        "session",
        &goal.goal_id,
        paused.version,
        store::UserGoalUpdate {
            status: Some(store::GoalStatus::Active),
            ..Default::default()
        },
    )
    .unwrap();
    let resolved = data(
        &tokio::time::timeout(Duration::from_secs(3), next(&mut body))
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
    );
    assert_eq!(resolved["change"]["kind"], "decision_resolved");
    assert_eq!(resolved["new_attention"], false);
    assert!(manager.inner.active_sessions.read().await.is_empty());
    assert!(
        tokio::time::timeout(Duration::from_millis(30), next(&mut body))
            .await
            .is_err()
    );
    drop(body);
    manager.inner.attention.stop();
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
