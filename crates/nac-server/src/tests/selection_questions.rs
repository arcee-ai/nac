//! ALL-559: tool-free questions about selected assistant text are admitted,
//! answered and recorded beside the chat without touching its run state.
use super::*;
use nac_core::selection_question::content_sha256;
use nac_core::types::Message;
use std::io::Write;
use std::sync::mpsc;

const FIRST_REPLY: &str = "The cache is keyed by session id.\n\nEntries expire after an hour.";

/// A provider double that answers each accepted request with the next body,
/// optionally only after the test releases it.
struct QuestionModelServer {
    base_url: String,
    requests: Arc<std::sync::Mutex<Vec<String>>>,
    handle: std::thread::JoinHandle<()>,
}

impl QuestionModelServer {
    fn start(responses: Vec<(String, Option<mpsc::Receiver<()>>)>) -> Self {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        let handle = std::thread::spawn(move || {
            for (body, release) in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                seen.lock().unwrap().push(read_http_body(&mut stream));
                if let Some(release) = release {
                    if release.recv().is_err() {
                        continue;
                    }
                }
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        Self {
            base_url,
            requests,
            handle,
        }
    }

    fn request_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }
}

fn read_http_body(stream: &mut std::net::TcpStream) -> String {
    let mut data = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let read = stream.read(&mut chunk).unwrap_or(0);
        if read == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..read]);
        if let Some(end) = data.windows(4).position(|window| window == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&data[..end]).to_ascii_lowercase();
            let length = headers
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .and_then(|value| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if data.len() >= end + 4 + length {
                return String::from_utf8_lossy(&data[end + 4..end + 4 + length]).into_owned();
            }
        }
    }
    String::from_utf8_lossy(&data).into_owned()
}

fn text_body(text: &str) -> String {
    serde_json::json!({
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "usage": {"input_tokens": 21, "output_tokens": 6, "total_tokens": 27}
    })
    .to_string()
}

fn tool_call_body() -> String {
    serde_json::json!({
        "status": "completed",
        "output": [{"type": "function_call", "call_id": "call-1", "name": "bash",
            "arguments": "{\"command\":\"touch /tmp/nac-all559-must-not-exist\"}"}],
        "usage": {"input_tokens": 5, "output_tokens": 1, "total_tokens": 6}
    })
    .to_string()
}

fn assistant(text: &str) -> Message {
    Message::Assistant {
        content: Some(text.to_string()),
        reasoning_text: Some("PRIVATE CHAIN".to_string()),
        reasoning_details: None,
        tool_calls: None,
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    }
}

/// A Local direct session whose transcript holds two exchanges: index 2 in
/// the snapshot blob and index 4 in the transcript log.
fn seed_chat(
    root: &std::path::Path,
    session_id: &str,
    base_url: &str,
    behavior: sessions::SessionBehavior,
) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "gpt-5.5".to_string(),
        base_url.to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        vec![
            Message::System {
                content: "direct policy".to_string(),
            },
            Message::User {
                content: "How does the cache work?".to_string(),
            },
            assistant(FIRST_REPLY),
        ],
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    snapshot.behavior = behavior;
    snapshot.allow_insecure_http = true;
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    nac_core::store::TranscriptLogWriter::new(&root.join("store.db"))
        .unwrap()
        .append_batch(
            session_id,
            3,
            &[
                Message::User {
                    content: "Now refactor it".to_string(),
                },
                assistant("Refactored."),
            ],
        )
        .unwrap();
}

fn ask_body(key: &str, excerpt: &str, question: &str) -> serde_json::Value {
    let start = FIRST_REPLY[..FIRST_REPLY.find(excerpt).unwrap()]
        .chars()
        .count();
    serde_json::json!({
        "request_key": key,
        "source_message_index": 2,
        "source_content_sha256": content_sha256(FIRST_REPLY),
        "selection_start": start,
        "selection_end": start + excerpt.chars().count(),
        "excerpt": excerpt,
        "question": question,
    })
}

async fn get(app: Router, uri: &str) -> Response {
    app.oneshot(
        Request::builder()
            .uri(uri)
            .header(header::HOST, "localhost")
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
}

async fn post(app: Router, uri: &str, body: serde_json::Value) -> Response {
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::HOST, "localhost")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}

async fn settled(app: &Router, session: &str, question: &str) -> serde_json::Value {
    for _ in 0..500 {
        let record = response_json(
            get(
                app.clone(),
                &format!("/sessions/{session}/selection-questions/{question}"),
            )
            .await,
        )
        .await;
        if record["status"] != "pending" {
            return record;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("question {question} never settled");
}

/// Everything a question must leave untouched on its source chat.
fn chat_state(store: &std::path::Path, session: &str) -> serde_json::Value {
    let snapshot = sessions::load_session(store, session).unwrap();
    let tail = nac_core::store::TranscriptLogWriter::new(store)
        .unwrap()
        .read_tail_from(session, snapshot.messages.len() as u64)
        .unwrap();
    serde_json::json!({
        "blob": serde_json::to_value(&snapshot.messages).unwrap(),
        "tail": serde_json::to_value(&tail).unwrap(),
        "usage": serde_json::to_value(&snapshot.token_usages).unwrap(),
        "unattributed": serde_json::to_value(&snapshot.unattributed_token_usage).unwrap(),
        "config_version": snapshot.config_version,
        "inbox": nac_core::store::list_session_inbox(store, session).unwrap().len(),
        "goal": nac_core::store::load_session_goal(store, session).unwrap().is_some(),
        "run": nac_core::store::load_run_recovery(store, session).unwrap().is_some(),
    })
}

const KEY_A: &str = "6f1c7d34-7a39-4c1f-9d4c-1f47e0e4a001";
const KEY_B: &str = "6f1c7d34-7a39-4c1f-9d4c-1f47e0e4a002";
const KEY_C: &str = "6f1c7d34-7a39-4c1f-9d4c-1f47e0e4a003";

#[tokio::test]
async fn a_question_is_answered_beside_a_busy_chat_without_touching_it() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("selection_question_answer");
    let home = root.join("nac-home");
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("question-key"));
    let (release, gate) = mpsc::channel();
    let model = QuestionModelServer::start(vec![
        (text_body("It means entries are per chat."), Some(gate)),
        (tool_call_body(), None),
    ]);
    seed_chat(
        &root,
        "chat",
        &model.base_url,
        sessions::SessionBehavior::Direct,
    );
    let store = root.join("store.db");
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let before = chat_state(&store, "chat");

    // The main run owns the session operation lease the whole time.
    let main_run = sessions::SessionOperationLease::try_acquire(&store, "chat").unwrap();

    let response = post(
        app.clone(),
        "/sessions/chat/selection-questions",
        ask_body(KEY_A, "keyed by session id", "What does keyed mean here?"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let admitted = response_json(response).await;
    assert_eq!(admitted["replayed"], false);
    let question = admitted["question"]["question_id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(admitted["question"]["status"], "pending");
    assert_eq!(admitted["question"]["source"]["message_index"], 2);
    assert_eq!(admitted["question"]["model"]["model"], "gpt-5.5");

    // A later append (made by the main chat under its own lease) cannot
    // retarget the frozen question.
    drop(main_run);
    nac_core::store::TranscriptLogWriter::new(&store)
        .unwrap()
        .append_batch(
            "chat",
            5,
            &[Message::User {
                content: "steer".into(),
            }],
        )
        .unwrap();
    let main_run = sessions::SessionOperationLease::try_acquire(&store, "chat").unwrap();

    // Lost response: the identical retry returns the original receipt.
    let retry = response_json(
        post(
            app.clone(),
            "/sessions/chat/selection-questions",
            ask_body(KEY_A, "keyed by session id", "What does keyed mean here?"),
        )
        .await,
    )
    .await;
    assert_eq!(retry["replayed"], true);
    assert_eq!(retry["question"]["question_id"], question.as_str());
    // Same key, changed arguments.
    let conflict = post(
        app.clone(),
        "/sessions/chat/selection-questions",
        ask_body(KEY_A, "keyed by session id", "A different question"),
    )
    .await;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    // One in-flight question per chat.
    let busy = post(
        app.clone(),
        "/sessions/chat/selection-questions",
        ask_body(KEY_B, "Entries expire", "When?"),
    )
    .await;
    assert_eq!(busy.status(), StatusCode::CONFLICT);

    let first = model.requests.lock().unwrap().first().cloned();
    if let Some(body) = first {
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(body
            .get("tools")
            .is_none_or(|tools| tools.as_array().is_some_and(Vec::is_empty)));
        let text = body.to_string();
        assert!(text.contains("keyed by session id"));
        assert!(text.contains("How does the cache work?"));
        assert!(!text.contains("PRIVATE CHAIN"));
        assert!(!text.contains("steer"));
    }
    release.send(()).unwrap();
    let answered = settled(&app, "chat", &question).await;
    assert_eq!(answered["status"], "answered");
    assert_eq!(answered["answer"], "It means entries are per chat.");
    assert_eq!(answered["usage"]["input_tokens"], 21);
    assert_eq!(answered["tool_call_attempted"], false);
    drop(main_run);

    // A tool call is recorded, never executed, and never followed up.
    let tool = response_json(
        post(
            app.clone(),
            "/sessions/chat/selection-questions",
            ask_body(KEY_C, "Entries expire after an hour.", "Can you check?"),
        )
        .await,
    )
    .await;
    let tool_id = tool["question"]["question_id"].as_str().unwrap().to_owned();
    let failed = settled(&app, "chat", &tool_id).await;
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["tool_call_attempted"], true);
    assert_eq!(
        failed["error"],
        nac_core::selection_question::TOOL_CALL_NO_ANSWER
    );
    assert!(!std::path::Path::new("/tmp/nac-all559-must-not-exist").exists());
    assert_eq!(model.request_count(), 2);

    // History reads back after a "reload"; the chat itself only has the one
    // append this test made.
    let listed = response_json(get(app.clone(), "/sessions/chat/selection-questions").await).await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 2);
    assert_eq!(listed["limits"]["history_limit"], 50);
    let mut after = chat_state(&store, "chat");
    let tail = after["tail"].as_array_mut().unwrap();
    assert_eq!(tail.pop().unwrap()[1]["content"], "steer");
    assert_eq!(after, before);
    model.handle.join().unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cancel_affects_only_the_question_and_restart_interrupts_without_replay() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("selection_question_cancel");
    let home = root.join("nac-home");
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("question-key"));
    let (release, gate) = mpsc::channel();
    let model = QuestionModelServer::start(vec![(text_body("late"), Some(gate))]);
    seed_chat(
        &root,
        "chat",
        &model.base_url,
        sessions::SessionBehavior::Direct,
    );
    let store = root.join("store.db");
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let before = chat_state(&store, "chat");

    let admitted = response_json(
        post(
            app.clone(),
            "/sessions/chat/selection-questions",
            ask_body(KEY_A, "keyed by session id", "Why?"),
        )
        .await,
    )
    .await;
    let question = admitted["question"]["question_id"]
        .as_str()
        .unwrap()
        .to_owned();
    for _ in 0..500 {
        if model.request_count() == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let canceled = response_json(
        post(
            app.clone(),
            &format!("/sessions/chat/selection-questions/{question}/cancel"),
            serde_json::json!({}),
        )
        .await,
    )
    .await;
    assert_eq!(canceled["status"], "canceled");
    let _ = release.send(());
    tokio::time::sleep(Duration::from_millis(100)).await;
    let record = settled(&app, "chat", &question).await;
    assert_eq!(record["status"], "canceled");
    assert!(record["answer"].is_null());
    assert_eq!(chat_state(&store, "chat"), before);
    // Wait until the canceled question's owner released its lease.
    let lease_name = nac_core::store::selection_question_lease_name("chat");
    for _ in 0..500 {
        if sessions::SessionOperationLease::try_acquire(&store, &lease_name).is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    // A question left pending by a process that died (no live owner) is
    // interrupted by the next serving process and never sent again.
    let pending = nac_core::store::admit_selection_question(
        &store,
        &nac_core::store::SelectionQuestionAdmission {
            question_id: uuid::Uuid::new_v4().to_string(),
            session_id: "chat".to_string(),
            request_key: KEY_B.to_string(),
            request_digest: "d".repeat(64),
            context: record_context(),
            model: nac_core::store::SelectionQuestionModel {
                model: "gpt-5.5".to_string(),
                backend: "openai-responses".to_string(),
                config_version: 0,
            },
        },
    )
    .unwrap()
    .record;
    drop(app);
    drop(manager);
    let restarted = test_manager(&root);
    let app = router(restarted);
    let interrupted = response_json(
        get(
            app,
            &format!("/sessions/chat/selection-questions/{}", pending.question_id),
        )
        .await,
    )
    .await;
    assert_eq!(interrupted["status"], "interrupted");
    assert_eq!(model.request_count(), 1);
    model.handle.join().unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn store_contention_is_409_and_the_same_request_is_admitted_after_it_clears() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("selection_question_busy");
    let home = root.join("nac-home");
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("question-key"));
    let model = QuestionModelServer::start(vec![(text_body("Per chat."), None)]);
    seed_chat(
        &root,
        "chat",
        &model.base_url,
        sessions::SessionBehavior::Direct,
    );
    let store = root.join("store.db");
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let ask = || ask_body(KEY_A, "keyed by session id", "What does keyed mean here?");

    // A real foreign writer exhausts the serving connection's finite busy wait
    // before admission commits. WAL readers still validate the source.
    let blocker = rusqlite::Connection::open(&store).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let busy = post(app.clone(), "/sessions/chat/selection-questions", ask()).await;
    assert_eq!(busy.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(busy).await["error"],
        "the question store is busy; try again shortly"
    );
    assert_eq!(model.request_count(), 0);
    blocker.execute_batch("ROLLBACK").unwrap();

    // Nothing was recorded, so the identical retry is a first admission.
    let admitted =
        response_json(post(app.clone(), "/sessions/chat/selection-questions", ask()).await).await;
    assert_eq!(admitted["replayed"], false);
    let question = admitted["question"]["question_id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(settled(&app, "chat", &question).await["status"], "answered");
    let listed = response_json(get(app.clone(), "/sessions/chat/selection-questions").await).await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);
    model.handle.join().unwrap();
    let _ = std::fs::remove_dir_all(root);
}

fn record_context() -> nac_core::store::SelectionQuestionContext {
    nac_core::store::SelectionQuestionContext {
        source_message_index: 2,
        source_content_sha256: content_sha256(FIRST_REPLY),
        selection_start: 0,
        selection_end: 3,
        excerpt: "The".to_string(),
        source_text: FIRST_REPLY.to_string(),
        source_text_truncated: false,
        preceding_prompt: None,
        preceding_prompt_truncated: false,
        question: "q".to_string(),
    }
}

#[tokio::test]
async fn selection_binding_scope_and_bounds_are_enforced_over_http() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("selection_question_bounds");
    let home = root.join("nac-home");
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("question-key"));
    let base = "http://127.0.0.1:9/v1";
    seed_chat(&root, "chat", base, sessions::SessionBehavior::Direct);
    seed_chat(
        &root,
        "orchestrator",
        base,
        sessions::SessionBehavior::Orchestrator,
    );
    seed_chat(
        &root,
        "hybrid",
        base,
        sessions::SessionBehavior::DirectWithOrchestrator,
    );
    seed_chat(&root, "delegated", base, sessions::SessionBehavior::Direct);
    nac_core::store::create_traditional_child_relationship(
        &root.join("store.db"),
        "chat",
        "delegated",
        nac_core::store::GENERAL_CHILD_PROFILE,
        "delegated child",
    )
    .unwrap();
    let manager = test_manager(&root);
    let app = router(manager);
    let ask = |session: &str, body: serde_json::Value| {
        let app = app.clone();
        let uri = format!("/sessions/{session}/selection-questions");
        async move { post(app, &uri, body).await.status() }
    };
    let valid = || ask_body(KEY_A, "keyed by session id", "Why?");

    let mut changed = valid();
    changed["source_content_sha256"] = content_sha256("edited").into();
    assert_eq!(ask("chat", changed).await, StatusCode::CONFLICT);
    let mut deleted = valid();
    deleted["source_message_index"] = 99.into();
    assert_eq!(ask("chat", deleted).await, StatusCode::CONFLICT);
    let mut user_message = valid();
    user_message["source_message_index"] = 1.into();
    assert_eq!(ask("chat", user_message).await, StatusCode::CONFLICT);
    let mut unmappable = valid();
    unmappable["selection_start"] = 0.into();
    unmappable["selection_end"] = 19.into();
    assert_eq!(ask("chat", unmappable).await, StatusCode::BAD_REQUEST);
    let mut long_question = valid();
    long_question["question"] = "x".repeat(2_001).into();
    assert_eq!(ask("chat", long_question).await, StatusCode::BAD_REQUEST);
    let mut bad_key = valid();
    bad_key["request_key"] = "retry-1".into();
    assert_eq!(ask("chat", bad_key).await, StatusCode::BAD_REQUEST);
    let mut unknown_field = valid();
    unknown_field["tools"] = serde_json::json!([]);
    assert_eq!(
        ask("chat", unknown_field).await,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut huge = valid();
    huge["question"] = "x".repeat(70 * 1024).into();
    assert_eq!(ask("chat", huge).await, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(ask("orchestrator", valid()).await, StatusCode::CONFLICT);
    assert_eq!(ask("hybrid", valid()).await, StatusCode::CONFLICT);
    assert_eq!(ask("missing", valid()).await, StatusCode::NOT_FOUND);
    // A delegated child is as unknown as a missing session.
    assert_eq!(ask("delegated", valid()).await, StatusCode::NOT_FOUND);
    assert_eq!(
        get(app.clone(), "/sessions/delegated/selection-questions")
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(app.clone(), "/sessions/missing/selection-questions")
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(app.clone(), "/sessions/chat/selection-questions/nope")
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    // None of the rejected requests left a record.
    let listed = response_json(get(app.clone(), "/sessions/chat/selection-questions").await).await;
    assert!(listed["items"].as_array().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(root);
}
