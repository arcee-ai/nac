//! A child's description is its immutable label. Continuation may omit it,
//! creation may not, and an explicit mismatch rejects before any turn.

use super::*;

const LABEL: &str = "audit store";

fn child_body(child: Option<&str>, description: Option<&str>, prompt: &str) -> serde_json::Value {
    let mut body = serde_json::json!({
        "profile": "general", "prompt": prompt, "background": false,
        "child_session_id": child,
    });
    if let Some(description) = description {
        body["description"] = description.into();
    }
    body
}

async fn post_child(app: &Router, parent: &str, body: serde_json::Value) -> Response {
    post_json(app.clone(), &format!("/sessions/{parent}/children"), body).await
}

async fn created(response: Response) -> TraditionalChildRecord {
    let status = response.status();
    let body = response_body(response).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "{}",
        String::from_utf8_lossy(&body)
    );
    serde_json::from_slice(&body).unwrap()
}

async fn rejected(response: Response, status: StatusCode) -> String {
    assert_eq!(response.status(), status);
    response_json(response).await["error"]
        .as_str()
        .expect("API error message")
        .to_owned()
}

fn transcript_len(root: &std::path::Path, session: &str) -> usize {
    sessions::load_session(&root.join("store.db"), session)
        .unwrap()
        .messages
        .len()
}

fn assert_no_more_model_requests(requests: &std::sync::mpsc::Receiver<usize>) {
    assert!(
        requests.recv_timeout(Duration::from_millis(300)).is_err(),
        "a rejected continuation must not reach the model"
    );
}

#[tokio::test]
async fn omitted_label_continues_terminal_child_with_unchanged_identity_and_one_turn() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_label_omitted");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    let (base, requests) =
        scripted_direct_responses(&["first done", "omitted done", "null done", "matched done"]);
    seed_direct_session_with_base_url(&root, "parent", base);
    let app = router(test_manager(&root));

    let first =
        created(post_child(&app, "parent", child_body(None, Some(LABEL), "first")).await).await;
    assert_eq!(first.description, LABEL);
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    let id = first.child_session_id.as_str();

    let omitted =
        created(post_child(&app, "parent", child_body(Some(id), None, "continue")).await).await;
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
    let mut explicit_null = child_body(Some(id), None, "continue again");
    explicit_null["description"] = serde_json::Value::Null;
    let null = created(post_child(&app, "parent", explicit_null).await).await;
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
    // Existing explicit-label callers stay compatible, including whitespace.
    let matched = created(
        post_child(
            &app,
            "parent",
            child_body(Some(id), Some("  audit store "), "once more"),
        )
        .await,
    )
    .await;
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 3);
    assert_no_more_model_requests(&requests);

    for (child, generation, report) in [
        (&omitted, 2, "omitted done"),
        (&null, 3, "null done"),
        (&matched, 4, "matched done"),
    ] {
        assert_eq!(child.child_session_id, first.child_session_id);
        assert_eq!(child.parent_session_id, "parent");
        assert_eq!(child.profile, "general");
        assert_eq!(child.description, LABEL);
        assert_eq!(child.created_at, first.created_at);
        assert_eq!(child.generation, generation);
        assert_eq!(child.report.as_deref(), Some(report));
    }
    let listed =
        nac_core::store::list_traditional_children(&root.join("store.db"), "parent").unwrap();
    assert_eq!(listed.len(), 1, "continuation never creates another child");
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn omitted_label_steers_running_child_generation() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_label_steer");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    let (base, requests, release) = stalled_then_scripted_direct_response();
    seed_direct_session_with_base_url(&root, "parent", base);
    let app = router(test_manager(&root));
    let mut launch = child_body(None, Some(LABEL), "long task");
    launch["background"] = true.into();
    let running = created(post_child(&app, "parent", launch).await).await;
    tokio::task::spawn_blocking(move || requests.recv_timeout(Duration::from_secs(5)).unwrap())
        .await
        .unwrap();

    let mut steer = child_body(Some(&running.child_session_id), None, "also check locks");
    steer["background"] = true.into();
    let steered = created(post_child(&app, "parent", steer).await).await;
    assert_eq!(steered.child_session_id, running.child_session_id);
    assert_eq!(steered.generation, running.generation);
    assert_eq!(steered.description, LABEL);
    let inbox =
        nac_core::store::list_session_inbox(&root.join("store.db"), &running.child_session_id)
            .unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].content, "also check locks");
    assert_eq!(inbox[0].target_run_id, running.run_id);
    release.send(()).unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn new_child_requires_a_valid_label_before_any_mutation() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_label_required");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    let (base, requests) = scripted_direct_responses(&["created"]);
    seed_direct_session_with_base_url(&root, "parent", base);
    let app = router(test_manager(&root));
    let sessions_before = sessions::list_sessions(&root.join("store.db"))
        .unwrap()
        .len();

    let missing = rejected(
        post_child(&app, "parent", child_body(None, None, "work")).await,
        StatusCode::BAD_REQUEST,
    )
    .await;
    assert_eq!(
        missing,
        "traditional child description is required to launch a new child; \
         omit it (or pass null) only when continuing an existing child_session_id"
    );
    for (invalid, message) in [
        ("   ", "child description is empty"),
        (
            &"x".repeat(121)[..],
            "child description exceeds 120 characters",
        ),
    ] {
        let error = rejected(
            post_child(&app, "parent", child_body(None, Some(invalid), "work")).await,
            StatusCode::BAD_REQUEST,
        )
        .await;
        assert!(error.contains(message), "{error}");
    }
    assert_eq!(
        sessions::list_sessions(&root.join("store.db"))
            .unwrap()
            .len(),
        sessions_before,
        "an unlabelled or invalid launch creates no session"
    );
    assert!(
        nac_core::store::list_traditional_children(&root.join("store.db"), "parent")
            .unwrap()
            .is_empty()
    );
    assert_no_more_model_requests(&requests);

    let child =
        created(post_child(&app, "parent", child_body(None, Some(LABEL), "work")).await).await;
    assert_eq!(child.description, LABEL);
    assert_eq!(child.report.as_deref(), Some("created"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn mismatched_label_rejects_actionably_without_turn_or_mutation() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_label_mismatch");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    let (base, requests) = scripted_direct_responses(&["first done"]);
    seed_direct_session_with_base_url(&root, "parent", base);
    let app = router(test_manager(&root));
    let child =
        created(post_child(&app, "parent", child_body(None, Some(LABEL), "first")).await).await;
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    let id = child.child_session_id.clone();
    let store = root.join("store.db");
    let record_before = nac_core::store::load_traditional_child(&store, &id).unwrap();
    let transcript_before = transcript_len(&root, &id);
    let parent_transcript_before = transcript_len(&root, "parent");

    // Labels are caller-authored and may contain status-like words.
    for label in ["Audit the store", "fix busy not found bug"] {
        let error = rejected(
            post_child(
                &app,
                "parent",
                child_body(Some(&id), Some(label), "continue"),
            )
            .await,
            StatusCode::BAD_REQUEST,
        )
        .await;
        assert_eq!(
            error,
            format!(
                "traditional child description is immutable (expected '{LABEL}'). \
                 To continue or steer child '{id}', omit description (or pass null) or \
                 pass '{LABEL}' exactly; launch a new child with child_session_id null \
                 for a different task label"
            )
        );
    }
    assert_no_more_model_requests(&requests);
    assert_eq!(
        nac_core::store::load_traditional_child(&store, &id).unwrap(),
        record_before
    );
    assert_eq!(transcript_len(&root, &id), transcript_before);
    assert_eq!(transcript_len(&root, "parent"), parent_transcript_before);
    assert!(nac_core::store::list_session_inbox(&store, &id)
        .unwrap()
        .is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn foreign_and_missing_children_stay_opaque_with_or_without_label() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_label_opaque");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    seed_direct_session(&root, "parent-a");
    seed_direct_session(&root, "parent-b");
    seed_direct_session(&root, "child-a");
    nac_core::store::create_traditional_child_relationship(
        &root.join("store.db"),
        "parent-a",
        "child-a",
        "general",
        "secret owner label",
    )
    .unwrap();
    let record_before =
        nac_core::store::load_traditional_child(&root.join("store.db"), "child-a").unwrap();
    let app = router(test_manager(&root));

    let mut errors = Vec::new();
    for child in ["child-a", "missing-child"] {
        for label in [None, Some("secret owner label"), Some("guess")] {
            errors.push(
                rejected(
                    post_child(
                        &app,
                        "parent-b",
                        child_body(Some(child), label, "take over"),
                    )
                    .await,
                    StatusCode::NOT_FOUND,
                )
                .await,
            );
        }
    }
    assert!(
        errors
            .iter()
            .all(|error| error == "traditional child was not found"),
        "{errors:?}"
    );
    assert_eq!(
        nac_core::store::load_traditional_child(&root.join("store.db"), "child-a").unwrap(),
        record_before
    );
    let _ = std::fs::remove_dir_all(root);
}
