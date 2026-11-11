//! Public MCP transcript identity, pagination and read-to-revert contracts.
use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use nac_core::{
    session_service::{MessagePageMetadata, MessagesPageSnapshot},
    sessions,
    types::Message,
};
use serde_json::Value;
use tower::ServiceExt;

// Exercise JSON-RPC tools/call through the actual streamable HTTP service,
// not the projection or a hand-built approximation of the tool result.
async fn call(manager: &SessionManager, name: &str, arguments: Value) -> Value {
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": name, "arguments": arguments, "_meta": {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {}
        }}
    });
    let response = streamable_http_service(manager.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("host", "localhost")
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .header("mcp-protocol-version", "2026-07-28")
                .header("mcp-method", "tools/call")
                .header("mcp-name", name)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let bytes = to_bytes(Body::new(response.into_body()), 256 * 1024)
        .await
        .unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap();
    let data = body
        .lines()
        .find_map(|line| line.strip_prefix("data:"))
        .unwrap();
    let response: Value = serde_json::from_str(data.trim()).unwrap();
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

fn success(result: Value) -> Value {
    assert_ne!(result["isError"], true, "{result}");
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}

fn rejected(result: Value, expected: &str) {
    assert_eq!(result["isError"], true, "{result}");
    assert!(
        result["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains(expected),
        "{result}"
    );
}

fn system(content: &str) -> Message {
    Message::System {
        content: content.into(),
    }
}

fn user(content: &str) -> Message {
    Message::User {
        content: content.into(),
    }
}

fn assistant(content: &str) -> Message {
    Message::Assistant {
        content: Some(content.into()),
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: None,
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    }
}

fn history() -> Vec<Message> {
    vec![
        system("head"),
        user("first"),
        assistant("first answer"),
        system("interspersed"),
        user("second"),
        assistant("second answer"),
        system("snapshot end"),
        user("third"),
        assistant("third answer"),
        user("fourth"),
        assistant("fourth answer"),
    ]
}

// Use the supported snapshot/log fixture APIs. Systems live in the historical
// snapshot prefix; ordinary commit points append only non-System log rows.
fn seed(root: &std::path::Path, id: &str, messages: &[Message], blob_len: usize) {
    crate::tests::seed_direct_session(root, id);
    let path = root.join("store.db");
    let mut snapshot = sessions::load_session(&path, id).unwrap();
    snapshot.messages = messages[..blob_len].to_vec();
    sessions::save_session(&path, &snapshot).unwrap();
    let writer = nac_core::store::TranscriptLogWriter::new(&path).unwrap();
    for (index, message) in messages.iter().enumerate().skip(blob_len) {
        writer.append(id, index as u64, message).unwrap();
    }
}

fn root() -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("nac-mcp-transcript-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

async fn finish(manager: SessionManager, root: std::path::PathBuf) {
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn mcp_transcript_indices_are_canonical_across_filters_and_pages() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = root();
    let _env = crate::tests::ScopedModelEnv::isolated(&root.join("home"), Some("fixture-key"));
    let messages = history();
    seed(&root, "direct", &messages, 7);
    let writer = nac_core::store::TranscriptLogWriter::new(&root.join("store.db")).unwrap();
    let times = writer.read_tail_window_times("direct", 7, 0, 4).unwrap();
    let manager = crate::tests::test_manager(&root);
    for filter in [None, Some(true), Some(false)] {
        let expected: Vec<_> = messages
            .iter()
            .enumerate()
            .filter(|(_, message)| {
                filter != Some(false) || !matches!(message, Message::System { .. })
            })
            .map(|(index, message)| {
                json!({
                    "transcript_index": index,
                    "role": message_role(message), "content": message_content(message),
                    "created_at": if index < 7 { None } else { Some(&times[index - 7]) },
                })
            })
            .collect();
        for limit in [1, 2, 3, 100] {
            let mut before = None;
            let mut collected = Vec::new();
            loop {
                let mut arguments = json!({"session_id": "direct", "limit": limit});
                if let Some(filter) = filter {
                    arguments["include_system"] = json!(filter);
                }
                if let Some(before) = before {
                    arguments["before"] = json!(before);
                }
                let page = success(call(&manager, "get_messages", arguments).await);
                let end = before.unwrap_or(expected.len());
                let start = end.saturating_sub(limit);
                assert_eq!(
                    page,
                    json!({
                        "messages": expected[start..end],
                        "page": {"start": start, "end": end, "total": expected.len(), "has_older": start > 0},
                    }),
                    "filter={filter:?} limit={limit} before={before:?}"
                );
                let mut older = page["messages"].as_array().unwrap().clone();
                older.extend(collected);
                collected = older;
                if !page["page"]["has_older"].as_bool().unwrap() {
                    break;
                }
                // Deliberately use the page cursor, not the canonical identity.
                before = Some(page["page"]["start"].as_u64().unwrap() as usize);
            }
            assert_eq!(collected, expected, "no skipped or duplicate visible rows");
        }
        for before in [0, usize::MAX] {
            let mut arguments = json!({"session_id": "direct", "before": before, "limit": 0});
            if let Some(filter) = filter {
                arguments["include_system"] = json!(filter);
            }
            let page = success(call(&manager, "get_messages", arguments).await);
            let end = before.min(expected.len());
            let start = end.saturating_sub(1);
            assert_eq!(page["messages"], json!(expected[start..end]));
            assert_eq!(
                page["page"],
                json!({"start": start, "end": end, "total": expected.len(), "has_older": start > 0})
            );
        }
    }
    finish(manager, root).await;
}

#[tokio::test]
async fn mcp_transcript_empty_and_system_only_pages_keep_existing_shape() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = root();
    let _env = crate::tests::ScopedModelEnv::isolated(&root.join("home"), Some("fixture-key"));
    seed(&root, "empty", &[], 0);
    seed(&root, "system", &[system("only")], 1);
    let manager = crate::tests::test_manager(&root);
    for id in ["empty", "system"] {
        for include_system in [false, true] {
            let page = success(
                call(
                    &manager,
                    "get_messages",
                    json!({"session_id": id, "include_system": include_system}),
                )
                .await,
            );
            let expected = if id == "system" && include_system {
                vec![
                    json!({"transcript_index": 0, "role": "system", "content": "only", "created_at": null}),
                ]
            } else {
                Vec::new()
            };
            assert_eq!(
                page,
                json!({"messages": expected, "page": {
                    "start": 0, "end": expected.len(), "total": expected.len(), "has_older": false
                }})
            );
        }
    }
    finish(manager, root).await;
}

#[tokio::test]
async fn mcp_filtered_read_then_actual_revert_selects_exact_snapshot_and_log_boundaries() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = root();
    let _env = crate::tests::ScopedModelEnv::isolated(&root.join("home"), Some("fixture-key"));
    let messages = history();
    for id in ["snapshot", "log"] {
        seed(&root, id, &messages, 7);
    }
    let manager = crate::tests::test_manager(&root);
    let child = manager
        .create_traditional_child_session("log", "general", "owned fixture")
        .await
        .unwrap();
    for (id, target, canonical) in [("snapshot", "second", 4), ("log", "third", 7)] {
        let page = success(
            call(
                &manager,
                "get_messages",
                json!({
                    "session_id": id, "include_system": false, "limit": 100
                }),
            )
            .await,
        );
        let selected = page["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|message| message["content"] == target)
            .unwrap();
        let returned_index = selected["transcript_index"].clone();
        assert_eq!(returned_index, canonical);
        for (session, index, error) in [
            (id, 0, "not a user message"),
            (id, 2, "not a user message"),
            (id, 999, "not in this session's transcript"),
            ("missing-session", canonical, "session not found"),
            (child.as_str(), canonical, "session not found"),
        ] {
            rejected(
                call(
                    &manager,
                    "session_action",
                    json!({
                        "session_id": session, "action": "revert", "message_idx": index
                    }),
                )
                .await,
                error,
            );
        }
        let lease =
            sessions::SessionOperationLease::try_acquire(&root.join("store.db"), id).unwrap();
        rejected(
            call(
                &manager,
                "session_action",
                json!({
                    "session_id": id, "action": "revert", "message_idx": returned_index
                }),
            )
            .await,
            "session is busy",
        );
        drop(lease);
        let unchanged = success(
            call(
                &manager,
                "get_messages",
                json!({"session_id": id, "include_system": false, "limit": 100}),
            )
            .await,
        );
        assert_eq!(
            unchanged, page,
            "rejected mutations must not change history"
        );
        let reverted = success(
            call(
                &manager,
                "session_action",
                json!({
                    "session_id": id, "action": "revert", "message_idx": returned_index
                }),
            )
            .await,
        );
        assert_eq!(reverted["transcript_len"], canonical);
        assert_eq!(reverted["messages_removed"], messages.len() - canonical);
        let after = success(
            call(
                &manager,
                "get_messages",
                json!({"session_id": id, "limit": 100}),
            )
            .await,
        );
        let expected: Vec<_> = messages[..canonical].iter().enumerate()
            .map(|(index, message)| json!({"transcript_index": index, "role": message_role(message), "content": message_content(message), "created_at": null}))
            .collect();
        assert_eq!(
            after,
            json!({"messages": expected, "page": {
                "start": 0, "end": canonical, "total": canonical, "has_older": false
            }})
        );
        // Inspect persisted bytes as well as the public read after mutation.
        assert_eq!(
            serde_json::to_value(
                sessions::load_session(&root.join("store.db"), id)
                    .unwrap()
                    .messages
            )
            .unwrap(),
            serde_json::to_value(&messages[..canonical]).unwrap()
        );
        assert!(
            nac_core::store::TranscriptLogWriter::new(&root.join("store.db"))
                .unwrap()
                .read_tail_from(id, canonical as u64)
                .unwrap()
                .is_empty()
        );
        eprintln!("MCP read/revert evidence: direct session={id}, filtered content={target:?}, returned_index={returned_index}, kept={canonical}, removed={}", messages.len() - canonical);
    }
    finish(manager, root).await;
}

#[test]
fn mcp_transcript_rejects_inconsistent_canonical_projection_metadata() {
    for indices in [vec![], vec![1], vec![1, 2, 3], vec![2, 2], vec![3, 1]] {
        let page = MessagesPageSnapshot {
            canonical_message_indices: indices,
            messages: vec![user("one"), user("two")],
            created_at: vec![None, None],
            terminal_selection_attributions: vec![],
            page: MessagePageMetadata {
                start: 0,
                end: 2,
                total: 2,
                has_older: false,
            },
        };
        let error = encode_messages_page(page).unwrap_err();
        assert_eq!(error.message, "Inconsistent canonical transcript indices");
    }
}
