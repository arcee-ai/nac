use crate::store;
use crate::tools::task_discovery::tests::{call, cleanup, runtime, value};
use serde_json::{json, Value};

#[tokio::test]
async fn missing_question_returns_typed_not_found_without_changing_store_absence() {
    let runtime = runtime(Vec::new());
    let result = call(
        &runtime,
        "read_question",
        json!({
            "session_id":"peer-a", "request_id":"missing", "project_id":null
        }),
    )
    .await;
    let payload: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    assert_eq!(payload["status"], "not_found");
    assert!(result.is_error);
    assert!(store::task_questions::load_task_question_scoped(
        &runtime.store_path,
        "peer-a",
        "missing",
        Some("p1")
    )
    .unwrap()
    .is_none());
    cleanup(&runtime);
}

#[tokio::test]
async fn question_read_preserves_found_scope_and_permission_controls() {
    let rt = runtime(Vec::new());
    let run = uuid::Uuid::new_v4().to_string();
    store::TranscriptLogWriter::new(&rt.store_path)
        .unwrap()
        .append_run_prompt(
            "peer-a",
            0,
            &crate::types::Message::User {
                content: "work".into(),
            },
            &run,
        )
        .unwrap();
    let question = store::create_task_question(
        &rt.store_path,
        &store::QuestionRequest {
            session_id: "peer-a".into(),
            request_id: "exact".into(),
            run_id: run.clone(),
            generation: run,
            text: "Private exact question".into(),
            choices: vec![],
            responder_class: store::QuestionResponder::Information,
        },
        0,
    )
    .unwrap();
    let found = value(
        &rt,
        "read_question",
        json!({
            "session_id":"peer-a", "request_id":"exact", "project_id":null
        }),
    )
    .await;
    assert_eq!(found["request"], json!(question.request));
    let outside = value(
        &rt,
        "read_question",
        json!({
            "session_id":"peer-a", "request_id":"exact", "project_id":"p2"
        }),
    )
    .await;
    assert_eq!(outside["status"], "outside_scope");
    assert!(!outside.to_string().contains("Private exact question"));
    cleanup(&rt);

    use crate::permissions::{PermissionEffect, PermissionRule};
    let denied = runtime(vec![PermissionRule::new(
        "task_read",
        "session:peer-a",
        PermissionEffect::Deny,
    )]);
    let result = call(
        &denied,
        "read_question",
        json!({
            "session_id":"peer-a", "request_id":"missing", "project_id":null
        }),
    )
    .await;
    assert!(result.is_error);
    assert!(result
        .content
        .as_text()
        .unwrap()
        .contains("permission denied"));
    cleanup(&denied);
}
