use super::*;

#[cfg(unix)]
use std::io::{Read, Seek, SeekFrom};
#[cfg(unix)]
use std::os::unix::fs::{symlink, PermissionsExt};

struct TestDir(PathBuf);

impl TestDir {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "nac-codex-auth-{label}-{}",
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    fn assert_no_temp_files(&self) {
        let names = fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".tmp-"))
            .collect::<Vec<_>>();
        assert!(names.is_empty(), "temporary files remain: {names:?}");
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write_credential(path: &Path, contents: impl AsRef<[u8]>) {
    fs::write(path, contents).unwrap();
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
}

fn stored_codex_auth(access: &str) -> StoredCodexAuth {
    StoredCodexAuth {
        auth_type: AUTH_TYPE.to_string(),
        access: access.to_string(),
        refresh: "refresh-token".to_string(),
        expires_at_ms: 123_456,
        account_id: "account-1".to_string(),
    }
}

#[test]
fn codex_lock_contends_until_release() {
    super::super::auth_store::assert_lock_contention_and_release("codex", lock_file, unlock_file);
}

#[test]
fn codex_secure_read_rejects_invalid_provider_schema_and_blank_fields() {
    let dir = TestDir::new("read-invalid-content");
    let path = dir.path("auth.json");
    for invalid in [
        r#"{"type":"other","access":"a","refresh":"r","expires_at_ms":1,"account_id":"id"}"#,
        r#"{"type":"chatgpt-codex","access":7}"#,
        r#"{"type":"chatgpt-codex","access":" ","refresh":"r","expires_at_ms":1,"account_id":"id"}"#,
        r#"{"type":"chatgpt-codex","access":"a","refresh":"\t","expires_at_ms":1,"account_id":"id"}"#,
        r#"{"type":"chatgpt-codex","access":"a","refresh":"r","expires_at_ms":1,"account_id":""}"#,
    ] {
        write_credential(&path, invalid);
        let error = read_auth_file_optional_from_path(&path).unwrap_err();
        assert!(
            error
                .downcast_ref::<StoredCodexAuthConfigurationError>()
                .is_some(),
            "content error was not typed: {error:#}"
        );
        assert!(!error.to_string().contains("access-test"));
    }
}

#[test]
fn codex_secure_read_accepts_mode_0600_regular_file() {
    let dir = TestDir::new("read-regular");
    let path = dir.path("auth.json");
    write_auth_file_to_path(&path, &stored_codex_auth("regular-access")).unwrap();

    #[cfg(unix)]
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let auth = read_auth_file_optional_from_path(&path).unwrap().unwrap();

    assert_eq!(auth.access, "regular-access");
    assert_eq!(auth.refresh, "refresh-token");
}

#[cfg(unix)]
#[test]
fn codex_secure_read_rejects_group_or_other_permissions_without_reading() {
    let dir = TestDir::new("read-permissions");
    let path = dir.path("auth.json");
    write_auth_file_to_path(
        &path,
        &stored_codex_auth("secret-must-not-appear-in-errors"),
    )
    .unwrap();

    for mode in [0o644, 0o660] {
        fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();

        let error = read_auth_file_optional_from_path(&path).unwrap_err();

        assert!(
            error
                .downcast_ref::<super::super::auth_store::UnsafeCredentialPermissionsError>()
                .is_some(),
            "mode {mode:04o} did not produce the safety error: {error:#}"
        );
        assert!(error.to_string().contains(&format!("{mode:04o}")));
        assert!(error.to_string().contains("mode to 0600"));
        assert!(!error.to_string().contains("secret-must-not-appear"));
    }
}

#[test]
fn codex_secure_read_rejects_non_regular_path() {
    let dir = TestDir::new("read-directory");
    let path = dir.path("auth.json");
    fs::create_dir(&path).unwrap();

    let error = read_auth_file_optional_from_path(&path).unwrap_err();

    assert!(error.to_string().contains("non-regular credential path"));
}

#[cfg(unix)]
#[test]
fn codex_secure_read_rejects_symlink_without_reading_target() {
    let dir = TestDir::new("read-symlink");
    let target = dir.path("target.json");
    let path = dir.path("auth.json");
    write_auth_file_to_path(&target, &stored_codex_auth("target-access")).unwrap();
    let target_before = fs::read(&target).unwrap();
    symlink(&target, &path).unwrap();

    let error = read_auth_file_optional_from_path(&path).unwrap_err();

    assert!(error.to_string().contains("symlink credential path"));
    assert_eq!(fs::read(&target).unwrap(), target_before);
    assert!(fs::symlink_metadata(&path)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[cfg(unix)]
#[test]
fn codex_atomic_write_creates_mode_0600_and_replaces_by_rename() {
    let dir = TestDir::new("replace");
    let path = dir.path("auth.json");
    fs::write(&path, "old-valid-content").unwrap();
    let mut old_file = File::open(&path).unwrap();

    write_auth_file_to_path(&path, &stored_codex_auth("new-access")).unwrap();

    let current: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(current["access"], "new-access");
    let mut old_contents = String::new();
    old_file.seek(SeekFrom::Start(0)).unwrap();
    old_file.read_to_string(&mut old_contents).unwrap();
    assert_eq!(old_contents, "old-valid-content");
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    dir.assert_no_temp_files();
}

#[cfg(unix)]
#[test]
fn codex_pre_rename_failure_preserves_existing_file_and_cleans_temp() {
    let dir = TestDir::new("failure");
    let path = dir.path("auth.json");
    fs::write(&path, "old-valid-content").unwrap();

    let result = atomic_replace_auth_file(&path, |file| {
        file.write_all(b"partial")?;
        Err(io::Error::other("injected pre-rename failure"))
    });

    assert!(result.is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "old-valid-content");
    dir.assert_no_temp_files();
}

#[cfg(unix)]
#[test]
fn codex_write_rejects_symlink_destination_without_touching_target() {
    let dir = TestDir::new("symlink");
    let target = dir.path("target.json");
    let destination = dir.path("auth.json");
    fs::write(&target, "target-valid-content").unwrap();
    symlink(&target, &destination).unwrap();

    let error =
        write_auth_file_to_path(&destination, &stored_codex_auth("replacement")).unwrap_err();

    assert!(error.to_string().contains("symlink credential destination"));
    assert_eq!(fs::read_to_string(&target).unwrap(), "target-valid-content");
    assert!(fs::symlink_metadata(&destination)
        .unwrap()
        .file_type()
        .is_symlink());
    dir.assert_no_temp_files();
}

#[cfg(unix)]
#[test]
fn codex_lock_is_private_and_rejects_symlink() {
    let dir = TestDir::new("lock");
    let lock_path = dir.path("auth.auth.json.lock");
    let lock = FileLock::acquire(&lock_path).unwrap();
    assert_eq!(
        fs::metadata(&lock_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    drop(lock);

    fs::remove_file(&lock_path).unwrap();
    let target = dir.path("lock-target");
    fs::write(&target, "unchanged").unwrap();
    symlink(&target, &lock_path).unwrap();
    let error = FileLock::acquire(&lock_path)
        .err()
        .expect("symlink lock accepted");
    assert!(error.to_string().contains("symlink auth lock"));
    assert_eq!(fs::read_to_string(target).unwrap(), "unchanged");
}

#[test]
fn codex_logout_removes_malformed_auth_and_preserves_arcee() {
    let dir = TestDir::new("logout-malformed");
    let codex_path = dir.path("auth.json");
    let arcee_path = dir.path("arcee_auth.json");
    let arcee = r#"{"type":"arcee_api_key","api_key":"rcai-valid"}"#;
    write_credential(&codex_path, "{ malformed");
    fs::write(&arcee_path, arcee).unwrap();

    assert!(remove_codex_auth_file_for_logout(&codex_path).unwrap());

    assert!(!codex_path.exists());
    assert_eq!(fs::read_to_string(arcee_path).unwrap(), arcee);
}

#[test]
fn codex_logout_preserves_coexisting_arcee_auth() {
    let dir = TestDir::new("logout-coexistence");
    let codex_path = dir.path("auth.json");
    let arcee_path = dir.path("arcee_auth.json");
    let arcee = r#"{"type":"arcee_api_key","api_key":"rcai-valid"}"#;
    fs::write(&arcee_path, arcee).unwrap();
    write_auth_file_to_path(&codex_path, &stored_codex_auth("access-token")).unwrap();

    assert!(remove_codex_auth_file_for_logout(&codex_path).unwrap());

    assert!(!codex_path.exists());
    assert_eq!(fs::read_to_string(arcee_path).unwrap(), arcee);
}

#[test]
fn codex_logout_is_idempotent_when_auth_is_missing() {
    let dir = TestDir::new("logout-missing");
    let path = dir.path("auth.json");

    assert!(!remove_codex_auth_file_for_logout(&path).unwrap());
    assert!(!remove_codex_auth_file_for_logout(&path).unwrap());
}

#[test]
fn codex_logout_removes_typed_malformed_codex_auth() {
    let dir = TestDir::new("logout-typed-codex");
    let path = dir.path("auth.json");
    write_credential(&path, r#"{"type":"chatgpt-codex","access":7}"#);

    assert!(remove_codex_auth_file_for_logout(&path).unwrap());
    assert!(!path.exists());
}

#[test]
fn codex_logout_preserves_valid_foreign_and_unknown_records() {
    let dir = TestDir::new("logout-foreign");
    let path = dir.path("auth.json");
    let arcee = r#"{"type":"arcee_api_key","api_key":"rcai-valid"}"#;
    write_credential(&path, arcee);
    assert!(!remove_codex_auth_file_for_logout(&path).unwrap());
    assert_eq!(fs::read_to_string(&path).unwrap(), arcee);

    let unknown = r#"{"type":"future-provider","token":"keep-me"}"#;
    fs::write(&path, unknown).unwrap();
    assert!(!remove_codex_auth_file_for_logout(&path).unwrap());
    assert_eq!(fs::read_to_string(path).unwrap(), unknown);
}

#[cfg(unix)]
#[test]
fn codex_logout_unlinks_symlink_without_touching_target() {
    let dir = TestDir::new("logout-symlink");
    let target = dir.path("target.json");
    let path = dir.path("auth.json");
    fs::write(&target, "target-credentials").unwrap();
    symlink(&target, &path).unwrap();

    assert!(remove_codex_auth_file_for_logout(&path).unwrap());

    assert!(fs::symlink_metadata(&path).is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), "target-credentials");
}

#[test]
fn codex_endpoint_matrix_accepts_only_canonical_chatgpt_base() {
    for accepted in [
        "https://chatgpt.com/backend-api",
        "https://chatgpt.com/backend-api/",
        "https://chatgpt.com:443/backend-api",
    ] {
        let parsed = validate_base_url(accepted)
            .unwrap_or_else(|error| panic!("rejected {accepted}: {error:#}"));
        assert_eq!(parsed.host_str(), Some("chatgpt.com"));
        assert_eq!(parsed.port_or_known_default(), Some(443));
        assert_eq!(codex_responses_url(accepted).unwrap(), CODEX_RESPONSES_URL);
    }

    for rejected in [
        "http://chatgpt.com/backend-api",
        "https://chatgpt.com:444/backend-api",
        "https://api.chatgpt.com/backend-api",
        "https://chatgpt.com.evil.example/backend-api",
        "https://chatgpt.com/",
        "https://chatgpt.com/backend-api/codex",
        "https://chatgpt.com/backend-api/codex/responses",
        "https://chatgpt.com/backend-api?next=https://evil.example",
        "https://chatgpt.com/backend-api#fragment",
        "https://user@chatgpt.com/backend-api",
        "https://chatgpt.com/%62ackend-api",
    ] {
        assert!(
            validate_base_url(rejected).is_err(),
            "accepted unapproved Codex base {rejected}"
        );
    }
}

#[tokio::test]
async fn codex_model_http_client_does_not_follow_or_replay_redirects() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    use std::net::TcpListener;

    let destination = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    destination.set_nonblocking(true).unwrap();
    let destination_url = format!("http://{}", destination.local_addr().unwrap());
    let source = ScriptedServer::start(vec![ScriptedResponse::redirect(
        "307 Temporary Redirect",
        format!("{destination_url}/capture"),
        "blocked",
    )]);
    let secret = "codex-secret-must-not-replay";

    let response = super::client::no_redirect_model_client()
        .unwrap()
        .post(format!("{}/backend-api/codex/responses", source.base_url))
        .bearer_auth(secret)
        .body("prompt-must-not-replay")
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
    let requests = source.finish();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].headers.get("authorization").map(String::as_str),
        Some("Bearer codex-secret-must-not-replay")
    );
    assert_eq!(requests[0].body, b"prompt-must-not-replay");
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert!(
        destination.accept().is_err(),
        "redirect destination received replay"
    );
}

#[test]
fn extracts_account_id_from_nested_jwt_claim() {
    let token = concat!(
        "e30.",
        "eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOns",
        "iY2hhdGdwdF9hY2NvdW50X2lkIjoid29ya3NwYWNlLTEyMyJ9fQ.",
        "sig"
    );

    assert_eq!(extract_account_id(token).as_deref(), Some("workspace-123"));
}

#[test]
fn codex_request_reasoning_is_driven_only_by_explicit_effort() {
    let messages = [
        Message::System {
            content: "primary instructions".to_string(),
        },
        Message::System {
            content: "agents instructions".to_string(),
        },
        Message::User {
            content: "hello".to_string(),
        },
    ];
    let levels = catalog::resolve(BackendKind::ChatGptCodexResponses, "gpt-5.5").thinking_level_map;
    let absent =
        codex_responses_request("gpt-5.5", None, &messages, &[], &levels, Some("session-1"));
    assert_eq!(absent["model"], "gpt-5.5");
    assert_eq!(
        absent["instructions"],
        "primary instructions\n\nagents instructions"
    );
    assert_eq!(absent["input"], json!([{"role":"user","content":"hello"}]));
    assert_eq!(absent["store"], false);
    assert_eq!(absent["stream"], true);
    assert_eq!(absent["text"]["verbosity"], "low");
    // The summary is requested unconditionally; only the effort is opt-in.
    assert_eq!(absent["reasoning"], json!({"summary": "auto"}));
    assert_eq!(absent["include"], json!(["reasoning.encrypted_content"]));
    assert_eq!(absent["prompt_cache_key"], "session-1");
    assert!(absent.get("tools").is_none());
    assert!(absent.get("tool_choice").is_none());
    assert!(absent.get("parallel_tool_calls").is_none());

    let with_tools = codex_responses_request(
        "gpt-5.5",
        None,
        &messages,
        &[ToolDefinition {
            def_type: "function".to_string(),
            function: crate::types::FunctionDef {
                name: "read".to_string(),
                description: "Read a file".to_string(),
                parameters: json!({"type": "object"}),
            },
        }],
        &levels,
        Some("session-1"),
    );
    assert!(with_tools.get("tools").is_some());
    assert_eq!(with_tools["tool_choice"], "auto");
    assert_eq!(with_tools["parallel_tool_calls"], true);

    for effort in [
        ReasoningEffort::None,
        ReasoningEffort::Minimal,
        ReasoningEffort::Low,
        ReasoningEffort::Medium,
        ReasoningEffort::High,
        ReasoningEffort::Xhigh,
    ] {
        let request =
            codex_responses_request("gpt-5.5", Some(effort), &messages, &[], &levels, None);
        assert_eq!(request["reasoning"]["effort"], effort.as_str());
        assert_eq!(request["include"][0], "reasoning.encrypted_content");
    }

    // The wire value comes from the passed catalog map, not adapter code.
    let custom = ThinkingLevelMap(std::collections::BTreeMap::from([(
        ReasoningEffort::Xhigh,
        Some("tier-four".to_string()),
    )]));
    let request = codex_responses_request(
        "gpt-5.5",
        Some(ReasoningEffort::Xhigh),
        &messages,
        &[],
        &custom,
        None,
    );
    assert_eq!(request["reasoning"]["effort"], "tier-four");
}

#[test]
fn codex_request_preserves_nullable_new_delegation_contracts() {
    let messages = [Message::User {
        content: "delegate this work".to_string(),
    }];
    let levels =
        catalog::resolve(BackendKind::ChatGptCodexResponses, "gpt-5.6-sol").thinking_level_map;
    let definitions = crate::tools::direct_with_orchestrator_tool_definitions(false);
    let request = codex_responses_request(
        "gpt-5.6-sol",
        None,
        &messages,
        &definitions,
        &levels,
        Some("session-1"),
    );
    let tools = request["tools"].as_array().expect("Codex request tools");

    for (tool_name, session_id) in [("session_spawn", "child_session_id")] {
        let tool = tools
            .iter()
            .find(|tool| tool["name"] == tool_name)
            .unwrap_or_else(|| panic!("missing {tool_name} in Codex request"));
        let parameters = &tool["parameters"];
        let properties = parameters["properties"]
            .as_object()
            .expect("launch properties");
        let required = parameters["required"]
            .as_array()
            .expect("launch required fields")
            .iter()
            .map(|value| value.as_str().expect("required field name"))
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            required,
            properties.keys().map(String::as_str).collect(),
            "{tool_name} wire schema must be strict-compatible"
        );
        assert_eq!(
            parameters["properties"][session_id]["type"],
            json!(["string", "null"]),
            "{tool_name} wire schema must preserve new-session null semantics"
        );
    }
}

#[test]
fn codex_session_headers_share_the_prompt_cache_key() {
    let request = apply_codex_session_headers(
        Client::new().post("https://chatgpt.com/backend-api/codex/responses"),
        Some("session-1"),
    )
    .build()
    .unwrap();
    assert_eq!(request.headers()["session-id"], "session-1");
    assert_eq!(request.headers()["x-client-request-id"], "session-1");
}

#[test]
fn parses_codex_sse_final_response() {
    let body = concat!(
        "event: response.output_item.done\n",
        "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello\"}]}}\n\n",
        "event: response.completed\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[],\"usage\":{\"input_tokens\":1,\"output_tokens\":2,\"total_tokens\":3}}}\n\n",
        "data: [DONE]\n\n"
    );

    let parsed = parse_codex_sse_response(body).unwrap();
    assert_eq!(parsed["status"], "completed");
    assert_eq!(parsed["output"][0]["type"], "message");
    assert_eq!(parsed["output"][0]["content"][0]["text"], "hello");
    assert_eq!(parsed["usage"]["total_tokens"], 3);
}

#[test]
fn buffered_codex_sse_preserves_transient_retry_metadata() {
    let body = concat!(
        "data: {\"type\":\"response.failed\",\"response\":{\"error\":",
        "{\"type\":\"overloaded_error\",\"message\":\"You can retry your request.\"}}}\n\n"
    );
    let error = parse_codex_success_body(
        "https://chatgpt.com/backend-api/codex/responses",
        StatusCode::OK,
        Some("application/json"),
        body,
        &[],
    )
    .unwrap_err();

    assert!(error.can_retry_stream());
    assert!(error.to_string().contains("You can retry your request"));
}

async fn scripted_codex_sse_server(
    bodies: Vec<&'static str>,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for body in bodies {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 16 * 1024];
            let _ = stream.read(&mut request).await.unwrap();
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(headers.as_bytes()).await.unwrap();
            stream.write_all(body.as_bytes()).await.unwrap();
            stream.flush().await.unwrap();
        }
    });
    (address, server)
}

fn completed_codex_sse() -> &'static str {
    concat!(
        "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"thinking\"}\n\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"complete\"}\n\n",
        "data: {\"type\":\"response.output_item.done\",\"output_index\":0,",
        "\"item\":{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",",
        "\"text\":\"complete\"}]}}\n\n",
        "data: {\"type\":\"response.completed\",\"response\":",
        "{\"status\":\"completed\",\"output\":[]}}\n\n"
    )
}

#[tokio::test]
async fn retries_transient_codex_sse_error_before_observable_output() {
    use std::sync::mpsc;
    use tokio::time::timeout;

    let overloaded = concat!(
        "data: {\"type\":\"error\",\"error\":{\"code\":\"server_error\",",
        "\"message\":\"Our servers are currently overloaded. Please try again later.\"}}\n\n"
    );
    let (address, server) =
        scripted_codex_sse_server(vec![overloaded, completed_codex_sse()]).await;
    let (send, receive) = mpsc::channel();
    let sink = move |delta| send.send(delta).expect("delta receiver should remain live");
    let response = timeout(
        Duration::from_secs(3),
        post_codex_json_with_retry_delay(
            &Client::new(),
            &format!("http://{address}"),
            &json!({"stream": true}),
            &stored_codex_auth("access-token"),
            None,
            Some(&sink),
            |_| Duration::ZERO,
        ),
    )
    .await
    .expect("transient stream retry timed out")
    .unwrap();

    timeout(Duration::from_secs(1), server)
        .await
        .expect("expected exactly two requests")
        .unwrap();
    assert_eq!(response["output"][0]["content"][0]["text"], "complete");
    assert_eq!(
        receive.try_iter().collect::<Vec<_>>(),
        vec![
            ModelStreamDelta::reasoning("thinking"),
            ModelStreamDelta::text("complete"),
        ]
    );
}

#[tokio::test]
async fn does_not_retry_permanent_or_malformed_codex_sse_error() {
    use tokio::time::timeout;

    let permanent = concat!(
        "data: {\"type\":\"error\",\"error\":{\"code\":\"insufficient_quota\",",
        "\"message\":\"quota exhausted\"}}\n\n"
    );
    for (body, expected_error) in [
        (permanent, "quota exhausted"),
        ("data: {not-json}\n\n", "invalid SSE event"),
    ] {
        let (address, server) = scripted_codex_sse_server(vec![body]).await;
        let error = timeout(
            Duration::from_secs(1),
            post_codex_json_with_retry(
                &Client::new(),
                &format!("http://{address}"),
                &json!({"stream": true}),
                &stored_codex_auth("access-token"),
                None,
                None,
            ),
        )
        .await
        .expect("permanent stream error unexpectedly retried")
        .unwrap_err();

        timeout(Duration::from_secs(1), server)
            .await
            .expect("expected exactly one request")
            .unwrap();
        assert!(error.to_string().contains(expected_error), "{error}");
    }
}

#[tokio::test]
async fn exhausts_transient_codex_sse_retries_with_final_provider_error() {
    use tokio::time::timeout;

    let overloaded = concat!(
        "data: {\"type\":\"response.failed\",\"response\":{\"error\":",
        "{\"type\":\"overloaded_error\",\"message\":\"You can retry your request.\"}}}\n\n"
    );
    let final_overloaded = concat!(
        "data: {\"type\":\"response.failed\",\"response\":{\"error\":",
        "{\"type\":\"overloaded_error\",\"message\":\"final provider failure\"}}}\n\n"
    );
    let mut bodies = vec![overloaded; 9];
    bodies.push(final_overloaded);
    let (address, server) = scripted_codex_sse_server(bodies).await;
    let error = timeout(
        Duration::from_secs(2),
        post_codex_json_with_retry_delay(
            &Client::new(),
            &format!("http://{address}"),
            &json!({"stream": true}),
            &stored_codex_auth("access-token"),
            None,
            None,
            |_| Duration::ZERO,
        ),
    )
    .await
    .expect("bounded transient stream retries timed out")
    .unwrap_err();

    timeout(Duration::from_secs(1), server)
        .await
        .expect("expected exactly ten requests")
        .unwrap();
    assert!(error.to_string().contains("final provider failure"));
}

#[tokio::test]
async fn does_not_retry_codex_sse_error_after_observable_delta() {
    use std::sync::mpsc;
    use tokio::time::timeout;

    let partial_text = concat!(
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n",
        "data: {\"type\":\"error\",\"error\":{\"code\":\"server_error\",",
        "\"message\":\"Our servers are currently overloaded.\"}}\n\n"
    );
    let partial_reasoning = concat!(
        "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"thinking\"}\n\n",
        "data: {\"type\":\"error\",\"error\":{\"code\":\"server_error\",",
        "\"message\":\"Our servers are currently overloaded.\"}}\n\n"
    );
    for (body, expected_delta) in [
        (partial_text, ModelStreamDelta::text("partial")),
        (partial_reasoning, ModelStreamDelta::reasoning("thinking")),
    ] {
        let (address, server) = scripted_codex_sse_server(vec![body]).await;
        let (send, receive) = mpsc::channel();
        let sink = move |delta| send.send(delta).expect("delta receiver should remain live");
        let error = timeout(
            Duration::from_secs(1),
            post_codex_json_with_retry(
                &Client::new(),
                &format!("http://{address}"),
                &json!({"stream": true}),
                &stored_codex_auth("access-token"),
                None,
                Some(&sink),
            ),
        )
        .await
        .expect("post-delta stream error unexpectedly retried")
        .unwrap_err();

        timeout(Duration::from_secs(1), server)
            .await
            .expect("expected exactly one request")
            .unwrap();
        assert!(error.to_string().contains("currently overloaded"));
        assert_eq!(receive.try_iter().collect::<Vec<_>>(), vec![expected_delta]);
    }
}

#[tokio::test]
async fn codex_without_delta_sink_finishes_before_sse_body_closes() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
    use tokio::time::timeout;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (release_server, wait_for_release) = oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = [0; 4096];
        let _ = stream.read(&mut request).await.unwrap();
        let event = concat!(
            "data: {\"type\":\"response.output_item.done\",\"output_index\":0,",
            "\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",",
            "\"call_id\":\"call_1\",\"name\":\"read\",\"arguments\":\"{}\",",
            "\"status\":\"completed\"}}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":",
            "{\"status\":\"completed\",\"output\":[]}}\n\n"
        );
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                  Transfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n",
            )
            .await
            .unwrap();
        stream
            .write_all(format!("{:X}\r\n{event}\r\n", event.len()).as_bytes())
            .await
            .unwrap();
        stream.flush().await.unwrap();

        let _ = wait_for_release.await;
        let _ = stream.write_all(b"0\r\n\r\n").await;
    });

    let result = timeout(
        Duration::from_secs(1),
        post_codex_json_with_retry(
            &Client::new(),
            &format!("http://{address}"),
            &json!({"stream": true}),
            &stored_codex_auth("access-token"),
            None,
            None,
        ),
    )
    .await;

    let _ = release_server.send(());
    server.await.unwrap();
    let response = result
        .expect("terminal event should finish an unobserved Codex stream")
        .unwrap();
    assert_eq!(response["output"][0]["type"], "function_call");
    assert_eq!(response["output"][0]["call_id"], "call_1");
}
