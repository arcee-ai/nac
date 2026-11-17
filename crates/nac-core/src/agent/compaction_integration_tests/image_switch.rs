use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::tool_content::{ToolContent, ToolContentPart, ToolImage};
use crate::types::{FunctionCall, ModelOrigin, ToolCall};
use base64::Engine;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use std::io::Cursor;

fn image_history() -> (Vec<Message>, String) {
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 2, Rgba([1, 2, 3, 255])))
        .write_to(&mut encoded, ImageFormat::Png)
        .unwrap();
    let image = ToolImage::validate(encoded.into_inner(), None, None).unwrap();
    let expected = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(image.data())
    );
    let mut messages = vec![
        Message::System {
            content: "system".into(),
        },
        Message::User {
            content: "read an image".into(),
        },
        Message::Assistant {
            content: None,
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(vec![ToolCall {
                id: "image-call".into(),
                call_type: "function".into(),
                function: FunctionCall {
                    name: "read".into(),
                    arguments: "{}".into(),
                },
            }]),
            duration_ms: None,
            model_origin: Some(ModelOrigin {
                backend: crate::model::BackendKind::ChatGptCodexResponses,
                model: "gpt-5.6-sol".into(),
            }),
            reasoning_field: None,
        },
        Message::Tool {
            tool_call_id: "image-call".into(),
            content: ToolContent::from_parts(vec![ToolContentPart::Image(image)]).unwrap(),
        },
    ];
    for number in 0..4 {
        messages.push(Message::User {
            content: format!("follow-up {number}: {}", "x".repeat(500)),
        });
        messages.push(Message::Assistant {
            content: Some(format!("answer {number}")),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        });
    }
    (messages, expected)
}

fn codex_response(text: &str) -> ScriptedResponse {
    let response = scripted_responses_text(text, 20, 0, 5, 25);
    ScriptedResponse::json("200 OK", format!("event: response.completed\ndata: {{\"type\":\"response.completed\",\"response\":{response}}}\n\n"))
        .with_header("Content-Type", "text/event-stream")
}

fn image_url(body: &[u8]) -> String {
    let request: serde_json::Value = serde_json::from_slice(body).unwrap();
    request["input"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["type"] == "function_call_output" && item["call_id"] == "image-call")
        .expect("image tool result is replayed")["output"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["type"] == "input_image")
        .unwrap()["image_url"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn next_operation_refreshes_codex_capability_and_read_definition() {
    let client =
        ModelClient::new_for_codex_test_server("http://127.0.0.1:1".into(), "unknown-text-model");
    let store_path = std::env::temp_dir()
        .join(format!("nac-boundary-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let mut agent = compaction_test_agent_with_mode(
        client,
        store_path,
        Some("session"),
        None,
        EventSink::none(),
        AgentMode::Direct,
    );
    agent.enable_automatic_compaction();
    let before_threshold = agent.compaction.as_ref().unwrap().threshold_for_test();
    assert!(!agent.client.supports_image_tool_results());
    agent.client.model = "gpt-5.6-sol".into();
    let mut light = agent.client.clone();
    light.model = "gpt-6.1-sol".into();
    let previous_light = std::sync::Arc::new(light);
    agent.tool_runtime.light_client = Some(previous_light.clone());
    assert!(
        !agent.client.supports_image_tool_results(),
        "the current operation keeps its snapshot"
    );
    agent.refresh_model_at_operation_boundary();
    assert!(agent.client.supports_image_tool_results());
    assert!(agent
        .tool_runtime
        .light_client
        .as_ref()
        .unwrap()
        .supports_image_tool_results());
    assert!(
        !previous_light.supports_image_tool_results(),
        "in-flight clients keep their snapshot"
    );
    assert_ne!(
        agent.compaction.as_ref().unwrap().threshold_for_test(),
        before_threshold
    );
    assert_eq!(
        agent.compaction.as_ref().unwrap().threshold_for_test(),
        agent.client.automatic_compaction_threshold()
    );
    let read = agent
        .base_tool_defs
        .iter()
        .find(|tool| tool.function.name == "read")
        .unwrap();
    assert_eq!(
        serde_json::to_value(read).unwrap(),
        serde_json::to_value(crate::tools::read::definition(true)).unwrap()
    );
}

#[tokio::test]
async fn switched_codex_model_replays_image_in_normal_run_and_compaction() {
    let server = ScriptedServer::start(vec![codex_response("normal"), codex_response("summary")]);
    let client = ModelClient::new_for_codex_test_server(server.base_url.clone(), "gpt-6.1-sol");
    assert!(client.supports_image_tool_results());
    let (mut history, expected_image) = image_history();
    let root =
        std::env::temp_dir().join(format!("nac-codex-image-switch-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let Message::Tool { content, .. } = &history[3] else {
        panic!("expected image tool result")
    };
    let ToolContentPart::Image(image) = &content.parts().unwrap()[0] else {
        panic!("expected image")
    };
    std::fs::write(root.join("fixture.png"), image.data()).unwrap();
    let previous = ModelClient::new_for_codex_test_server(server.base_url.clone(), "gpt-5.6-sol");
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = root.clone();
    let read = crate::tools::read::execute(
        serde_json::json!({"path":"fixture.png"}),
        &runtime,
        previous.supports_image_tool_results(),
    )
    .await;
    assert!(!read.is_error);
    history[3] = Message::Tool {
        tool_call_id: "image-call".into(),
        content: read.content,
    };
    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer.append_batch("session", 0, &history).unwrap();
    let history: Vec<Message> = writer
        .read_from("session", 0)
        .unwrap()
        .into_iter()
        .map(|(_, message)| message)
        .collect();
    let original_history = serde_json::to_vec(&history).unwrap();
    let original_len = history.len();
    // Persist the previous model, then switch this same session through the
    // revision-checked configuration path before reconstructing its agent.
    let mut saved = crate::sessions::load_session_config(&store_path, "session").unwrap();
    saved.backend = Some(
        crate::model::BackendKind::ChatGptCodexResponses
            .as_str()
            .into(),
    );
    saved.model = "gpt-5.6-sol".into();
    saved.base_url = crate::model::CHATGPT_CODEX_CANONICAL_BASE_URL.into();
    crate::sessions::update_raw_session_config(&store_path, &saved).unwrap();
    let mut saved = crate::sessions::load_session_config(&store_path, "session").unwrap();
    saved.model = "gpt-6.1-sol".into();
    crate::sessions::update_raw_session_config(&store_path, &saved).unwrap();
    let switched = crate::sessions::load_session_config(&store_path, "session").unwrap();
    assert_eq!(switched.model, "gpt-6.1-sol");
    let client = ModelClient::new_for_codex_test_server(server.base_url.clone(), &switched.model);
    let mut agent = compaction_test_agent_with_mode(
        client,
        store_path,
        Some("session"),
        None,
        EventSink::none(),
        AgentMode::Direct,
    );
    agent.restore_messages(history);
    agent.set_current_run_id(Some(uuid::Uuid::new_v4().to_string()));
    assert_eq!(agent.send("continue").await.unwrap(), "normal");
    let before = serde_json::to_vec(&agent.messages).unwrap();
    let stored_before: Vec<Message> = writer
        .read_from("session", 0)
        .unwrap()
        .into_iter()
        .map(|(_, message)| message)
        .collect();
    assert!(matches!(
        agent.compact().await.unwrap(),
        CompactionResult::Compacted { .. }
    ));
    assert_eq!(serde_json::to_vec(&agent.messages).unwrap(), before);
    let persisted: Vec<Message> = writer
        .read_from("session", 0)
        .unwrap()
        .into_iter()
        .map(|(_, message)| message)
        .collect();
    assert_eq!(
        serde_json::to_vec(&persisted).unwrap(),
        serde_json::to_vec(&stored_before).unwrap()
    );
    assert_eq!(
        serde_json::to_vec(&persisted[..original_len]).unwrap(),
        original_history
    );
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    assert_eq!(image_url(&requests[0].body), expected_image);
    assert_eq!(image_url(&requests[1].body), expected_image);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn unsupported_switch_refuses_image_and_compatible_switch_recovers() {
    let server = ScriptedServer::start(vec![codex_response("recovered")]);
    let (history, expected_image) = image_history();
    let before = serde_json::to_vec(&history).unwrap();
    let unsupported =
        ModelClient::new_for_codex_test_server(server.base_url.clone(), "unknown-text-model");
    assert!(unsupported
        .send_turn(history.clone(), vec![])
        .await
        .unwrap_err()
        .to_string()
        .contains("image tool results are unsupported"));
    assert_eq!(serde_json::to_vec(&history).unwrap(), before);
    let store_path = std::env::temp_dir()
        .join(format!(
            "nac-codex-image-unsupported-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let mut agent = compaction_test_agent(
        unsupported,
        store_path,
        Some("session"),
        Some(1),
        EventSink::none(),
    );
    agent.messages = history.clone().into();
    assert!(agent
        .compact()
        .await
        .unwrap_err()
        .to_string()
        .contains("image tool results are unsupported"));
    assert_eq!(serde_json::to_vec(&agent.messages).unwrap(), before);
    let compatible = ModelClient::new_for_codex_test_server(server.base_url.clone(), "gpt-6.1-sol");
    compatible.send_turn(history.clone(), vec![]).await.unwrap();
    assert_eq!(serde_json::to_vec(&history).unwrap(), before);
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert_eq!(image_url(&requests[0].body), expected_image);
}
