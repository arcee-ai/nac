use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};

const SOURCE: &str = "First paragraph.\n\nThe cache is keyed by `session_id` — ünïcode safe.";

fn assistant(content: &str) -> Message {
    Message::Assistant {
        content: Some(content.to_string()),
        reasoning_text: Some("PRIVATE REASONING".to_string()),
        reasoning_details: None,
        tool_calls: None,
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    }
}

fn request_for(excerpt: &str) -> SelectionQuestionRequest {
    let byte_start = SOURCE.find(excerpt).unwrap();
    let start = SOURCE[..byte_start].chars().count() as u64;
    SelectionQuestionRequest {
        request_key: "6f1c7d34-7a39-4c1f-9d4c-1f47e0e4a001".to_string(),
        source_message_index: 4,
        source_content_sha256: content_sha256(SOURCE),
        selection_start: start,
        selection_end: start + excerpt.chars().count() as u64,
        excerpt: excerpt.to_string(),
        question: "Why is it keyed this way?".to_string(),
    }
}

fn found(message: Message) -> SelectionSourceRead {
    SelectionSourceRead::Found {
        message,
        preceding_user: Some("Explain the cache".to_string()),
    }
}

#[test]
fn binding_freezes_only_visible_text_prompt_excerpt_and_question() {
    let request = request_for("keyed by `session_id` — ünïcode");
    let context = freeze_context(&request, found(assistant(SOURCE))).unwrap();
    assert_eq!(context.excerpt, "keyed by `session_id` — ünïcode");
    assert_eq!(context.source_text, SOURCE);
    assert_eq!(
        context.preceding_prompt.as_deref(),
        Some("Explain the cache")
    );
    let rendered = serde_json::to_string(&model_messages(&context)).unwrap();
    assert!(rendered.contains("Why is it keyed this way?"));
    assert!(!rendered.contains("PRIVATE REASONING"));
}

#[test]
fn changed_deleted_and_unmappable_sources_are_rejected() {
    let request = request_for("First paragraph.");
    assert_eq!(
        freeze_context(&request, SelectionSourceRead::Missing),
        Err(SelectionQuestionError::SourceMissing)
    );
    // Same index, different text (for example after a revert and new reply).
    assert_eq!(
        freeze_context(&request, found(assistant("First paragraph. Edited."))),
        Err(SelectionQuestionError::SourceChanged)
    );
    // The index now holds a user message.
    assert_eq!(
        freeze_context(
            &request,
            found(Message::User {
                content: SOURCE.to_string()
            })
        ),
        Err(SelectionQuestionError::SourceChanged)
    );
    // Hash matches but the excerpt is not at the stated offsets.
    let mut shifted = request.clone();
    shifted.selection_start += 1;
    shifted.selection_end += 1;
    assert_eq!(
        freeze_context(&shifted, found(assistant(SOURCE))),
        Err(SelectionQuestionError::SelectionUnmappable)
    );
    let mut past_end = request_for("cache");
    past_end.excerpt = "unicode".to_string();
    past_end.selection_start = 1_000;
    past_end.selection_end = 1_007;
    assert_eq!(
        freeze_context(&past_end, found(assistant(SOURCE))),
        Err(SelectionQuestionError::SelectionUnmappable)
    );
    // Bounds.
    let mut long = request.clone();
    long.question = "x".repeat(MAX_QUESTION_CHARS + 1);
    assert!(matches!(
        long.validate(),
        Err(SelectionQuestionError::Invalid(_))
    ));
    let mut bad_key = request.clone();
    bad_key.request_key = "not-a-uuid".to_string();
    assert!(bad_key.validate().is_err());
    let mut bad_hash = request;
    bad_hash.source_content_sha256 = "ABC".to_string();
    assert!(bad_hash.validate().is_err());
}

#[test]
fn long_sources_are_windowed_around_the_excerpt() {
    let text = format!("{}NEEDLE{}", "a".repeat(20_000), "b".repeat(20_000));
    let request = SelectionQuestionRequest {
        request_key: "6f1c7d34-7a39-4c1f-9d4c-1f47e0e4a001".to_string(),
        source_message_index: 1,
        source_content_sha256: content_sha256(&text),
        selection_start: 20_000,
        selection_end: 20_006,
        excerpt: "NEEDLE".to_string(),
        question: "what?".to_string(),
    };
    let context = freeze_context(
        &request,
        SelectionSourceRead::Found {
            message: assistant(&text),
            preceding_user: Some("p".repeat(MAX_PROMPT_CONTEXT_CHARS + 10)),
        },
    )
    .unwrap();
    assert!(context.source_text_truncated);
    assert_eq!(
        context.source_text.chars().count(),
        MAX_SOURCE_CONTEXT_CHARS
    );
    assert!(context.source_text.contains("NEEDLE"));
    assert!(context.preceding_prompt_truncated);
    assert_eq!(
        context.preceding_prompt.unwrap().chars().count(),
        MAX_PROMPT_CONTEXT_CHARS
    );
}

#[test]
fn digest_changes_with_any_argument() {
    let request = request_for("First paragraph.");
    let mut changed = request.clone();
    changed.question.push('!');
    assert_ne!(request.digest("s"), changed.digest("s"));
    assert_ne!(request.digest("s"), request.digest("t"));
    assert_eq!(request.digest("s"), request.clone().digest("s"));
}

fn context() -> SelectionQuestionContext {
    freeze_context(&request_for("First paragraph."), found(assistant(SOURCE))).unwrap()
}

#[tokio::test]
async fn one_tool_free_request_returns_an_answer_with_its_own_usage() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        serde_json::json!({
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "Because ids are stable."}]}],
            "usage": {"input_tokens": 11, "output_tokens": 4, "total_tokens": 15}
        })
        .to_string(),
    )]);
    let model = PinnedQuestionModel::for_test_server(server.base_url.clone());
    let settlement = model.ask(&context(), Duration::from_secs(5)).await;
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(body
        .get("tools")
        .is_none_or(|tools| tools.as_array().is_some_and(Vec::is_empty)));
    assert!(!body.to_string().contains("PRIVATE REASONING"));
    assert_eq!(settlement.status, SelectionQuestionStatus::Answered);
    assert_eq!(
        settlement.answer.as_deref(),
        Some("Because ids are stable.")
    );
    assert!(!settlement.tool_call_attempted);
    assert_eq!(settlement.usage.as_ref().unwrap().input_tokens, 11);
}

#[tokio::test]
async fn a_returned_tool_call_is_recorded_and_never_executed() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        serde_json::json!({
            "status": "completed",
            "output": [{"type": "function_call", "call_id": "call-1", "name": "shell", "arguments": "{\"command\":\"rm -rf /\"}"}],
            "usage": {"input_tokens": 9, "output_tokens": 2, "total_tokens": 11}
        })
        .to_string(),
    )]);
    let model = PinnedQuestionModel::for_test_server(server.base_url.clone());
    let settlement = model.ask(&context(), Duration::from_secs(5)).await;
    // Exactly one request: no tool result was ever sent back.
    assert_eq!(server.finish().len(), 1);
    assert_eq!(settlement.status, SelectionQuestionStatus::Failed);
    assert!(settlement.tool_call_attempted);
    assert_eq!(settlement.error.as_deref(), Some(TOOL_CALL_NO_ANSWER));
    assert!(settlement.answer.is_none());
    assert_eq!(settlement.usage.as_ref().unwrap().input_tokens, 9);
}

#[tokio::test]
async fn provider_errors_and_timeouts_fail_only_the_question() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "400 Bad Request",
        r#"{"error":{"message":"bad"}}"#,
    )]);
    let model = PinnedQuestionModel::for_test_server(server.base_url.clone());
    let settlement = model.ask(&context(), Duration::from_secs(5)).await;
    assert_eq!(server.finish().len(), 1);
    assert_eq!(settlement.status, SelectionQuestionStatus::Failed);
    assert!(settlement
        .error
        .unwrap()
        .starts_with("The model request failed"));

    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", "{}").drop_connection()
    ]);
    let model = PinnedQuestionModel::for_test_server(server.base_url.clone());
    let settlement = model.ask(&context(), Duration::from_millis(300)).await;
    let _ = server.finish();
    assert_eq!(settlement.status, SelectionQuestionStatus::Failed);
    assert!(settlement.usage.is_none());
}
