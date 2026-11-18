use super::*;
use crate::model::ModelClient;
use crate::session_service::tests::{
    seed_log_tail, test_active_service, test_direct_active_service,
};
use crate::types::{FunctionCall, ToolCall};

const EXACT_SECRET: &str = "managed-exact-canary-value";

struct ExactSecret;

impl nac_contracts::CommandEnvironmentProvider for ExactSecret {
    fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
        Box::pin(async { self.redaction_snapshot() })
    }
    fn redaction_snapshot(&self) -> Result<nac_contracts::CommandEnvironmentSnapshot> {
        Ok(nac_contracts::CommandEnvironmentSnapshot::from_parts(
            BTreeMap::new(),
            vec![
                EXACT_SECRET.into(),
                "123456789012345678901234567890".into(),
                "1.234567890123456789e+99".into(),
            ],
        ))
    }
    fn worker_environment(&self) -> nac_contracts::WorkerEnvironment {
        Default::default()
    }
}

fn assistant(calls: &[(&str, &str)]) -> Message {
    Message::Assistant {
        content: None,
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: Some(
            calls
                .iter()
                .map(|(id, arguments)| ToolCall {
                    id: (*id).into(),
                    call_type: "function".into(),
                    function: FunctionCall {
                        name: "fetch".into(),
                        arguments: (*arguments).into(),
                    },
                })
                .collect(),
        ),
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    }
}

fn result(call_id: &str, text: impl Into<String>) -> Message {
    Message::Tool {
        tool_call_id: call_id.into(),
        content: ToolContent::text(text),
    }
}

#[tokio::test]
async fn known_call_returns_full_redacted_arguments_and_output() {
    let (mut parts, store_path) =
        test_direct_active_service("tool_call_content", "session", ModelClient::new_for_test());
    parts
        .service
        .shell_runtime
        .as_mut()
        .unwrap()
        .command_environment = Some(Arc::new(ExactSecret));
    seed_log_tail(
        &parts,
        vec![
            assistant(&[
                (
                    "call-fetch",
                    r#"{"header":"Authorization: Bearer sk-live-canary-123","url":"https://api.example.test/v1"}"#,
                ),
                ("call-pending", r#"{"url":"https://api.example.test/slow"}"#),
            ]),
            result(
                "call-fetch",
                format!(
                    "GET /v1 x-api-key: sk-live-output-456\n\
                     cloning https://deploy:hunter2@git.example.test/repo.git\n\
                     using {EXACT_SECRET}\ndone\n"
                ),
            ),
        ],
    )
    .await;

    let content = parts
        .service
        .tool_call_content("call-fetch")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        content,
        ToolCallContent {
            call_id: "call-fetch".into(),
            arguments:
                r#"{"header":"Authorization: [REDACTED]","url":"https://api.example.test/v1"}"#
                    .into(),
            arguments_truncated: false,
            output: Some(
                "GET /v1 x-api-key: [REDACTED]\n\
                 cloning https://[REDACTED]@git.example.test/repo.git\n\
                 using [REDACTED]\ndone\n"
                    .into()
            ),
            output_truncated: false,
        }
    );
    let pending = parts
        .service
        .tool_call_content("call-pending")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        pending.arguments,
        r#"{"url":"https://api.example.test/slow"}"#
    );
    assert_eq!(pending.output, None);
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn oversized_fields_are_redacted_before_char_boundary_bound() {
    let (parts, store_path) = test_active_service("tool_call_content_bound", "session");
    // The bound falls three bytes into the token; bounding first would leak "AbC".
    let arguments = format!(
        "{} Bearer AbCdEf0123456789",
        "a".repeat(MAX_TOOL_CALL_CONTENT_BYTES - 11)
    );
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("call-large", &arguments)]),
            result("call-large", "€".repeat(MAX_TOOL_CALL_CONTENT_BYTES)),
        ],
    )
    .await;

    let content = parts
        .service
        .tool_call_content("call-large")
        .await
        .unwrap()
        .unwrap();
    assert!(content.arguments_truncated);
    assert_eq!(content.arguments.len(), MAX_TOOL_CALL_CONTENT_BYTES);
    assert!(content.arguments.ends_with(" Bearer [RE"));
    assert!(content.output_truncated);
    let output = content.output.unwrap();
    assert_eq!(output.len(), MAX_TOOL_CALL_CONTENT_BYTES / 3 * 3);
    assert!(output.chars().all(|character| character == '€'));
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn unknown_call_id_yields_none() {
    let (parts, store_path) = test_active_service("tool_call_content_unknown", "session");
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("call-known", "{}")]),
            result("call-known", "ok"),
        ],
    )
    .await;

    assert_eq!(
        parts
            .service
            .tool_call_content("call-missing")
            .await
            .unwrap(),
        None
    );
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn members_under_credential_keys_are_masked_at_any_depth() {
    let (parts, store_path) = test_active_service("tool_call_content_keys", "session");
    seed_log_tail(
        &parts,
        vec![
            assistant(&[(
                "call-login",
                r#"{"username":"ada","password":"hunter2","options":{"api_key":"k-123","retries":3,"headers":[{"Token":"t-1"},{"x-api-key":12345678901234567}]}}"#,
            )]),
            result("call-login", r#"{"secret":{"value":"s-1"},"status":"ok"}"#),
        ],
    )
    .await;

    let content = parts
        .service
        .tool_call_content("call-login")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        content.arguments,
        r#"{"username":"ada","password":"[REDACTED]","options":{"api_key":"[REDACTED]","retries":3,"headers":[{"Token":"[REDACTED]"},{"x-api-key":"[REDACTED]"}]}}"#
    );
    assert_eq!(
        content.output.as_deref(),
        Some(r#"{"secret":"[REDACTED]","status":"ok"}"#)
    );
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn a_call_id_held_twice_names_no_call() {
    let (parts, store_path) = test_active_service("tool_call_content_reused", "session");
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("call_0", r#"{"path":"a.txt"}"#)]),
            result("call_0", "first"),
            assistant(&[("call_0", r#"{"path":"b.txt"}"#), ("call_1", "{}")]),
            result("call_0", "second"),
            result("call_1", "ok"),
        ],
    )
    .await;

    assert_eq!(
        parts.service.tool_call_content("call_0").await.unwrap(),
        None
    );
    let unique = parts
        .service
        .tool_call_content("call_1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(unique.output.as_deref(), Some("ok"));
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn a_diff_keeps_its_rows_when_a_row_ends_in_a_credential_cue() {
    let (parts, store_path) = test_active_service("tool_call_content_rows", "session");
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("call-write", r#"{"path":".env"}"#)]),
            result(
                "call-write",
                r#"{"path":".env","diff":"@@ -0,0 +1,3 @@\n+APIKEY=\n+PORT=3000\n+x-api-key: sk-live-diff-789\n"}"#,
            ),
        ],
    )
    .await;

    let content = parts
        .service
        .tool_call_content("call-write")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        content.output.as_deref(),
        Some(
            r#"{"path":".env","diff":"@@ -0,0 +1,3 @@\n+APIKEY=\n+PORT=3000\n+x-api-key: [REDACTED]\n"}"#
        )
    );
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn numeric_secrets_are_redacted_as_written_without_rounding_other_numbers() {
    let (mut parts, store_path) = test_direct_active_service(
        "tool_call_content_numbers",
        "session",
        ModelClient::new_for_test(),
    );
    parts
        .service
        .shell_runtime
        .as_mut()
        .unwrap()
        .command_environment = Some(Arc::new(ExactSecret));
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("call-numbers", r#"{"values":[123456789012345678901234567890,1.234567890123456789e+99],"count":18446744073709551616,"rate":1e5}"#)]),
            result("call-numbers", r#"{"secret":123456789012345678901234567890,"count":18446744073709551616,"rate":1e5}"#),
        ],
    ).await;
    let content = parts
        .service
        .tool_call_content("call-numbers")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        content.arguments,
        r#"{"values":["[REDACTED]","[REDACTED]"],"count":18446744073709551616,"rate":1e5}"#
    );
    assert_eq!(
        content.output.as_deref(),
        Some(r#"{"secret":"[REDACTED]","count":18446744073709551616,"rate":1e5}"#)
    );
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[test]
fn raw_document_keeps_duplicate_members_and_retains_the_nesting_bound() {
    let text = r#"{"count":1e5,"count":18446744073709551616,"password":"private"}"#;
    assert_eq!(
        redact_document(text, &str::to_owned, &str::to_owned),
        r#"{"count":1e5,"count":18446744073709551616,"password":"[REDACTED]"}"#,
    );
    let too_deep = format!("{}0{}", "[".repeat(129), "]".repeat(129));
    assert!(serde_json::from_str::<Document>(&too_deep).is_err());
}

async fn append_at_end(parts: &SessionServiceParts, messages: Vec<Message>) {
    let start = parts.service.store_backed_transcript().await.unwrap().len() as u64;
    let writer = parts.service.transcript_log.as_ref().unwrap().clone();
    let session_id = parts.service.metadata.session_id.clone().unwrap();
    tokio::task::spawn_blocking(move || writer.append_batch(&session_id, start, &messages))
        .await
        .unwrap()
        .unwrap();
}

async fn trim_from(parts: &SessionServiceParts, tail_idx: u64) {
    let blob_len = parts
        .service
        .session_snapshot
        .lock()
        .await
        .as_ref()
        .map_or(0, |snapshot| snapshot.messages.len() as u64);
    let writer = parts.service.transcript_log.as_ref().unwrap().clone();
    let session_id = parts.service.metadata.session_id.clone().unwrap();
    tokio::task::spawn_blocking(move || writer.delete_from(&session_id, blob_len + tail_idx))
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn a_result_recorded_after_an_earlier_lookup_is_found() {
    let (parts, store_path) = test_active_service("tool_call_content_pending", "session");
    seed_log_tail(&parts, vec![assistant(&[("call-a", "{}")])]).await;
    let pending = parts
        .service
        .tool_call_content("call-a")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pending.output, None);

    append_at_end(
        &parts,
        vec![result("call-a", "done"), assistant(&[("call-b", "{}")])],
    )
    .await;
    let done = parts
        .service
        .tool_call_content("call-a")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(done.output.as_deref(), Some("done"));
    let later = parts
        .service
        .tool_call_content("call-b")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(later.output, None);
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn trimmed_rows_are_never_answered_from_an_earlier_lookup() {
    let (parts, store_path) = test_active_service("tool_call_content_trimmed", "session");
    seed_log_tail(
        &parts,
        vec![
            Message::User {
                content: "go".into(),
            },
            assistant(&[("call-old", r#"{"v":1}"#)]),
            result("call-old", "old"),
        ],
    )
    .await;
    assert!(parts
        .service
        .tool_call_content("call-old")
        .await
        .unwrap()
        .is_some());

    trim_from(&parts, 1).await;
    append_at_end(
        &parts,
        vec![assistant(&[("call-new", "{}")]), result("call-new", "new")],
    )
    .await;
    assert_eq!(
        parts.service.tool_call_content("call-old").await.unwrap(),
        None
    );
    let new = parts
        .service
        .tool_call_content("call-new")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(new.output.as_deref(), Some("new"));

    // An id reused after the trim names its only remaining occurrence...
    append_at_end(
        &parts,
        vec![
            assistant(&[("call-old", r#"{"v":2}"#)]),
            result("call-old", "again"),
        ],
    )
    .await;
    let again = parts
        .service
        .tool_call_content("call-old")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(again.arguments, r#"{"v":2}"#);
    assert_eq!(again.output.as_deref(), Some("again"));

    // ...until a second occurrence makes it name no call again.
    append_at_end(&parts, vec![assistant(&[("call-old", r#"{"v":3}"#)])]).await;
    assert_eq!(
        parts.service.tool_call_content("call-old").await.unwrap(),
        None
    );
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

async fn occurrence_page(parts: &SessionServiceParts, limit: usize) -> MessagesPageSnapshot {
    parts
        .service
        .messages_page(MessagePageRequest {
            before: None,
            limit,
            include_system: true,
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn occurrence_rejects_other_stores_and_divergent_store_copies() {
    let (first, first_path) = test_active_service("occurrence_store_first", "session");
    let (second, second_path) = test_active_service("occurrence_store_second", "session");
    seed_log_tail(
        &first,
        vec![assistant(&[("call", "{}")]), result("call", "first")],
    )
    .await;
    seed_log_tail(
        &second,
        vec![assistant(&[("call", "{}")]), result("call", "first")],
    )
    .await;
    let first_token = occurrence_page(&first, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    let second_token = occurrence_page(&second, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    assert_ne!(first_token, second_token);
    assert_eq!(
        first_token.rsplit(':').nth(2),
        second_token.rsplit(':').nth(2)
    );
    assert_eq!(
        first_token.rsplit(':').next(),
        second_token.rsplit(':').next()
    );
    assert_eq!(
        second
            .service
            .tool_call_content_at("call", Some(&first_token))
            .await
            .unwrap(),
        None
    );

    // A copied store retains the original UUID. Even when row IDs and the
    // store UUID collide, divergent retained content must not be selected.
    let first_connection = rusqlite::Connection::open(&first_path).unwrap();
    let store_id: String = first_connection
        .query_row("SELECT store_id FROM session_completion_feed", [], |row| {
            row.get(0)
        })
        .unwrap();
    let second_connection = rusqlite::Connection::open(&second_path).unwrap();
    second_connection
        .execute(
            "UPDATE session_completion_feed SET store_id = ?1",
            [&store_id],
        )
        .unwrap();
    assert_eq!(
        second
            .service
            .tool_call_content_at("call", Some(&first_token))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("first")
    );
    second_connection
        .execute("UPDATE thread_events SET event_json = replace(event_json, 'first', 'different') WHERE session_id = 'session'", [])
        .unwrap();
    assert_eq!(
        second
            .service
            .tool_call_content_at("call", Some(&first_token))
            .await
            .unwrap(),
        None
    );
    drop(first_connection);
    drop(second_connection);
    drop(first);
    drop(second);
    let _ = std::fs::remove_dir_all(first_path.parent().unwrap());
    let _ = std::fs::remove_dir_all(second_path.parent().unwrap());
}

#[tokio::test]
async fn occurrence_tokens_bind_reused_ids_to_their_own_redacted_batches() {
    let (mut parts, store_path) = test_direct_active_service(
        "tool_occurrence_reuse",
        "session-a",
        ModelClient::new_for_test(),
    );
    parts
        .service
        .shell_runtime
        .as_mut()
        .unwrap()
        .command_environment = Some(Arc::new(ExactSecret));
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("call_0", "{}")]),
            result("call_0", format!("first {EXACT_SECRET}")),
            assistant(&[("call_0", "{}")]),
            result("call_0", "second"),
        ],
    )
    .await;
    let page = occurrence_page(&parts, 100).await;
    let (all_indices, all_messages, all_occurrences) = parts
        .service
        .all_store_transcript_with_occurrences()
        .await
        .unwrap();
    assert_eq!(all_indices, page.canonical_message_indices);
    assert_eq!(
        serde_json::to_value(&all_messages).unwrap(),
        serde_json::to_value(&page.messages).unwrap()
    );
    assert_eq!(all_occurrences, page.tool_call_occurrences);
    let tokens: Vec<String> = page
        .tool_call_occurrences
        .iter()
        .flatten()
        .cloned()
        .collect();
    assert_eq!(tokens.len(), 2);
    assert_eq!(
        parts.service.tool_call_content("call_0").await.unwrap(),
        None
    );
    assert_eq!(
        parts
            .service
            .tool_call_content_at("call_0", Some(&tokens[0]))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("first [REDACTED]")
    );
    assert_eq!(
        parts
            .service
            .tool_call_content_at("call_0", Some(&tokens[1]))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("second")
    );
    let tail = occurrence_page(&parts, 2).await;
    assert!(tail
        .tool_call_occurrences
        .contains(&Some(tokens[1].clone())));
    assert_eq!(
        parts
            .service
            .tool_call_content_at("other", Some(&tokens[0]))
            .await
            .unwrap(),
        None
    );
    let (other, other_path) = test_direct_active_service(
        "tool_occurrence_other",
        "session-b",
        ModelClient::new_for_test(),
    );
    seed_log_tail(
        &other,
        vec![
            assistant(&[("call_0", "{}")]),
            result("call_0", "wrong session"),
        ],
    )
    .await;
    assert_eq!(
        other
            .service
            .tool_call_content_at("call_0", Some(&tokens[0]))
            .await
            .unwrap(),
        None
    );
    drop(other);
    let _ = std::fs::remove_dir_all(other_path.parent().unwrap());
    drop(parts);
    let (reopened, _) = super::super::tests::test_direct_active_service_at(
        "session-a",
        ModelClient::new_for_test(),
        store_path.clone(),
    );
    assert_eq!(
        reopened
            .service
            .tool_call_content_at("call_0", Some(&tokens[1]))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("second")
    );
    drop(reopened);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn occurrence_rejects_two_results_for_one_call() {
    let (parts, store_path) = test_active_service("occurrence_duplicate_results", "session");
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("same", "{}")]),
            result("same", "one"),
            result("same", "two"),
        ],
    )
    .await;
    let token = occurrence_page(&parts, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    assert_eq!(
        parts
            .service
            .tool_call_content_at("same", Some(&token))
            .await
            .unwrap(),
        None
    );
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn occurrence_token_rejects_trimmed_or_replaced_results_and_same_batch_ambiguity() {
    let (parts, store_path) = test_active_service("tool_occurrence_trim", "session");
    seed_log_tail(
        &parts,
        vec![assistant(&[("same", "{}")]), result("same", "old")],
    )
    .await;
    let token = occurrence_page(&parts, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    trim_from(&parts, 1).await;
    append_at_end(&parts, vec![result("same", "replacement")]).await;
    assert_eq!(
        parts
            .service
            .tool_call_content_at("same", Some(&token))
            .await
            .unwrap(),
        None
    );
    let replacement = occurrence_page(&parts, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    assert_ne!(token, replacement);
    assert_eq!(
        parts
            .service
            .tool_call_content_at("same", Some(&replacement))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("replacement")
    );
    trim_from(&parts, 0).await;
    append_at_end(
        &parts,
        vec![
            assistant(&[("same", "{}"), ("same", "{}")]),
            result("same", "one"),
            result("same", "two"),
        ],
    )
    .await;
    let ambiguous = occurrence_page(&parts, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    assert_eq!(
        parts
            .service
            .tool_call_content_at("same", Some(&ambiguous))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        parts
            .service
            .tool_call_content_at("same", Some(&replacement))
            .await
            .unwrap(),
        None
    );
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn legacy_blob_occurrences_are_version_bound_and_id_only_stays_fail_closed() {
    let (parts, store_path) = test_direct_active_service(
        "tool_occurrence_legacy",
        "session",
        ModelClient::new_for_test(),
    );
    {
        let mut snapshot = parts.service.session_snapshot.lock().await;
        let messages = &mut snapshot.as_mut().unwrap().messages;
        messages.extend([
            assistant(&[("same", "{}")]),
            result("same", "one"),
            assistant(&[("same", "{}")]),
            result("same", "two"),
        ]);
    }
    let page = occurrence_page(&parts, 100).await;
    let tokens: Vec<String> = page
        .tool_call_occurrences
        .iter()
        .flatten()
        .cloned()
        .collect();
    assert_eq!(tokens.len(), 2);
    assert_eq!(parts.service.tool_call_content("same").await.unwrap(), None);
    assert_eq!(
        parts
            .service
            .tool_call_content_at("same", Some(&tokens[0]))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("one")
    );
    assert_eq!(
        parts
            .service
            .tool_call_content_at("same", Some(&tokens[1]))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("two")
    );
    {
        let mut snapshot = parts.service.session_snapshot.lock().await;
        snapshot.as_mut().unwrap().messages.push(Message::User {
            content: "new blob".into(),
        });
    }
    assert_eq!(
        parts
            .service
            .tool_call_content_at("same", Some(&tokens[0]))
            .await
            .unwrap(),
        None
    );
    let fresh = occurrence_page(&parts, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    assert_ne!(fresh, tokens[0]);
    assert_eq!(
        parts
            .service
            .tool_call_content_at("same", Some(&fresh))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("one")
    );
    let stored = parts
        .service
        .session_snapshot
        .lock()
        .await
        .as_ref()
        .unwrap()
        .clone();
    crate::sessions::save_session(&store_path, &stored).unwrap();
    drop(parts);
    let (reopened, _) = super::super::tests::test_direct_active_service_at(
        "session",
        ModelClient::new_for_test(),
        store_path.clone(),
    );
    assert_eq!(
        reopened
            .service
            .tool_call_content_at("same", Some(&fresh))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("one")
    );
    drop(reopened);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn pending_occurrence_requires_a_fresh_batch_after_append_or_revert() {
    let (parts, store_path) = test_active_service("tool_occurrence_pending", "session");
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("one", "{}"), ("two", "{}")]),
            result("two", "other"),
        ],
    )
    .await;
    let token = occurrence_page(&parts, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    assert_eq!(
        parts
            .service
            .tool_call_content_at("one", Some(&token))
            .await
            .unwrap()
            .unwrap()
            .output,
        None
    );
    append_at_end(&parts, vec![result("one", "settled")]).await;
    assert_eq!(
        parts
            .service
            .tool_call_content_at("one", Some(&token))
            .await
            .unwrap(),
        None
    );
    let settled_token = occurrence_page(&parts, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    assert_eq!(
        parts
            .service
            .tool_call_content_at("one", Some(&settled_token))
            .await
            .unwrap()
            .unwrap()
            .output
            .as_deref(),
        Some("settled")
    );
    // Replacing a retained prefix row invalidates the old token even if the
    // assistant row itself remains at the same transcript index.
    trim_from(&parts, 1).await;
    append_at_end(
        &parts,
        vec![result("two", "replacement"), result("one", "wrong")],
    )
    .await;
    assert_eq!(
        parts
            .service
            .tool_call_content_at("one", Some(&settled_token))
            .await
            .unwrap(),
        None
    );
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn occurrence_lookup_uses_the_same_output_bound_as_id_only() {
    let (parts, store_path) = test_active_service("tool_occurrence_bound", "session");
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("call", "{}")]),
            result("call", "x".repeat(MAX_TOOL_CALL_CONTENT_BYTES + 10)),
        ],
    )
    .await;
    let token = occurrence_page(&parts, 100)
        .await
        .tool_call_occurrences
        .into_iter()
        .flatten()
        .next()
        .unwrap();
    let content = parts
        .service
        .tool_call_content_at("call", Some(&token))
        .await
        .unwrap()
        .unwrap();
    assert!(content.output_truncated);
    assert_eq!(content.output.unwrap().len(), MAX_TOOL_CALL_CONTENT_BYTES);
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
